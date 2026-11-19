import { NextRequest } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { copyPrice, gradingOf, type CatalogPriceFields } from '@/lib/pricing'
import { gradedFor, withGraded, noteGradedSource, priceReply, type GradingInput, type GradedSource } from '@/lib/api/gradedPrices'
import type { Edition, Finish, Language } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface CardInput extends GradingInput {
  id: string      // Firestore card ID
  apiId: string   // catalog card ID (e.g. "sv7-1", or "jp-123456" for a Japanese card)
  isFoil: boolean
  edition?: Edition
  finish?: Finish
  language?: Language
}

type CatalogCard = CatalogPriceFields & { id: string }

// Reads prices straight from the catalog (kept fresh by the 6-hourly cron —
// app/api/cron/sync-prices/route.ts — rather than live-querying api.pokemontcg.io on every
// Portfolio refresh; see CLAUDE.md "Price Data" for the full rationale). Japanese cards
// (language 'ja') are priced from the Japanese catalog.
export async function POST(req: NextRequest) {
  const body: { cards: CardInput[]; withSources?: boolean } = await req.json()
  const { cards } = body
  if (!cards.length) return priceReply(req, body, {}, {})

  const wantJapanese = cards.some((c) => c.language === 'ja')
  const [english, japanese] = await Promise.all([
    cards.some((c) => c.language !== 'ja') ? loadCatalog<CatalogCard>('pokemon') : Promise.resolve([]),
    wantJapanese ? loadCatalog<CatalogCard>('pokemon-jp') : Promise.resolve([]),
  ])
  const byId = { en: new Map(english.map((c) => [c.id, c])), ja: new Map(japanese.map((c) => [c.id, c])) }
  // PriceCharting graded prices, only when a graded card is asked about (lib/api/gradedPrices.ts)
  const [gradedEn, gradedJa] = await Promise.all([
    gradedFor('pokemon', cards.filter((c) => c.language !== 'ja'), req),
    gradedFor('pokemon-jp', cards.filter((c) => c.language === 'ja'), req),
  ])

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  const sources: Record<string, GradedSource> = {}
  for (const card of cards) {
    const ja = card.language === 'ja'
    const raw = card.apiId ? byId[ja ? 'ja' : 'en'].get(card.apiId) : undefined
    if (!raw) continue
    const graded = ja ? gradedJa : gradedEn
    const cat = withGraded(raw, graded)
    const choice = { isFoil: card.isFoil, edition: card.edition, finish: card.finish, grading: gradingOf(card), condition: card.condition }
    const price = copyPrice('pokemon', cat, choice)
    if (price > 0) results[card.id] = price
    noteGradedSource(sources, card.id, 'pokemon', cat, choice, graded)
  }

  return priceReply(req, body, results, sources)
}
