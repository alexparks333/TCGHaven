import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice, type CatalogPriceFields } from '@/lib/pricing'
import type { Edition, Finish, Language } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface CardInput {
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
  const { cards }: { cards: CardInput[] } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const wantJapanese = cards.some((c) => c.language === 'ja')
  const [english, japanese] = await Promise.all([
    cards.some((c) => c.language !== 'ja') ? loadCatalog<CatalogCard>('pokemon') : Promise.resolve([]),
    wantJapanese ? loadCatalog<CatalogCard>('pokemon-jp') : Promise.resolve([]),
  ])
  const byId = { en: new Map(english.map((c) => [c.id, c])), ja: new Map(japanese.map((c) => [c.id, c])) }

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  for (const card of cards) {
    const cat = card.apiId ? byId[card.language === 'ja' ? 'ja' : 'en'].get(card.apiId) : undefined
    if (!cat) continue
    const price = catalogPrice('pokemon', cat, { isFoil: card.isFoil, edition: card.edition, finish: card.finish })
    if (price > 0) results[card.id] = price
  }

  return NextResponse.json(results)
}
