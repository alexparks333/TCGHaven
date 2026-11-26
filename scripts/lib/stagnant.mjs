// Stagnant prices — catalog cards whose price nothing updates on its own (docs/catalog.md,
// "Stagnant prices"). Staff only: never shown to collectors. Shared by the staff portal's list
// (app/api/admin/catalog/stagnant), the Admin Catalog tag, the CLI an AI agent prices them with
// (scripts/stagnant-prices.mjs), and the sync's rules: keep a hand price, take PriceCharting's
// ungraded price when nothing else prices a card (catalog-sync.mjs syncToFirestore).
// Tests: npm run test:stagnant.
import { productIdOf } from './pricecharting.mjs'

/** Games left out of the stagnant check (2026-11-23, Owner): Magic's ~1,100 are mostly memorabilia
 *  with no market. */
export const STAGNANT_SKIP_GAMES = new Set(['mtg'])

/** The price fields a sync writes — a hand-set price (priceSource 'manual') owns all of them. */
export const PRICE_FIELDS = ['marketPrice', 'marketPriceFoil', 'lowPriceNM', 'lowPriceNMFoil', 'variantPrices']

/** Whether a card (as a sync built it) carries any price at all. */
export function hasPrice(card) {
  if (Number(card?.marketPrice) > 0 || Number(card?.marketPriceFoil) > 0) return true
  if (Number(card?.lowPriceNM) > 0 || Number(card?.lowPriceNMFoil) > 0) return true
  const v = card?.variantPrices
  return !!v && typeof v === 'object' && Object.values(v).some((p) => Number(p?.marketPrice ?? p) > 0)
}

/**
 * Why a card's price is stagnant, or null when something keeps it current.
 *  - 'hand-added': a card staff added by hand (source 'manual') that isn't linked to a TCGplayer
 *                  product — no sync prices it
 *  - 'manual':     priced by hand because its sync has no price for it (priceSource 'manual');
 *                  stays on the list so it's re-checked, until a live price turns up
 *  - 'no-price':   no price and no TCGplayer product to get one from
 * Not stagnant (live): hidden cards, cards priced by a sync, cards priced from PriceCharting's
 * ungraded price (priceSource 'pricecharting' — livePriceFromPriceCharting below), hand-added cards
 * linked to a TCGplayer product (hand-added-tcgplayer.mjs), and cards linked to a TCGplayer product
 * that just hasn't sold yet (the sync prices it when it does).
 */
export function stagnantReason(card) {
  if (!card || card.hidden) return null
  if (card.priceSource === 'pricecharting') return null
  if (card.source === 'manual') return Number(card.tcgProductId) > 0 ? null : 'hand-added'
  if (card.priceSource === 'manual') return 'manual'
  if (hasPrice(card)) return null
  if (productIdOf(card)) return null
  return 'no-price'
}

/** The cards PriceCharting's ungraded price may price: the stagnant ones, and those it already
 *  prices (so it keeps tracking them). Read by the daily PriceCharting job (pricecharting-sync.mjs). */
export const wantsPriceChartingPrice = (card) => stagnantReason(card) !== null || card?.priceSource === 'pricecharting'

/**
 * A sync's fresh card + PriceCharting's ungraded price for it (`pc` = { r, u } from
 * graded_prices/{catalog}.raw, or undefined — none today, or the doc couldn't be read). TCGplayer
 * always wins: only a fresh card with no price of its own takes PriceCharting's — as priceSource
 * 'pricecharting' with `pcUrl`, the citation link. A card PriceCharting priced before that has a
 * TCGplayer price now drops the source. One PriceCharting priced before that neither has a price
 * for today keeps its last PriceCharting price and citation together (returned without its price
 * fields, like keepHandPrice) — never $0 with no source, which lost it: a card with a TCGplayer
 * product and no price isn't stagnant, so PriceCharting stopped tracking it (wantsPriceChartingPrice).
 */
export function livePriceFromPriceCharting(existing, fresh, pc) {
  if (!hasPrice(fresh) && Number(pc?.r) > 0) {
    return { ...fresh, marketPrice: Number(pc.r), marketPriceFoil: 0, priceSource: 'pricecharting', pcUrl: String(pc.u ?? '') }
  }
  if (existing?.priceSource !== 'pricecharting') return fresh
  if (hasPrice(fresh)) return { ...fresh, priceSource: fresh.priceSource ?? '', pcUrl: '' }
  const out = { ...fresh }
  for (const k of [...PRICE_FIELDS, 'priceSource', 'pcUrl']) delete out[k]
  return out
}

/**
 * The sync's side: a fresh card from a sync, against the card in Firestore. When the Firestore card
 * was priced by hand and the sync still has no price, the sync leaves the price alone (returns the
 * fresh card without its price fields). When the sync now has a real price it takes over and the
 * card stops being hand-priced.
 */
export function keepHandPrice(existing, fresh) {
  if (existing?.priceSource !== 'manual') return fresh
  if (hasPrice(fresh)) return { ...fresh, priceSource: fresh.priceSource ?? '', manualPriceNote: '', manualPriceAt: '' }
  const out = { ...fresh }
  for (const k of [...PRICE_FIELDS, 'priceSource']) delete out[k]
  return out
}
