// Pokémon printings: edition (Unlimited / Shadowless / 1st Edition) × finish (Normal / Holo /
// Reverse Holo). TCGplayer prices each of these separately ("1st Edition Holofoil", "Unlimited",
// "Reverse Holofoil", ...), so a catalog card carries every one it has in `variantPrices`, keyed
// `${edition}:${finish}` — e.g. Jungle Snorlax:
//   { 'unlimited:holofoil': 164.03, '1st:holofoil': 445.14 }
//
// Before this, the sync only understood "Normal"/"Holofoil"/"Reverse Holofoil" and let whichever
// edition row came first fill the regular price — every WotC-era card (Jungle, Fossil, Team
// Rocket, Gym, Neo, Base Set Shadowless …) showed its 1st Edition price as the card's price.
//
// Plain .mjs (like price-history.mjs) so the sync script and the Next.js app share one copy:
// scripts/lib/catalog-sync.mjs builds the prices, lib/pricing.ts reads them.

export const EDITIONS = ['unlimited', 'shadowless', '1st']   // also the default-edition order
export const FINISHES = ['normal', 'holofoil', 'reverse']

export const EDITION_LABELS = { unlimited: 'Unlimited', shadowless: 'Shadowless', '1st': '1st Edition' }
export const FINISH_LABELS = { normal: 'Normal', holofoil: 'Holo', reverse: 'Reverse Holo' }

export function variantKey(edition, finish) {
  return `${edition}:${finish}`
}

// TCGplayer groups whose edition subtypes mean something other than their names. "Base Set
// (Shadowless)" holds both of Base Set's early print runs: its "1st Edition" rows are 1st Edition,
// and its "Unlimited" rows are the Shadowless print (Base Set Unlimited is its own group, "Base
// Set"). Keyed by exact TCGplayer group name, per language category.
export const EDITION_GROUPS = {
  'Base Set (Shadowless)': { setId: 'base1', unlimitedIs: 'shadowless' },
}

/**
 * TCGplayer subTypeName → { edition, finish }, or null for a row that isn't a priced printing.
 * Rows with no subtype at all ('') are kept as a weak "normal" — the old sync's behavior for
 * them — only used when nothing better prices that card.
 */
export function classifySubtype(subTypeName, { unlimitedIs = 'unlimited' } = {}) {
  const sub = String(subTypeName ?? '').trim()
  if (!sub) return { edition: 'unlimited', finish: 'normal', weak: true }
  const lower = sub.toLowerCase()
  let edition = 'unlimited'
  if (lower.startsWith('1st edition')) edition = '1st'
  else if (lower.startsWith('unlimited')) edition = unlimitedIs
  const finish = lower.includes('reverse') ? 'reverse' : (lower.includes('holo') || lower.includes('foil')) ? 'holofoil' : 'normal'
  return { edition, finish, weak: false }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Accumulator for one card's TCGplayer rows. TCGplayer files variants under the card's own
 * number — "Charizard (Black Dot Error)" shares 004/102 with Charizard, as do stamped/staff/
 * prerelease copies. The plain-named product is the card itself: once it has set a price for a
 * printing, a "(...)" variant row never overwrites it.
 */
export function newPriceEntry() {
  return { market: {}, low: {}, plain: new Set(), weak: { market: 0, low: 0 } }
}

export function addPriceRow(entry, row, opts = {}) {
  const v = classifySubtype(row.subTypeName, opts)
  if (!v) return
  const price = parseFloat(row.marketPrice) || parseFloat(row.midPrice) || 0
  const low = parseFloat(row.lowPrice) || 0
  if (v.weak) {
    if (price > 0 && !entry.weak.market) entry.weak.market = price
    if (low > 0 && !entry.weak.low) entry.weak.low = low
    return
  }
  const key = variantKey(v.edition, v.finish)
  const isVariantProduct = /\(/.test(row.name ?? '')
  if (isVariantProduct && entry.plain.has(key)) return
  if (!isVariantProduct && price > 0) entry.plain.add(key)
  if (price > 0) entry.market[key] = price
  if (low > 0) entry.low[key] = low
}

/** Every priced printing, `${edition}:${finish}` → price. */
export function entryVariantPrices(entry) {
  const out = {}
  for (const [k, v] of Object.entries(entry.market)) if (v > 0) out[k] = round2(v)
  if (!Object.keys(out).length && entry.weak.market > 0) out[variantKey('unlimited', 'normal')] = round2(entry.weak.market)
  return out
}

/** @param {Record<string, number> | undefined} vp @returns {string[]} */
export function editionsOf(vp) {
  if (!vp) return []
  return EDITIONS.filter((e) => FINISHES.some((f) => (vp[variantKey(e, f)] ?? 0) > 0))
}

/** @param {Record<string, number> | undefined} vp @param {string} edition @returns {string[]} */
export function finishesOf(vp, edition) {
  if (!vp) return []
  return FINISHES.filter((f) => (vp[variantKey(edition, f)] ?? 0) > 0)
}

/**
 * Unlimited when it's priced (what most copies are), else the first edition that is.
 * @param {Record<string, number> | undefined} vp @returns {string}
 */
export function defaultEdition(vp) {
  return editionsOf(vp)[0] ?? 'unlimited'
}

/**
 * The finish a plain / foil copy most likely is, among those priced for `edition`.
 * @param {Record<string, number> | undefined} vp @param {string} edition @param {boolean} [isFoil]
 * @returns {string}
 */
export function defaultFinish(vp, edition, isFoil = false) {
  const order = isFoil ? ['holofoil', 'reverse', 'normal'] : ['normal', 'holofoil', 'reverse']
  const have = finishesOf(vp, edition)
  return order.find((f) => have.includes(f)) ?? (isFoil ? 'holofoil' : 'normal')
}

/**
 * Price of one printing; 0 if TCGplayer has no market price for it.
 * @param {Record<string, number> | undefined} vp
 * @param {{ edition?: string, finish?: string, isFoil?: boolean }} [choice]
 * @returns {number}
 */
export function variantPrice(vp, { edition, finish, isFoil = false } = {}) {
  if (!vp) return 0
  const e = edition || defaultEdition(vp)
  const f = finish || defaultFinish(vp, e, isFoil)
  return vp[variantKey(e, f)] ?? 0
}

/**
 * The catalog's classic price fields, for the default edition — what every card without a chosen
 * edition/finish is priced by (all inventory added before editions existed). Same shape as the
 * pre-edition sync: regular = normal, else holo; foil = holo, else reverse.
 */
export function legacyFields(entry) {
  const vp = entryVariantPrices(entry)
  const e = defaultEdition(vp)
  const m = (f) => entry.market[variantKey(e, f)] ?? 0
  const l = (f) => entry.low[variantKey(e, f)] ?? 0
  const weakM = Object.keys(entry.market).length ? 0 : entry.weak.market
  const weakL = Object.keys(entry.low).length ? 0 : entry.weak.low
  return {
    variantPrices: vp,
    marketPrice: round2(m('normal') || m('holofoil') || weakM),
    marketPriceFoil: round2(m('holofoil') || m('reverse')),
    lowPriceNM: round2(l('normal') || l('holofoil') || weakL),
    lowPriceNMFoil: round2(l('holofoil') || l('reverse')),
  }
}

/**
 * Whether price history must keep this card's full printing prices: only when the classic
 * [regular, foil] pair can't express a printing someone might own — another edition exists, or a
 * reverse holo sits alongside a holo (the foil slot only has room for one of them). Keeps the
 * shared history docs small (the vast majority of cards need nothing extra).
 */
export function historyNeedsVariants(vp) {
  if (!vp) return false
  if (editionsOf(vp).some((e) => e !== 'unlimited')) return true
  return (vp[variantKey('unlimited', 'holofoil')] ?? 0) > 0 && (vp[variantKey('unlimited', 'reverse')] ?? 0) > 0
}
