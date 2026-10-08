import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice } from '@/lib/pricing'

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

interface CardInput {
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
  const { cards }: { cards: CardInput[] } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('riftbound')
  const byId = new Map(catalog.map((c) => [c.id, c]))

  // Same rule every other price display uses (lib/pricing.ts), so this can never disagree with
  // the Cardex or Personalized Collections.
  const results: Record<string, number> = {}
  for (const card of cards) {
    const cat = card.apiId ? byId.get(card.apiId) : undefined
    if (!cat) continue
    const price = catalogPrice('riftbound', cat, { isFoil: (card as { isFoil?: boolean }).isFoil })
    if (price > 0) results[card.id] = price
  }

  return NextResponse.json(results)
}
