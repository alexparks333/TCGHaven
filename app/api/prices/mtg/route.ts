import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice, type PriceMode } from '@/lib/pricing'

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

// Reads prices straight from the catalog (kept fresh by the 6-hourly cron — see CLAUDE.md "Price
// Data") rather than hitting api.scryfall.com live on every Portfolio refresh. Same shape as
// Lorcana's price route: one market price per printing per finish, no per-set group-ID bootstrap.
export async function POST(req: NextRequest) {
  const { cards, priceMode = 'market' }: { cards: CardInput[]; priceMode?: PriceMode } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('mtg')
  const byId = new Map(catalog.map((c) => [c.id, c]))

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  for (const card of cards) {
    const cat = card.apiId ? byId.get(card.apiId) : undefined
    if (!cat) continue
    const price = catalogPrice('mtg', cat, { isFoil: (card as { isFoil?: boolean }).isFoil, priceMode })
    if (price > 0) results[card.id] = price
  }

  return NextResponse.json(results)
}
