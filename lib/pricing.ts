import type { Game } from './types'
import { riftboundVariantFlags } from './utils'

// THE one rule for "what is this card worth" — used by every place a price is shown, so the
// Cardex, Personalized Collections, Inventory and Portfolio can never disagree:
//  - app/api/prices/{game}/route.ts (what PriceAutoUpdater copies onto users' cards)
//  - CardexPage.tsx (catalog grid + zoom view, computed client-side from the catalog fields
//    /api/cardex returns)
//  - PersonalCollectionsView.tsx (via the same price routes)
// Every input is a catalog card's own price fields, refreshed 4x a day by the scheduled sync.

export type PriceMode = 'market' | 'lowestNM'

export interface CatalogPriceFields {
  marketPrice?: number
  marketPriceFoil?: number
  lowPriceNM?: number
  lowPriceNMFoil?: number
  rarity?: string
  publicCode?: string
}

export function catalogPrice(
  game: Game,
  card: CatalogPriceFields,
  { isFoil = false, priceMode = 'market' }: { isFoil?: boolean; priceMode?: PriceMode } = {},
): number {
  // One Piece has no foil duality (a Parallel print is its own catalog card) and no
  // lowest-listing field — just the one market price.
  if (game === 'onepiece') return card.marketPrice ?? 0

  // Only Pokémon and Riftbound catalogs carry a lowest-NM-listing price; Lorcana and MTG fall
  // back to market price in "Lowest NM" mode.
  const useLowest = priceMode === 'lowestNM' && (game === 'pokemon' || game === 'riftbound')
  const base = (useLowest ? card.lowPriceNM : card.marketPrice) ?? 0
  const foil = (useLowest ? card.lowPriceNMFoil : card.marketPriceFoil) ?? 0

  if (game === 'riftbound') {
    // Alt Art and Star (Signature) are foil-only and Overnumbered has a single price point —
    // there's no real foil/non-foil choice, and their one price can sit in either field
    // depending on the sync, so take whichever is set.
    const { isStar, isOvernumber, isAltArtShowcase } = riftboundVariantFlags(card.rarity ?? '', card.publicCode)
    if (isStar || isOvernumber || isAltArtShowcase) return base || foil
  }

  return isFoil ? (foil || base) : (base || foil)
}
