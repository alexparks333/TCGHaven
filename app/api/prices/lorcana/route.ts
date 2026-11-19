import { NextRequest } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { copyPrice, gradingOf } from '@/lib/pricing'
import { gradedFor, withGraded, noteGradedSource, priceReply, type GradingInput, type GradedSource } from '@/lib/api/gradedPrices'

export const dynamic = 'force-dynamic'

interface CardInput extends GradingInput {
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
  const body: { cards: CardInput[]; withSources?: boolean } = await req.json()
  const { cards } = body
  if (!cards.length) return priceReply(body, {}, {})

  const catalog = await loadCatalog<CatalogCard>('lorcana')
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const graded = await gradedFor('lorcana', cards)

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  const sources: Record<string, GradedSource> = {}
  for (const card of cards) {
    const raw = card.apiId ? byId.get(card.apiId) : undefined
    if (!raw) continue
    const cat = withGraded(raw, graded)
    const choice = { isFoil: card.isFoil, grading: gradingOf(card), condition: card.condition }
    const price = copyPrice('lorcana', cat, choice)
    if (price > 0) results[card.id] = price
    noteGradedSource(sources, card.id, 'lorcana', cat, choice, graded)
  }

  return priceReply(body, results, sources)
}
