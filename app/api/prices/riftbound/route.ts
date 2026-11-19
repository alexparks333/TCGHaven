import { NextRequest } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { copyPrice, gradingOf } from '@/lib/pricing'
import { gradedFor, withGraded, noteGradedSource, priceReply, type GradingInput, type GradedSource } from '@/lib/api/gradedPrices'

export const dynamic = 'force-dynamic'

interface CatalogCard {
  id: string
  rarity: string
  publicCode?: string
  marketPrice: number
  marketPriceFoil: number
  lowPriceNM: number
  lowPriceNMFoil: number
}

interface CardInput extends GradingInput {
  id: string
  apiId: string
  isFoil: boolean
}

// Reads prices straight from the catalog (kept fresh by the 6-hourly cron —
// app/api/cron/sync-prices/route.ts — rather than re-downloading every set's full tcgcsv CSV on
// every Portfolio refresh; see CLAUDE.md "Price Data" for the full rationale). The catalog's
// marketPrice/marketPriceFoil/lowPriceNM/lowPriceNMFoil fields are already computed with this
// same Alt Art/Overnumbered/Star foil-only logic at sync time (see downloadRiftbound() in
// scripts/lib/catalog-sync.mjs), so no re-derivation from a live CSV is needed here.
export async function POST(req: NextRequest) {
  const body: { cards: CardInput[]; withSources?: boolean } = await req.json()
  const { cards } = body
  if (!cards.length) return priceReply(body, {}, {})

  const catalog = await loadCatalog<CatalogCard>('riftbound')
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const graded = await gradedFor('riftbound', cards)

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  const sources: Record<string, GradedSource> = {}
  for (const card of cards) {
    const raw = card.apiId ? byId.get(card.apiId) : undefined
    if (!raw) continue
    const cat = withGraded(raw, graded)
    const choice = { isFoil: card.isFoil, grading: gradingOf(card), condition: card.condition }
    const price = copyPrice('riftbound', cat, choice)
    if (price > 0) results[card.id] = price
    noteGradedSource(sources, card.id, 'riftbound', cat, choice, graded)
  }

  return priceReply(body, results, sources)
}
