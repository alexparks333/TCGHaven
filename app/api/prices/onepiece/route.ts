import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice, type PriceMode } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

interface CardInput {
  id: string    // Firestore card ID
  apiId: string // catalog card id, e.g. "OP01-024" or "OP01-024_p1" (a Parallel print)
}

interface CatalogCard {
  id: string
  marketPrice: number
}

// Simpler than the other three games' price routes: One Piece has no foil/non-foil duality on a
// single card — a "Parallel" print is a fully separate catalog id with its own `marketPrice`,
// not a foil toggle of the same card (see catalog-sync.mjs's downloadOnePiece()) — so there's no
// isFoil/priceMode branching to do here, just a direct id -> marketPrice lookup, kept fresh by
// the 6-hourly cron the same way as the other games (see CLAUDE.md "Price Data").
export async function POST(req: NextRequest) {
  const { cards, priceMode = 'market' }: { cards: CardInput[]; priceMode?: PriceMode } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('onepiece')
  const byId = new Map(catalog.map((c) => [c.id, c]))

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  for (const card of cards) {
    const cat = card.apiId ? byId.get(card.apiId) : undefined
    if (!cat) continue
    const price = catalogPrice('onepiece', cat, { isFoil: (card as { isFoil?: boolean }).isFoil, priceMode })
    if (price > 0) results[card.id] = price
  }

  return NextResponse.json(results)
}
