// Shared, catalog-level price history — ONE copy of each card's daily price for every user,
// instead of a history record per user per card (the old users/{uid}/priceHistory model).
//
// Storage: price_history/{game}/months/{setKey}__{YYYY-MM}
//   { game, setKey, month: 'YYYY-MM', days: { 'DD': '<json string>' } }
// where each day's string is JSON { t: ISO time of the sync, p: { [catalogId]: [m, mf, l, lf, v?] } }
// — marketPrice, marketPriceFoil, lowPriceNM, lowPriceNMFoil, and for the few Pokémon cards whose
// printings those four can't express (other editions, or a holo + reverse holo pair) their full
// `variantPrices` (pokemon-variants.mjs) as a 5th element. Grouping by set + month keeps every
// doc comfortably under Firestore's 1MiB limit (a ~350-card set × 31 days ≈ 0.5MB) while a
// whole month of a set is one read. Each sync overwrites its own day, so a day holds that day's
// latest prices.
//
// Plain .mjs (not TS) so both the Node sync script (scripts/lib/catalog-sync.mjs) and the Next.js
// server (lib/api/priceHistory.ts) share this exact format.

import { historyNeedsVariants } from './pokemon-variants.mjs'

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

// [m, mf, l, lf(, v)] for a catalog card, or null if it has no price at all (nothing worth storing).
export function priceTuple(card) {
  const t = [round2(card.marketPrice), round2(card.marketPriceFoil), round2(card.lowPriceNM), round2(card.lowPriceNMFoil)]
  if (!t.some((v) => v > 0)) return null
  if (historyNeedsVariants(card.variantPrices)) t.push(card.variantPrices)
  return t
}

export function tupleToFields(t) {
  const fields = { marketPrice: t[0] || 0, marketPriceFoil: t[1] || 0, lowPriceNM: t[2] || 0, lowPriceNMFoil: t[3] || 0 }
  if (t[4] && typeof t[4] === 'object') fields.variantPrices = t[4]
  return fields
}

// The tuple a card's history records, or null if it records nothing. Cardmarket estimates (EUR →
// USD backup prices, price-fallback.mjs) stay out of history: exchange-rate moves would show up
// as fake price changes.
function historyTuple(card) {
  return card.priceSource === 'cardmarket' ? null : priceTuple(card)
}

// Groups a game's catalog cards into this sync's month-doc writes:
// Map<docId, { setKey, month, day, value }>.
export function buildDailyEntries(cards, when = new Date()) {
  const iso = when.toISOString()
  const month = iso.slice(0, 7)
  const day = iso.slice(8, 10)
  const bySet = new Map()
  for (const card of cards) {
    const tuple = historyTuple(card)
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

// ── Daily closes ────────────────────────────────────────────────────────────────────────────────
// The month docs above hold a set's whole month — right for one card's chart, but Portfolio only
// needs every card's price on four days (24h / 7d / 30d / 1y ago), and reading those from month
// docs meant 13 months of every owned set. So each sync also writes the whole game's prices for
// the day as one compressed file:
//
//   price_history/{game}/days/{YYYY-MM-DD}__{n} = { day, t, chunk: n, of, gz: Bytes }
//
// gz = gzipped JSON { [catalogId]: tuple } (the same tuple as the month docs), split into chunks
// under Firestore's 1MiB doc limit (MTG needs 2; every other game 1). Each sync overwrites today's;
// once the UTC day is over a day's file never changes, so a server keeps it in memory for good.
//
//   price_history/{game}/firsts/{n} = { t, chunk: n, of, gz: Bytes }
//
// Each card's first recorded price (per field: the first non-zero one) — the Analytics fallback
// cost basis for cards added without a price. Rewritten only when a new card or price shows up.

export const DAYS_COLLECTION = 'days'
export const FIRSTS_COLLECTION = 'firsts'
const MAX_CHUNK_BYTES = 800_000 // compressed; Firestore's limit is 1MiB per doc

export function dayDocId(day, n) {
  return `${day}__${n}`
}

/** This sync's day file contents: { day: 'YYYY-MM-DD', t: ISO time, prices: { [id]: tuple } }. */
export function buildDayPrices(cards, when = new Date()) {
  const t = when.toISOString()
  const prices = {}
  for (const card of cards) {
    const tuple = historyTuple(card)
    if (tuple) prices[card.id] = tuple
  }
  return { day: t.slice(0, 10), t, prices }
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** { [id]: tuple } → gzipped chunks, each under MAX_CHUNK_BYTES. */
export async function encodePriceMap(prices) {
  const out = []
  async function add(entries) {
    const gz = await gzip(JSON.stringify(Object.fromEntries(entries)))
    if (gz.length > MAX_CHUNK_BYTES && entries.length > 1) {
      const mid = Math.ceil(entries.length / 2)
      await add(entries.slice(0, mid))
      await add(entries.slice(mid))
    } else {
      out.push(gz)
    }
  }
  await add(Object.entries(prices))
  return out
}

/**
 * The chunk docs' data → { t, prices }, or null if they aren't one complete write (same `of`,
 * same `t`, every chunk present). Leftover chunks from an older, larger write are ignored.
 * `bytesOf` turns a doc's `gz` field into a Uint8Array (Firestore `Bytes` → `.toUint8Array()`).
 */
export async function decodePriceChunks(datas, bytesOf = (gz) => gz.toUint8Array()) {
  if (!datas.length) return null
  const sorted = [...datas].sort((a, b) => a.chunk - b.chunk)
  const { of, t } = sorted[0]
  const set = sorted.filter((d) => d.of === of && d.t === t && d.chunk < of)
  if (set.length !== of || set.some((d, i) => d.chunk !== i)) return null
  const parts = await Promise.all(set.map(async (d) => JSON.parse(await gunzip(bytesOf(d.gz)))))
  return { t, prices: Object.assign({}, ...parts) }
}

/**
 * Folds a day's prices into the firsts map (mutates `firsts`): a new card gets its tuple, and a
 * field still 0 (say, no foil price yet) takes the first non-zero value seen. Variant prices are
 * kept from the first time they appear. Returns whether anything changed.
 */
export function mergeFirsts(firsts, prices) {
  let changed = false
  for (const [id, tuple] of Object.entries(prices)) {
    const cur = firsts[id]
    if (!cur) { firsts[id] = [...tuple]; changed = true; continue }
    for (let i = 0; i < 4; i++) {
      if (!(cur[i] > 0) && tuple[i] > 0) { cur[i] = tuple[i]; changed = true }
    }
    if (!cur[4] && tuple[4]) { cur[4] = tuple[4]; changed = true }
  }
  return changed
}
