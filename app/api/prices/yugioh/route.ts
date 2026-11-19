import { NextRequest } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { copyPrice, gradingOf } from '@/lib/pricing'
import { gradedFor, withGraded, noteGradedSource, priceReply, type GradingInput, type GradedSource } from '@/lib/api/gradedPrices'
import type { Edition, Finish } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface CardInput extends GradingInput {
  id: string
  apiId: string
  isFoil: boolean
  edition?: Edition
  finish?: Finish
}

interface CatalogCard {
  id: string
  marketPrice: number
  marketPriceFoil: number
  variantPrices?: Record<string, number>
}

// Yu-Gi-Oh! prices straight from the catalog (refreshed daily by sync-yugioh.yml). A card logged
// as a specific edition (1st / Unlimited / Limited) is priced as exactly that printing —
// lib/pricing.ts, the one rule every price display uses.
export async function POST(req: NextRequest) {
  const body: { cards: CardInput[]; withSources?: boolean } = await req.json()
  const { cards } = body
  if (!cards.length) return priceReply(body, {}, {})
  const catalog = await loadCatalog<CatalogCard>('yugioh')
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const graded = await gradedFor('yugioh', cards)
  const results: Record<string, number> = {}
  const sources: Record<string, GradedSource> = {}
  for (const card of cards) {
    const raw = card.apiId ? byId.get(card.apiId) : undefined
    if (!raw) continue
    const cat = withGraded(raw, graded)
    const choice = { isFoil: card.isFoil, edition: card.edition, finish: card.finish, grading: gradingOf(card), condition: card.condition }
    const price = copyPrice('yugioh', cat, choice)
    if (price > 0) results[card.id] = price
    noteGradedSource(sources, card.id, 'yugioh', cat, choice, graded)
  }
  return priceReply(body, results, sources)
}
