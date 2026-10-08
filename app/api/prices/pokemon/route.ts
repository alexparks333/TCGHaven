import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice } from '@/lib/pricing'

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
  const { cards }: { cards: CardInput[] } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('pokemon')
  const byId = new Map(catalog.map((c) => [c.id, c]))

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  for (const card of cards) {
    const cat = card.apiId ? byId.get(card.apiId) : undefined
    if (!cat) continue
    const price = catalogPrice('pokemon', cat, { isFoil: (card as { isFoil?: boolean }).isFoil })
    if (price > 0) results[card.id] = price
  }

  return NextResponse.json(results)
}
