import type { Game } from './types'
import { riftboundVariantFlags } from './utils'

// THE one rule for "what is this card worth" — used by every place a price is shown, so the
// Cardex, Personalized Collections, Inventory and Portfolio can never disagree:
//  - app/api/prices/{game}/route.ts (the live price PriceAutoUpdater lays over users' cards)
//  - CardexPage.tsx (catalog grid + zoom view, computed client-side from the catalog fields
//    /api/cardex returns)
//  - PersonalCollectionsView.tsx (via the same price routes)
//  - app/api/price-history (shared history)
// Every input is a catalog card's own price fields, refreshed 4x a day by the scheduled sync.
// There's one price per card — TCGplayer market price — no user-selectable price mode.

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
  { isFoil = false }: { isFoil?: boolean } = {},
): number {
  // One Piece has no foil duality (a Parallel print is its own catalog card) and no
  // lowest-listing field — just the one market price.
  if (game === 'onepiece') return card.marketPrice ?? 0

  // Always TCGplayer's market price (what copies actually sell for). The catalog's lowPriceNM*
  // fields are NOT near-mint despite the name — they're TCGCSV's lowest listing in ANY condition
  // (damaged/heavily played included), which once showed a damaged copy's price as a card's
  // value. They're deliberately never used for pricing.
  const base = card.marketPrice ?? 0
  const foil = card.marketPriceFoil ?? 0

  if (game === 'riftbound') {
    // Alt Art and Star (Signature) are foil-only and Overnumbered has a single price point —
    // there's no real foil/non-foil choice, and their one price can sit in either field
    // depending on the sync, so take whichever is set.
    const { isStar, isOvernumber, isAltArtShowcase } = riftboundVariantFlags(card.rarity ?? '', card.publicCode)
    if (isStar || isOvernumber || isAltArtShowcase) return base || foil
  }

  return isFoil ? (foil || base) : (base || foil)
}
