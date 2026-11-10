import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice } from '@/lib/pricing'
import type { Edition, Finish } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface CardInput {
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
  const { cards }: { cards: CardInput[] } = await req.json()
  if (!cards.length) return NextResponse.json({})
  const catalog = await loadCatalog<CatalogCard>('yugioh')
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const results: Record<string, number> = {}
  for (const card of cards) {
    const cat = card.apiId ? byId.get(card.apiId) : undefined
    if (!cat) continue
    const price = catalogPrice('yugioh', cat, { isFoil: card.isFoil, edition: card.edition, finish: card.finish })
    if (price > 0) results[card.id] = price
  }
  return NextResponse.json(results)
}
