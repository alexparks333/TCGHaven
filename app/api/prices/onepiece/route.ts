import { NextRequest } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice, gradingOf } from '@/lib/pricing'
import { gradedFor, withGraded, noteGradedSource, priceReply, type GradingInput, type GradedSource } from '@/lib/api/gradedPrices'

export const dynamic = 'force-dynamic'

interface CardInput extends GradingInput {
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
// isFoil branching to do here, just a direct id -> marketPrice lookup, kept fresh by
// the 6-hourly cron the same way as the other games (see CLAUDE.md "Price Data").
export async function POST(req: NextRequest) {
  const body: { cards: CardInput[]; withSources?: boolean } = await req.json()
  const { cards } = body
  if (!cards.length) return priceReply(body, {}, {})

  const catalog = await loadCatalog<CatalogCard>('onepiece')
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const graded = await gradedFor('onepiece', cards)

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  const sources: Record<string, GradedSource> = {}
  for (const card of cards) {
    const raw = card.apiId ? byId.get(card.apiId) : undefined
    if (!raw) continue
    const cat = withGraded(raw, graded)
    const choice = { isFoil: (card as { isFoil?: boolean }).isFoil, grading: gradingOf(card) }
    const price = catalogPrice('onepiece', cat, choice)
    if (price > 0) results[card.id] = price
    noteGradedSource(sources, card.id, 'onepiece', cat, choice, graded)
  }

  return priceReply(body, results, sources)
}
