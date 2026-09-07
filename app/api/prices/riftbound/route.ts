import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'

interface CatalogCard {
  id: string
  rarity: string
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
  const { cards, priceMode = 'market' }: { cards: CardInput[]; priceMode?: string } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('riftbound')
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const useLowestNM = priceMode === 'lowestNM'

  const results: Record<string, number> = {}
  for (const { id, apiId, isFoil } of cards) {
    const cat = byId.get(apiId)
    if (!cat) continue

    const isShowcaseOrStar = cat.rarity === 'Alt Art' || cat.rarity === 'Overnumbered' || cat.rarity === 'Showcase' || cat.id.includes('-star-')

    const price = useLowestNM
      ? (isShowcaseOrStar
          ? (cat.lowPriceNM || cat.lowPriceNMFoil)
          : (isFoil ? (cat.lowPriceNMFoil || cat.lowPriceNM) : (cat.lowPriceNM || cat.lowPriceNMFoil)))
      : (isShowcaseOrStar
          ? (cat.marketPrice || cat.marketPriceFoil)
          : (isFoil ? (cat.marketPriceFoil || cat.marketPrice) : (cat.marketPrice || cat.marketPriceFoil)))

    if (price > 0) results[id] = price
  }

  return NextResponse.json(results)
}
