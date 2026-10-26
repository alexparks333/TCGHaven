import type { Game, Edition, Finish } from './types'
import { riftboundVariantFlags } from './utils'
import { variantPrice } from '@/scripts/lib/pokemon-variants.mjs'

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
  variantPrices?: Record<string, number>  // Pokémon: every edition × finish — scripts/lib/pokemon-variants.mjs
}

export interface PrintingChoice {
  isFoil?: boolean
  edition?: Edition   // Pokémon only — Unlimited / Shadowless / 1st Edition
  finish?: Finish     // Pokémon only — Normal / Holo / Reverse Holo
}

export function catalogPrice(
  game: Game,
  card: CatalogPriceFields,
  { isFoil = false, edition, finish }: PrintingChoice = {},
): number {
  // A Pokémon card added with an explicit edition/finish is priced as exactly that printing.
  if (game === 'pokemon' && (edition || finish)) {
    const vp = card.variantPrices
    if (vp && Object.keys(vp).length) return variantPrice(vp, { edition, finish, isFoil })
    // No per-printing prices (a backup-priced card, or a history day from before editions were
    // tracked): another edition's price is unknown — never fall back to a different printing's —
    // and Unlimited is the classic pair below.
    if (edition && edition !== 'unlimited') return 0
    if (finish) isFoil = finish !== 'normal'
  }

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
