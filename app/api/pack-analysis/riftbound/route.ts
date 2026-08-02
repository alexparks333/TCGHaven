import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'

const PULL_RATES = {
  epicPerPack:       0.25,
  altArtPerPack:     0.0833,
  overnumberPerPack: 0.014,
  signaturePerPack:  0.0014,
}

const SET_META: Record<string, { setName: string; releaseDate: string; packPrice: number; cardsPerPack: number }> = {
  OGN: { setName: 'Origins',          releaseDate: '2025-10-31', packPrice: 5.00, cardsPerPack: 13 },
  SFD: { setName: 'Spiritforged',     releaseDate: '2026-02-13', packPrice: 5.00, cardsPerPack: 13 },
  UNL: { setName: 'Unleashed',        releaseDate: '2026-05-08', packPrice: 5.00, cardsPerPack: 13 },
  OGS: { setName: 'Proving Grounds',  releaseDate: '2026-01-01', packPrice: 0,    cardsPerPack: 0  },
}

const TCGCSV_GROUPS: Record<string, number> = { OGN: 24344, SFD: 24519, UNL: 24560, OGS: 24439 }
const BOOSTER_SET_CODES = ['OGN', 'SFD', 'UNL']

const TCGCSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
}

interface CatalogCard {
  id: string
  name: string
  number: string
  publicCode: string
  setCode: string
  setName: string
  rarity: string
  imageUrl: string
  marketPrice: number
  marketPriceFoil: number
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
    } else if (ch === ',' && !inQ) { fields.push(cur); cur = '' }
    else cur += ch
  }
  fields.push(cur)
  return fields
}

function tcgKey(setCode: string, extNumber: string, name: string): string | null {
  const m = extNumber.match(/^(\d+)([a*]?)\//)
  if (!m) return null
  const num = String(parseInt(m[1], 10))
  const suffix = m[2]
  if (suffix === '*' || name.includes('(Signature)')) return `${setCode}:${num}:star`
  if (suffix === 'a' || name.includes('(Alternate Art)')) return `${setCode}:${num}:altart`
  if (name.includes('(Overnumbered)')) return `${setCode}:${num}:over`
  return `${setCode}:${num}:regular`
}

function catalogKey(card: CatalogCard): string {
  const isStar = card.id.includes('-star-') || card.rarity === 'Star'
  const isShowcase = card.rarity === 'Showcase'
  const isSameNumAlt = isShowcase && (card.publicCode ?? '').includes('a/')
  const num = String(parseInt(card.number, 10))
  if (isStar) return `${card.setCode}:${num}:star`
  if (isSameNumAlt) return `${card.setCode}:${num}:altart`
  if (isShowcase) return `${card.setCode}:${num}:over`
  return `${card.setCode}:${num}:regular`
}

function avgOf(cards: CatalogCard[], key: 'marketPrice' | 'marketPriceFoil'): number {
  const priced = cards.filter((c) => c[key] > 0)
  if (!priced.length) return 0
  return priced.reduce((s, c) => s + c[key], 0) / priced.length
}

function top5(cards: CatalogCard[], key: 'marketPrice' | 'marketPriceFoil') {
  return [...cards].filter((c) => c[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 5)
    .map((c) => ({ name: c.name, price: c[key], imageUrl: c.imageUrl }))
}

export async function GET() {
  const catalog = loadCatalog<CatalogCard>('riftbound-cards.json')
  const byId = new Map(catalog.map((c) => [c.id, c]))

  // Fetch live prices from tcgcsv for all booster sets in parallel
  const livePrices = new Map<string, { normal: number; foil: number }>()

  await Promise.all(
    Object.keys(TCGCSV_GROUPS).map(async (setCode) => {
      const groupId = TCGCSV_GROUPS[setCode]
      try {
        const res = await fetch(
          `https://tcgcsv.com/tcgplayer/89/${groupId}/ProductsAndPrices.csv`,
          { headers: TCGCSV_HEADERS, signal: AbortSignal.timeout(15000) }
        )
        if (!res.ok) return
        const lines = (await res.text()).split('\n')
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim()
          if (!line) continue
          const f = parseCSVLine(line)
          const name = f[1] ?? ''
          const marketPrice = parseFloat(f[12]) || 0
          const subType = f[14] ?? ''
          const extNumber = f[16] ?? ''
          if (!extNumber || !name || marketPrice === 0) continue
          const key = tcgKey(setCode, extNumber, name)
          if (!key) continue
          const entry = livePrices.get(key) ?? { normal: 0, foil: 0 }
          if (subType === 'Foil') entry.foil = marketPrice
          else entry.normal = marketPrice
          livePrices.set(key, entry)
        }
      } catch {
        // tcgcsv unreachable for this set — catalog prices used as fallback
      }
    })
  )

  // Apply live prices to catalog cards
  const enriched = catalog.map((card) => {
    const key = catalogKey(card)
    const liveP = livePrices.get(key)
    if (!liveP) return card
    const isShowcaseOrStar = card.rarity === 'Showcase' || card.id.includes('-star-') || card.rarity === 'Star'
    return {
      ...card,
      marketPrice: isShowcaseOrStar
        ? (liveP.foil || liveP.normal || card.marketPrice)
        : (liveP.normal || card.marketPrice),
      marketPriceFoil: isShowcaseOrStar
        ? 0
        : (liveP.foil || card.marketPriceFoil),
    }
  })

  // Build per-set EV data for each booster set
  const results = BOOSTER_SET_CODES.map((setCode) => {
    const meta = SET_META[setCode]
    const setCards = enriched.filter((c) => c.setCode === setCode)

    const commons    = setCards.filter((c) => c.rarity === 'Common')
    const uncommons  = setCards.filter((c) => c.rarity === 'Uncommon')
    const rares      = setCards.filter((c) => c.rarity === 'Rare')
    const epics      = setCards.filter((c) => c.rarity === 'Epic')
    const signatures = setCards.filter((c) => c.id.includes('-star-') || c.rarity === 'Star')
    const altArts    = setCards.filter((c) => c.rarity === 'Showcase' && (c.publicCode ?? '').includes('a/') && !c.id.includes('-star-'))
    const overnums   = setCards.filter((c) => c.rarity === 'Showcase' && !(c.publicCode ?? '').includes('a/') && !c.id.includes('-star-'))

    const avgCommon       = avgOf(commons,    'marketPrice')
    const avgUncommon     = avgOf(uncommons,  'marketPrice')
    const avgRare         = avgOf(rares,      'marketPrice')
    const avgEpic         = avgOf(epics,      'marketPrice')
    const avgFoilCommon   = avgOf(commons,    'marketPriceFoil')
    const avgFoilUncommon = avgOf(uncommons,  'marketPriceFoil')
    const avgAltArt       = avgOf(altArts,    'marketPrice')
    const avgOvernumber   = avgOf(overnums,   'marketPrice')
    const avgSignature    = avgOf(signatures, 'marketPrice')

    const { epicPerPack, altArtPerPack, overnumberPerPack, signaturePerPack } = PULL_RATES
    const nonPremium = 1 - altArtPerPack - overnumberPerPack - signaturePerPack

    const evCommons          = 7 * avgCommon
    const evUncommons        = 3 * avgUncommon
    const evRarePlusSlots    = 0.75 * (2 * avgRare) + 0.25 * (avgRare + avgEpic)
    const evWildcardBase     = nonPremium * 0.5 * (avgFoilCommon + avgFoilUncommon)
    const evWildcardAltArt   = altArtPerPack * avgAltArt
    const evWildcardOvernum  = overnumberPerPack * avgOvernumber
    const evWildcardSig      = signaturePerPack * avgSignature
    const evWildcardSlot     = evWildcardBase + evWildcardAltArt + evWildcardOvernum + evWildcardSig
    const total              = evCommons + evUncommons + evRarePlusSlots + evWildcardSlot

    return {
      setCode,
      setName: meta.setName,
      releaseDate: meta.releaseDate,
      packPrice: meta.packPrice,
      cardsPerPack: meta.cardsPerPack,
      avgCommon, avgUncommon, avgRare, avgEpic,
      avgFoilCommon, avgFoilUncommon,
      avgAltArt, avgOvernumber, avgSignature,
      countCommon:    commons.length,
      countUncommon:  uncommons.length,
      countRare:      rares.length,
      countEpic:      epics.length,
      countAltArt:    altArts.length,
      countOvernumber:overnums.length,
      countSignature: signatures.length,
      topEpics:       top5(epics,      'marketPrice'),
      topRares:       top5(rares,      'marketPrice'),
      topAltArts:     top5(altArts,    'marketPrice'),
      topOvernumbers: top5(overnums,   'marketPrice'),
      topSignatures:  top5(signatures, 'marketPrice'),
      ev: {
        commons: evCommons,
        uncommons: evUncommons,
        rarePlusSlots: evRarePlusSlots,
        wildcardSlot: evWildcardSlot,
        wildcardBase: evWildcardBase,
        wildcardAltArt: evWildcardAltArt,
        wildcardOvernumber: evWildcardOvernum,
        wildcardSignature: evWildcardSig,
        total,
      },
    }
  })

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
