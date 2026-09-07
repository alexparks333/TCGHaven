import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'

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
  const { cards }: { cards: CardInput[] } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('mtg')
  const byId = new Map(catalog.map((c) => [c.id, c]))

  const results: Record<string, number> = {}
  for (const { id, apiId, isFoil } of cards) {
    if (!apiId) continue
    const cat = byId.get(apiId)
    if (!cat) continue
    const price = isFoil ? (cat.marketPriceFoil || cat.marketPrice) : (cat.marketPrice || cat.marketPriceFoil)
    if (price > 0) results[id] = price
  }

  return NextResponse.json(results)
}
