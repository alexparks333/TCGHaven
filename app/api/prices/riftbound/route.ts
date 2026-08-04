import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'

const TCGCSV_GROUPS: Record<string, number> = {
  OGN: 24344,
  SFD: 24519,
  UNL: 24560,
  OGS: 24439,
}

const TCGCSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      fields.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

function tcgKey(setCode: string, extNumber: string, name: string): string | null {
  const m = extNumber.match(/^(\d+)([a*]?)\//)
  if (!m) return null
  const num = String(parseInt(m[1], 10))
  const suffix = m[2]
  const isSig = suffix === '*' || name.includes('(Signature)')
  const isAlt = suffix === 'a' || name.includes('(Alternate Art)')
  const isOver = name.includes('(Overnumbered)')
  if (isSig) return `${setCode}:${num}:star`
  if (isAlt) return `${setCode}:${num}:altart`
  if (isOver) return `${setCode}:${num}:over`
  return `${setCode}:${num}:regular`
}

interface CatalogCard {
  id: string
  rarity: string
  publicCode: string
  number: string
  setCode: string
  marketPrice: number
  marketPriceFoil: number
  lowPriceNM: number
  lowPriceNMFoil: number
}

function catalogKey(card: CatalogCard): string {
  const isStar = card.id.includes('-star-')
  const isShowcase = card.rarity === 'Showcase'
  const isSameNumAlt = isShowcase && (card.publicCode ?? '').includes('a/')
  const num = String(parseInt(card.number, 10))
  if (isStar) return `${card.setCode}:${num}:star`
  if (isSameNumAlt) return `${card.setCode}:${num}:altart`
  if (isShowcase) return `${card.setCode}:${num}:over`
  return `${card.setCode}:${num}:regular`
}

interface CardInput {
  id: string
  apiId: string
  setCode: string
  isFoil: boolean
}

export async function POST(req: NextRequest) {
  const { cards, priceMode = 'market' }: { cards: CardInput[]; priceMode?: string } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('riftbound')
  const byId = new Map(catalog.map((c) => [c.id, c]))

  // Fetch live prices from tcgcsv.com for each set the user has cards from
  const neededSets = new Set<string>()
  for (const card of cards) {
    if (card.setCode && TCGCSV_GROUPS[card.setCode]) neededSets.add(card.setCode)
  }

  const livePrices = new Map<string, { normal: number; foil: number; lowNormal: number; lowFoil: number }>()

  await Promise.all(
    Array.from(neededSets).map(async (setCode) => {
      const groupId = TCGCSV_GROUPS[setCode]
      try {
        const url = `https://tcgcsv.com/tcgplayer/89/${groupId}/ProductsAndPrices.csv`
        const res = await fetch(url, { headers: TCGCSV_HEADERS, signal: AbortSignal.timeout(15000) })
        if (!res.ok) return
        const text = await res.text()
        const lines = text.split('\n')
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim()
          if (!line) continue
          const f = parseCSVLine(line)
          const name = f[1] ?? ''
          const lowPrice    = parseFloat(f[9])  || 0
          const marketPrice = parseFloat(f[12]) || 0
          const subType = f[14] ?? ''
          const extNumber = f[16] ?? ''
          if (!extNumber || !name || (marketPrice === 0 && lowPrice === 0)) continue
          const key = tcgKey(setCode, extNumber, name)
          if (!key) continue
          const entry = livePrices.get(key) ?? { normal: 0, foil: 0, lowNormal: 0, lowFoil: 0 }
          if (subType === 'Foil') { entry.foil = marketPrice; entry.lowFoil = lowPrice }
          else { entry.normal = marketPrice; entry.lowNormal = lowPrice }
          livePrices.set(key, entry)
        }
      } catch {
        // tcgcsv unavailable for this set — fall back to catalog prices
      }
    })
  )

  const useLowestNM = priceMode === 'lowestNM'

  const results: Record<string, number> = {}
  for (const { id, apiId, isFoil } of cards) {
    const cat = byId.get(apiId)
    if (!cat) continue

    const key = catalogKey(cat)
    const liveP = livePrices.get(key)
    const isShowcaseOrStar = cat.rarity === 'Showcase' || cat.id.includes('-star-')

    let price: number
    if (liveP) {
      if (useLowestNM) {
        price = isShowcaseOrStar
          ? (liveP.lowFoil || liveP.lowNormal || liveP.foil || liveP.normal)
          : (isFoil ? (liveP.lowFoil || liveP.lowNormal) : (liveP.lowNormal || liveP.lowFoil))
      } else {
        price = isShowcaseOrStar
          ? (liveP.foil || liveP.normal)
          : (isFoil ? (liveP.foil || liveP.normal) : (liveP.normal || liveP.foil))
      }
    } else {
      // Fall back to catalog price if live fetch failed for this set
      if (useLowestNM) {
        price = isShowcaseOrStar
          ? (cat.lowPriceNM || cat.lowPriceNMFoil || cat.marketPrice || cat.marketPriceFoil)
          : (isFoil ? (cat.lowPriceNMFoil || cat.lowPriceNM) : (cat.lowPriceNM || cat.lowPriceNMFoil))
      } else {
        price = isShowcaseOrStar
          ? (cat.marketPrice || cat.marketPriceFoil)
          : (isFoil ? (cat.marketPriceFoil || cat.marketPrice) : (cat.marketPrice || cat.marketPriceFoil))
      }
    }

    if (price > 0) results[id] = price
  }

  return NextResponse.json(results)
}
