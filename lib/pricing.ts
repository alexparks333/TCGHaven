import { hasPrintings, type Game, type Edition, type Finish } from './types'
import { riftboundVariantFlags } from './utils'
import { variantPrice } from '@/scripts/lib/pokemon-variants.mjs'
import { gradedPriceFor } from '@/scripts/lib/pricecharting.mjs'

// THE one rule for "what is this card worth" — used by every place a price is shown, so the
// Cardex, Personalized Collections, Inventory and Portfolio can never disagree:
//  - app/api/prices/{game}/route.ts (the live price PriceAutoUpdater lays over users' cards)
//  - CardexPage.tsx (catalog grid + zoom view, computed client-side from the catalog fields
//    /api/cardex returns)
//  - PersonalCollectionsView.tsx (via the same price routes)
//  - app/api/price-history (shared history)
// Every input is a catalog card's own price fields, refreshed twice a day by the scheduled sync.
// There's one price per card — TCGplayer market price — no user-selectable price mode. A graded
// card can instead get PriceCharting's sold price for its grade (docs/PriceCharting.md).

export interface CatalogPriceFields {
  marketPrice?: number
  marketPriceFoil?: number
  lowPriceNM?: number
  lowPriceNMFoil?: number
  rarity?: string
  publicCode?: string
  variantPrices?: Record<string, number>  // Pokémon: every edition × finish — scripts/lib/pokemon-variants.mjs
  /** PriceCharting graded sold prices (psa10, g9 …) — laid on by the price routes from
   *  graded_prices/{key} (lib/api/gradedPrices.ts), never stored on the catalog card itself */
  graded?: Record<string, number>
}

/** A slab, as the user logged it (Card.gradingCompany / grade / gradeTier) */
export interface GradingChoice {
  company?: string
  grade?: string
  tier?: 'pristine' | 'black' | null
}

export interface PrintingChoice {
  isFoil?: boolean
  edition?: Edition   // Pokémon: Unlimited / Shadowless / 1st Edition; Yu-Gi-Oh!: 1st Edition / Unlimited / Limited; Flesh and Blood: 1st Edition / Unlimited
  finish?: Finish     // Pokémon: Normal / Holo / Reverse Holo; Flesh and Blood: Normal / Rainbow Foil / Cold Foil
  grading?: GradingChoice  // a graded card: priced from PriceCharting's sales for its grade when there are any
}

/** The grading part of a card as the price routes receive it, for PrintingChoice.grading */
export function gradingOf(card: { gradingCompany?: string; grade?: string; gradeTier?: 'pristine' | 'black' | null }): GradingChoice | undefined {
  return card.gradingCompany ? { company: card.gradingCompany, grade: card.grade, tier: card.gradeTier ?? null } : undefined
}

/** A graded card's PriceCharting price, or 0 → the raw price is used (shown as "raw est."). Pokémon's
 *  graded prices are for the card's ordinary printing — a 1st Edition / Shadowless / Reverse Holo
 *  slab never gets them (PriceCharting lists those as separate products). */
export function gradedPrice(game: Game, card: CatalogPriceFields, { edition, finish, grading }: PrintingChoice = {}): number {
  if (!grading?.company || !card.graded) return 0
  if (game === 'pokemon' && ((edition && edition !== 'unlimited') || finish === 'reverse')) return 0
  return gradedPriceFor(card.graded, grading)
}

export function catalogPrice(
  game: Game,
  card: CatalogPriceFields,
  { isFoil = false, edition, finish, grading }: PrintingChoice = {},
): number {
  // A graded card: its grade's sold price from PriceCharting when there is one; otherwise the raw
  // price below (an estimate for a slab — the UI says so).
  const graded = gradedPrice(game, card, { edition, finish, grading })
  if (graded > 0) return graded

  // A card added with an explicit edition/finish (Pokémon, Yu-Gi-Oh!) is priced as exactly that printing.
  if (hasPrintings(game) && (edition || finish)) {
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
  // (Star Wars: Unlimited, Gundam, Digimon and Palworld use the Normal / Foil pair below, like
  // Lorcana; a Flesh and Blood card without a chosen printing falls through to it too.)
  // Yu-Gi-Oh! has no foil toggle (foil is the rarity, and a rarity version is its own card): the
  // default printing's market price
  if (game === 'yugioh') return card.marketPrice ?? 0

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
