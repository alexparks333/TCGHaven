import { hasPrintings, CONDITION_MULTIPLIER, type Game, type Edition, type Finish, type Condition } from './types'
import { riftboundVariantFlags } from './utils'
import { variantPrice } from '@/scripts/lib/pokemon-variants.mjs'
import { gradedPriceFor, gradedVariantKey } from '@/scripts/lib/pricecharting.mjs'

// THE pricing rules — two kinds of price, two functions, so a caller always says which it means:
//
//  1. nearMintPrice(game, card, printing) — what a CARD is worth: TCGplayer's (Near Mint) market
//     price for a printing. Only for showing a card nobody's copy is being valued: the Cardex grid
//     (and its hover), a wall note's card.
//  2. copyPrice(game, card, copy) — what a COPY someone owns is worth (one copy, one price):
//       a slab → PriceCharting's sold price for its grade and version (docs/PriceCharting.md),
//                or the Near Mint price when there isn't one ("Raw est." in the UI);
//       raw    → the Near Mint price × its condition's discount (CONDITION_MULTIPLIER).
//     `copy` must state both `condition` and `grading` (either may be undefined) — so no caller
//     can value a copy and forget its condition or grade. Used by the price routes
//     (app/api/prices/*, lib/api/tcgplayerGameRoutes.ts) and price history (lib/api/priceHistory.ts);
//     Inventory, Portfolio, Analytics, profiles, the Cardex zoom, Add Card all get their prices
//     from those.
//
// Stored data is only what the sources give: TCGplayer's Near Mint prices on the catalog cards,
// PriceCharting's graded prices in graded_prices/{catalog}. Condition prices are never stored —
// they're computed here, so they can't drift. Prices refresh twice a day (catalog) / daily (graded).

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
  /** The card's other versions PriceCharting prices separately ("[Foil]", "[1st Edition]" …):
   *  version → its graded prices and page. gradedVariantKey() picks which one a copy uses. */
  gradedVariants?: Record<string, { p: Record<string, number>; u?: string }>
}

/** A slab, as the user logged it (Card.gradingCompany / grade / gradeTier) */
export interface GradingChoice {
  company?: string
  grade?: string
  tier?: 'pristine' | 'black' | null
}

/** Which printing of a card (the parts of a copy that pick a TCGplayer price) */
export interface Printing {
  isFoil?: boolean
  edition?: Edition
  finish?: Finish
}

/** A copy someone owns, for copyPrice(): its printing plus — always stated, even when undefined —
 *  its condition and its slab */
export interface CopyChoice extends Printing {
  condition: Condition | undefined          // a raw copy's condition (undefined = Near Mint)
  grading: GradingChoice | undefined        // a slab's grade (undefined = raw) — gradingOf(card)
}

export interface PrintingChoice {
  isFoil?: boolean
  edition?: Edition   // Pokémon: Unlimited / Shadowless / 1st Edition; Yu-Gi-Oh!: 1st Edition / Unlimited / Limited; Flesh and Blood: 1st Edition / Unlimited
  finish?: Finish     // Pokémon: Normal / Holo / Reverse Holo; Flesh and Blood: Normal / Rainbow Foil / Cold Foil
  grading?: GradingChoice  // a graded card: priced from PriceCharting's sales for its grade when there are any
  condition?: Condition    // a raw copy's condition — its price is the Near Mint price × its discount
}

/** A raw copy's share of the Near Mint price: 1 for Near Mint / Mint, a slab, or no condition */
export function conditionFactor(card: { condition?: Condition | string | null; gradingCompany?: string | null }): number {
  if (card.gradingCompany) return 1
  return CONDITION_MULTIPLIER[card.condition as Condition] ?? 1
}

/** A Near Mint price as this copy's condition is worth (rounded to the cent) */
export function conditionPrice(nmPrice: number, card: { condition?: Condition | string | null; gradingCompany?: string | null }): number {
  const f = conditionFactor(card)
  return f === 1 || !(nmPrice > 0) ? nmPrice : Math.round(nmPrice * f * 100) / 100
}

/** The grading part of a card as the price routes receive it, for PrintingChoice.grading */
export function gradingOf(card: { gradingCompany?: string; grade?: string; gradeTier?: 'pristine' | 'black' | null }): GradingChoice | undefined {
  return card.gradingCompany ? { company: card.gradingCompany, grade: card.grade, tier: card.gradeTier ?? null } : undefined
}

/** A graded card's PriceCharting price, or 0 → the raw price is used (shown as "raw est."). Pokémon's
 *  graded prices are for the card's ordinary printing — a 1st Edition / Shadowless / Reverse Holo
 *  slab never gets them (PriceCharting lists those as separate products). */
export function gradedPrice(_game: Game, card: CatalogPriceFields, { isFoil, edition, finish, grading }: PrintingChoice = {}): number {
  if (!grading?.company || !card.graded) return 0
  const key = gradedVariantKey({ isFoil, edition, finish }, card.gradedVariants)
  if (key === null) return 0
  return gradedPriceFor(key ? card.gradedVariants?.[key]?.p : card.graded, grading)
}

/** What a copy someone owns is worth — see the rules at the top of this file */
export function copyPrice(game: Game, card: CatalogPriceFields, copy: CopyChoice): number {
  // A slab: its grade's sold price from PriceCharting when there is one; otherwise the raw Near
  // Mint price (an estimate — the UI says "Raw est."). A raw copy: Near Mint × its condition.
  if (copy.grading?.company) {
    const graded = gradedPrice(game, card, copy)
    return graded > 0 ? graded : nearMintPrice(game, card, copy)
  }
  return conditionPrice(nearMintPrice(game, card, copy), { condition: copy.condition })
}

/** What a card is worth: TCGplayer's (Near Mint) market price for a printing. Never a copy's value
 *  — that's copyPrice() (its condition and grade change it). */
export function nearMintPrice(game: Game, card: CatalogPriceFields, { isFoil = false, edition, finish }: Printing = {}): number {

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
