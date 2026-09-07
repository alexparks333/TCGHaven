import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'

interface CardInput {
  id: string      // Firestore card ID
  apiId: string   // Pokemon TCG card ID (e.g. "sv7-1")
  isFoil: boolean
}

interface CatalogCard {
  id: string
  marketPrice: number
  marketPriceFoil: number
  lowPriceNM: number
  lowPriceNMFoil: number
}

// Reads prices straight from the catalog (kept fresh by the 6-hourly cron —
// app/api/cron/sync-prices/route.ts — rather than live-querying api.pokemontcg.io on every
// Portfolio refresh; see CLAUDE.md "Price Data" for the full rationale).
export async function POST(req: NextRequest) {
  const { cards, priceMode = 'market' }: { cards: CardInput[]; priceMode?: string } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('pokemon')
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const useLowestNM = priceMode === 'lowestNM'

  const results: Record<string, number> = {}
  for (const { id, apiId, isFoil } of cards) {
    const cat = byId.get(apiId)
    if (!cat) continue
    const price = useLowestNM
      ? (isFoil ? (cat.lowPriceNMFoil || cat.lowPriceNM) : (cat.lowPriceNM || cat.lowPriceNMFoil))
      : (isFoil ? (cat.marketPriceFoil || cat.marketPrice) : (cat.marketPrice || cat.marketPriceFoil))
    if (price > 0) results[id] = price
  }

  return NextResponse.json(results)
}
