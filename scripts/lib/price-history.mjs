// Shared, catalog-level price history — ONE copy of each card's daily price for every user,
// instead of a history record per user per card (the old users/{uid}/priceHistory model).
//
// Storage: price_history/{game}/months/{setKey}__{YYYY-MM}
//   { game, setKey, month: 'YYYY-MM', days: { 'DD': '<json string>' } }
// where each day's string is JSON { t: ISO time of the sync, p: { [catalogId]: [m, mf, l, lf] } }
// — marketPrice, marketPriceFoil, lowPriceNM, lowPriceNMFoil. Grouping by set + month keeps every
// doc comfortably under Firestore's 1MiB limit (a ~350-card set × 31 days ≈ 0.5MB) while a
// whole month of a set is one read. Each sync overwrites its own day, so a day holds that day's
// latest prices.
//
// Plain .mjs (not TS) so both the Node sync script (scripts/lib/catalog-sync.mjs) and the Next.js
// server (lib/api/priceHistory.ts) share this exact format.

export const PRICE_HISTORY_COLLECTION = 'price_history'

// Which set a catalog card's history is filed under. Every game's catalog card carries at least
// one of these (Riftbound: setCode; Pokémon/Lorcana/One Piece/MTG: set); setName is a fallback.
export function setKeyOf(card) {
  const raw = String(card.setCode || card.set || card.setName || 'unknown')
  // Firestore doc ids can't contain '/', and keep them short and predictable.
  return raw.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80) || 'unknown'
}

export function monthDocId(setKey, month) {
  return `${setKey}__${month}`
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// [m, mf, l, lf] for a catalog card, or null if it has no price at all (nothing worth storing).
export function priceTuple(card) {
  const t = [round2(card.marketPrice), round2(card.marketPriceFoil), round2(card.lowPriceNM), round2(card.lowPriceNMFoil)]
  return t.some((v) => v > 0) ? t : null
}

export function tupleToFields(t) {
  return { marketPrice: t[0] || 0, marketPriceFoil: t[1] || 0, lowPriceNM: t[2] || 0, lowPriceNMFoil: t[3] || 0 }
}

// Groups a game's catalog cards into this sync's month-doc writes:
// Map<docId, { setKey, month, day, value }>.
export function buildDailyEntries(cards, when = new Date()) {
  const iso = when.toISOString()
  const month = iso.slice(0, 7)
  const day = iso.slice(8, 10)
  const bySet = new Map()
  for (const card of cards) {
    const tuple = priceTuple(card)
    if (!tuple) continue
    const key = setKeyOf(card)
    if (!bySet.has(key)) bySet.set(key, {})
    bySet.get(key)[card.id] = tuple
  }
  const out = new Map()
  for (const [setKey, prices] of bySet) {
    out.set(monthDocId(setKey, month), { setKey, month, day, value: JSON.stringify({ t: iso, p: prices }) })
  }
  return out
}
