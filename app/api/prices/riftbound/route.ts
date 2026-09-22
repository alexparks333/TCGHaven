import { NextRequest, NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/api/catalog'
import { riftboundVariantFlags } from '@/lib/utils'

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
  const { cards, priceMode = 'market' }: { cards: CardInput[]; priceMode?: string } = await req.json()
  if (!cards.length) return NextResponse.json({})

  const catalog = await loadCatalog<CatalogCard>('riftbound')
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const useLowestNM = priceMode === 'lowestNM'

  const results: Record<string, number> = {}
  for (const { id, apiId, isFoil } of cards) {
    const cat = byId.get(apiId)
    if (!cat) continue

    // Use the shared classifier (lib/utils.ts) instead of reimplementing it here — this file used
    // to have its own drifted copy that (a) lumped Overnumbered in with the foil-locked variants,
    // which is wrong (Overnumbered prints like a regular card, see riftboundInherentFoil's own
    // doc comment) and (b) detected Star via a fragile `id.includes('-star-')` string check
    // instead of the `rarity`/`publicCode` fields every other consumer keys off of.
    const { isStar, isOvernumber, isAltArtShowcase } = riftboundVariantFlags(cat.rarity, cat.publicCode)
    // Star and Alt Art are foil-only — their one real price landed in marketPrice/lowPriceNM at
    // sync time (see downloadRiftbound() in catalog-sync.mjs), not the *Foil fields. Overnumbered
    // has just one real (non-foil) price point too. For all three, `isFoil` isn't a real choice —
    // reading marketPrice first (falling back to marketPriceFoil only if empty) gets the right
    // value regardless of which field it happened to land in.
    const noFoilChoice = isStar || isOvernumber || isAltArtShowcase

    const price = useLowestNM
      ? (noFoilChoice
          ? (cat.lowPriceNM || cat.lowPriceNMFoil)
          : (isFoil ? (cat.lowPriceNMFoil || cat.lowPriceNM) : (cat.lowPriceNM || cat.lowPriceNMFoil)))
      : (noFoilChoice
          ? (cat.marketPrice || cat.marketPriceFoil)
          : (isFoil ? (cat.marketPriceFoil || cat.marketPrice) : (cat.marketPrice || cat.marketPriceFoil)))

    if (price > 0) results[id] = price
  }

  return NextResponse.json(results)
}
