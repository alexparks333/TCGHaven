import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'

const CONCURRENCY = 8

interface CardInput {
  id: string
  apiId: string
  isFoil: boolean
}

interface CatalogCard {
  id: string
  marketPrice: number
  marketPriceFoil: number
}

interface LorcastPrices {
  marketPrice: number
  marketPriceFoil: number
}

export async function POST(req: NextRequest) {
  // priceMode accepted for API consistency; lorcast only provides market price so 'lowestNM' falls back to market
  const { cards }: { cards: CardInput[]; priceMode?: string } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const uniqueApiIds = Array.from(new Set(cards.filter((c) => c.apiId).map((c) => c.apiId)))

  // Fetch live prices from lorcast.com — one request per unique card
  const liveByApiId = new Map<string, LorcastPrices>()
  let idx = 0

  async function worker() {
    while (idx < uniqueApiIds.length) {
      const apiId = uniqueApiIds[idx++]
      try {
        const res = await fetch(`https://api.lorcast.com/v0/cards/${apiId}`, {
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) continue
        const c = await res.json()
        liveByApiId.set(apiId, {
          marketPrice: parseFloat(c.prices?.usd) || 0,
          marketPriceFoil: parseFloat(c.prices?.usd_foil) || 0,
        })
      } catch {
        // timeout or network error — fall back to catalog for this card
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uniqueApiIds.length) }, worker))

  // Fall back to static catalog for any cards where live fetch failed
  const catalog = await loadCatalog<CatalogCard>('lorcana')
  const catalogById = new Map(catalog.map((c) => [c.id, c]))

  const results: Record<string, number> = {}
  for (const { id, apiId, isFoil } of cards) {
    if (!apiId) continue
    const source = liveByApiId.get(apiId) ?? catalogById.get(apiId)
    if (!source) continue
    const price = isFoil
      ? (source.marketPriceFoil || source.marketPrice)
      : (source.marketPrice || source.marketPriceFoil)
    if (price > 0) results[id] = price
  }

  return NextResponse.json(results)
}
