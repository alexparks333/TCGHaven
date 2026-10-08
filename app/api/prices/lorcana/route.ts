import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

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

// Reads prices straight from the catalog (kept fresh by the 6-hourly cron —
// app/api/cron/sync-prices/route.ts — rather than live-fetching lorcast.com one card at a time
// on every Portfolio refresh, which used to be the slowest of the three games by far; see
// CLAUDE.md "Price Data" for the full rationale).
export async function POST(req: NextRequest) {
  const { cards }: { cards: CardInput[] } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('lorcana')
  const byId = new Map(catalog.map((c) => [c.id, c]))

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  for (const card of cards) {
    const cat = card.apiId ? byId.get(card.apiId) : undefined
    if (!cat) continue
    const price = catalogPrice('lorcana', cat, { isFoil: (card as { isFoil?: boolean }).isFoil })
    if (price > 0) results[card.id] = price
  }

  return NextResponse.json(results)
}
