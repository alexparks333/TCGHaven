import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice } from '@/lib/pricing'
import type { Game } from '@/lib/types'
import { PRICE_HISTORY_COLLECTION, setKeyOf, monthDocId, tupleToFields } from '@/scripts/lib/price-history.mjs'

// Server-side reader for the shared price history (format: scripts/lib/price-history.mjs).
// Everything a page needs is computed here and only the answer is sent to the browser — a
// phone never downloads the raw history.
//

export interface HistoryItem {
  key: string       // the caller's id for this row (a user card id) — echoed back in results
  game: Game
  apiId: string     // catalog card id
  isFoil?: boolean
}

export interface PricePoint { date: string; price: number }

type DayEntry = { t: string; p: Record<string, number[]> }
type MonthDoc = Map<string, DayEntry>   // 'DD' -> that day's entry, parsed

// Per set: every month doc of that set from `fromMonth` on, cached in this server process. Since
// every user reads the same docs, Firestore reads are shared across all of them. The cache is
// refreshed every 15 minutes so a new sync's day shows up.
const SET_TTL_MS = 15 * 60 * 1000
const setCache = new Map<string, { fromMonth: string; months: Map<string, MonthDoc>; fetchedAt: number }>()

// ONE query per set for only the month docs that actually exist (doc ids are
// `{setKey}__{YYYY-MM}`, so a document-id range selects exactly that set's months), instead of a
// get() per set per month — which, with history only starting recently, was ~200 lookups of
// mostly-missing docs per request and the main reason Portfolio took so long to load.
async function loadSetMonths(game: Game, setKey: string, fromMonth: string): Promise<Map<string, MonthDoc>> {
  const cacheKey = `${game}/${setKey}`
  const hit = setCache.get(cacheKey)
  if (hit && hit.fromMonth <= fromMonth && Date.now() - hit.fetchedAt < SET_TTL_MS) return hit.months

  const snap = await getDocs(query(
    collection(db, PRICE_HISTORY_COLLECTION, game, 'months'),
    where(documentId(), '>=', monthDocId(setKey, fromMonth)),
    where(documentId(), '<=', monthDocId(setKey, '9999-99')),
  ))
  const months = new Map<string, MonthDoc>()
  snap.forEach((d) => {
    const parsed: MonthDoc = new Map()
    const days = (d.data().days ?? {}) as Record<string, string>
    for (const [dd, raw] of Object.entries(days)) {
      try { parsed.set(dd, JSON.parse(raw) as DayEntry) } catch { /* skip a malformed day */ }
    }
    months.set(String(d.data().month ?? ''), parsed)
  })
  setCache.set(cacheKey, { fromMonth, months, fetchedAt: Date.now() })
  return months
}

// Daily price points for each item from `from` until now, priced with the same rule every price
// display uses (lib/pricing.ts) — so history and today's prices are always comparable.
export async function loadPriceSeries(
  items: HistoryItem[],
  from: Date,
): Promise<Map<string, PricePoint[]>> {
  const result = new Map<string, PricePoint[]>()
  const fromMonth = from.toISOString().slice(0, 7)
  const fromMs = from.getTime()

  const byGame = new Map<Game, HistoryItem[]>()
  for (const it of items) {
    if (!byGame.has(it.game)) byGame.set(it.game, [])
    byGame.get(it.game)!.push(it)
  }

  for (const [game, gameItems] of Array.from(byGame.entries())) {
    const catalog = await loadCatalog<{ id: string; rarity?: string; publicCode?: string; set?: string; setCode?: string; setName?: string }>(game)
    const byId = new Map(catalog.map((c) => [c.id, c]))

    // Group by set so each month doc is loaded once per set.
    const bySet = new Map<string, { item: HistoryItem; rarity?: string; publicCode?: string }[]>()
    for (const item of gameItems) {
      const card = byId.get(item.apiId)
      if (!card) continue
      const key = setKeyOf(card) as string
      if (!bySet.has(key)) bySet.set(key, [])
      bySet.get(key)!.push({ item, rarity: card.rarity, publicCode: card.publicCode })
    }

    await Promise.all(Array.from(bySet.entries()).map(async ([setKey, rows]) => {
      const monthDocs = await loadSetMonths(game, setKey, fromMonth)
      for (const monthDoc of Array.from(monthDocs.values())) {
        for (const entry of Array.from(monthDoc.values())) {
          if (new Date(entry.t).getTime() < fromMs) continue
          for (const { item, rarity, publicCode } of rows) {
            const tuple = entry.p[item.apiId]
            if (!tuple) continue
            const price = catalogPrice(game, { ...tupleToFields(tuple), rarity, publicCode }, { isFoil: item.isFoil })
            if (price <= 0) continue
            if (!result.has(item.key)) result.set(item.key, [])
            result.get(item.key)!.push({ date: entry.t, price })
          }
        }
      }
    }))
  }

  result.forEach((points) => points.sort((a, b) => a.date.localeCompare(b.date)))
  return result
}

// Most recent price recorded at or before `cutoffMs`, or null.
export function priceAtOrBefore(points: PricePoint[], cutoffMs: number): number | null {
  let best: number | null = null
  for (const p of points) {
    if (new Date(p.date).getTime() <= cutoffMs) best = p.price
    else break
  }
  return best
}
