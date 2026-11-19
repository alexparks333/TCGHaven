// Graded price history — each day's PriceCharting graded prices, kept so a slab's value has a past
// like a raw card's (Portfolio's 24h / 7d / 30d / 1y windows, the Analytics chart, the card page's
// chart). Written by scripts/pricecharting-sync.mjs after each catalog's graded prices; read by
// lib/api/priceHistory.ts. Same layout as the raw history (price-history.mjs), under its own root:
//
//   graded_history/{catalog}/months/{setKey}__{YYYY-MM}
//     { setKey, month, days: { 'DD': Bytes } }   — Bytes = gzipped JSON { t, p: { [catalogId]: tuple } }
//   graded_history/{catalog}/days/{YYYY-MM-DD}__{n}
//     { day, t, chunk: n, of, gz: Bytes }          — the whole catalog's day, for Portfolio's windows
//
// A tuple is the card's graded prices in GRADED_ORDER, 0 where PriceCharting has none, trailing
// zeros dropped. Month days are gzipped (unlike the raw month docs): a big set's month of graded
// prices is over Firestore's 1MiB as plain JSON (measured 2026-11-18: Secret Lair ~1.7MB).
//
// Plain .mjs so the Node job and the Next.js server share the exact format.

import { GRADED_COLUMNS } from './pricecharting.mjs'
import { setKeyOf, monthDocId, gzip } from './price-history.mjs'

export const GRADED_HISTORY_COLLECTION = 'graded_history'

// The tuple's slot order. APPEND ONLY — stored history is read back with this order, so a key
// must never move or be removed; a new PriceCharting column goes on the end.
export const GRADED_ORDER = Object.values(GRADED_COLUMNS)

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** { psa10: 1025.01, g9: 310 } → [0, …, 310, …, 1025.01], or null when there's no price at all */
export function gradedTuple(prices) {
  const t = GRADED_ORDER.map((k) => round2(prices?.[k]))
  while (t.length && !(t[t.length - 1] > 0)) t.pop()
  return t.length ? t : null
}

/** The reverse: a stored tuple → { psa10: 1025.01, … } (zeros left out)
 *  @param {unknown} tuple
 *  @returns {Record<string, number>} */
export function tupleToGraded(tuple) {
  const out = {}
  if (!Array.isArray(tuple)) return out
  tuple.forEach((v, i) => { if (v > 0 && GRADED_ORDER[i]) out[GRADED_ORDER[i]] = v })
  return out
}

/**
 * One run's history writes for a catalog.
 * entries: matchCatalog()'s [{ id, p }]; cardsById: catalog id → card (for its set).
 * → { day: { day, t, prices }, months: Map<docId, { setKey, month, dd, gz }> }
 */
export async function buildGradedHistory(entries, cardsById, when = new Date()) {
  const t = when.toISOString()
  const month = t.slice(0, 7)
  const dd = t.slice(8, 10)
  const prices = {}
  const bySet = new Map()
  for (const e of entries) {
    const tuple = gradedTuple(e.p)
    if (!tuple) continue
    prices[e.id] = tuple
    const setKey = setKeyOf(cardsById.get(e.id) ?? {})
    if (!bySet.has(setKey)) bySet.set(setKey, {})
    bySet.get(setKey)[e.id] = tuple
  }
  const months = new Map()
  for (const [setKey, p] of bySet) {
    months.set(monthDocId(setKey, month), { setKey, month, dd, gz: await gzip(JSON.stringify({ t, p })) })
  }
  return { day: { day: t.slice(0, 10), t, prices }, months }
}
