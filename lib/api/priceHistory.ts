import { collection, doc, documentId, getDoc, getDocs, query, where, type Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice } from '@/lib/pricing'
import { catalogKeyFor, type CatalogKey, type Edition, type Finish, type Game, type Language } from '@/lib/types'
import {
  PRICE_HISTORY_COLLECTION, DAYS_COLLECTION, FIRSTS_COLLECTION, setKeyOf, monthDocId, dayDocId, tupleToFields, decodePriceChunks,
} from '@/scripts/lib/price-history.mjs'

// Server-side reader for the shared price history (format: scripts/lib/price-history.mjs).
// Everything a page needs is computed here and only the answer is sent to the browser — a
// phone never downloads the raw history.
//

export interface HistoryItem {
  key: string       // the caller's id for this row (a user card id) — echoed back in results
  game: Game
  apiId: string     // catalog card id
  isFoil?: boolean
  edition?: Edition     // Pokémon printing — see lib/pricing.ts
  finish?: Finish
  language?: Language   // 'ja' → the Japanese catalog's history (price_history/pokemon-jp)
}

export interface PricePoint { date: string; price: number }

type DayEntry = { t: string; p: Record<string, number[]> }
type MonthDoc = Map<string, DayEntry>   // 'DD' -> that day's entry, parsed

const DAY_MS = 86_400_000

// ── When did this catalog last sync? ──────────────────────────────────────────────────────────
// History only changes when a sync lands (twice a day), so the caches below refresh on that, not on a
// timer. sync_status/{key}.lastGoodAt is stamped by every successful sync (catalog-sync.mjs) — a
// small doc, checked at most every 5 minutes per catalog per server instance.
const SYNC_CHECK_MS = 5 * 60 * 1000
// Backstop for anything not past-and-frozen, should the sync stamp ever be missing.
const MAX_AGE_MS = 6 * 60 * 60 * 1000
const syncChecks = new Map<CatalogKey, { at: number; syncMs: number }>()

async function lastSyncMs(key: CatalogKey): Promise<number> {
  const hit = syncChecks.get(key)
  if (hit && Date.now() - hit.at < SYNC_CHECK_MS) return hit.syncMs
  let syncMs = hit?.syncMs ?? 0
  try {
    const d = (await getDoc(doc(db, 'sync_status', key))).data()
    // Older status docs (before lastGoodAt existed) only have the attempt time.
    syncMs = (d?.lastGoodAt as Timestamp | undefined)?.toMillis() ?? (d?.at ? Date.parse(d.at) : 0)
  } catch { /* keep the last answer */ }
  syncChecks.set(key, { at: Date.now(), syncMs })
  return syncMs
}

// A cached copy of something that covers up to `endsAt` (the end of its day / month) is final once
// it was fetched comfortably after that moment; otherwise it's good until a newer sync.
const SETTLE_MS = 30 * 60 * 1000
async function stillGood(key: CatalogKey, fetchedAt: number, endsAt: number): Promise<boolean> {
  if (fetchedAt > endsAt + SETTLE_MS) return true
  if (Date.now() - fetchedAt > MAX_AGE_MS) return false
  return fetchedAt > await lastSyncMs(key)
}

// ── Month docs (one card's chart, Analytics) ───────────────────────────────────────────────────
// Cached per month doc: a past month is fetched once per server instance and kept; the current
// month is re-read only after a new sync. Every user reads the same docs, so they're shared. LRU,
// capped by size — 13+ months of every set would not fit in a function's memory.
interface MonthEntry { days: MonthDoc | null; fetchedAt: number; size: number }
const monthCache = new Map<string, MonthEntry>()
const MONTH_CACHE_BUDGET = 250_000_000 // ≈ bytes of parsed history held (raw JSON length × 2)
let monthCacheSize = 0

function cacheMonth(cacheKey: string, entry: MonthEntry) {
  const old = monthCache.get(cacheKey)
  if (old) { monthCacheSize -= old.size; monthCache.delete(cacheKey) }
  monthCache.set(cacheKey, entry)
  monthCacheSize += entry.size
  for (const [k, e] of Array.from(monthCache.entries())) {
    if (monthCacheSize <= MONTH_CACHE_BUDGET) break
    monthCache.delete(k)
    monthCacheSize -= e.size
  }
}

function monthsFrom(fromMonth: string, toMonth: string): string[] {
  const out: string[] = []
  let [y, m] = fromMonth.split('-').map(Number)
  for (;;) {
    const s = `${y}-${String(m).padStart(2, '0')}`
    if (s > toMonth) return out
    out.push(s)
    if (++m > 12) { m = 1; y++ }
  }
}

function endOfMonthMs(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return Date.UTC(y, m, 1) - 1 // Date.UTC's month is 0-based, so (y, m) is the next month's start
}

function parseMonth(data: Record<string, unknown>): { days: MonthDoc; size: number } {
  const days: MonthDoc = new Map()
  let size = 0
  for (const [dd, raw] of Object.entries((data.days ?? {}) as Record<string, string>)) {
    size += raw.length * 2
    try { days.set(dd, JSON.parse(raw) as DayEntry) } catch { /* skip a malformed day */ }
  }
  return { days, size }
}

// A set's month docs from `fromMonth` to now. Months not cached come in ONE document-id range
// query (ids are `{setKey}__{YYYY-MM}`); a stale current month alone is a single get().
async function loadSetMonths(game: CatalogKey, setKey: string, fromMonth: string): Promise<Map<string, MonthDoc>> {
  const wanted = monthsFrom(fromMonth, new Date().toISOString().slice(0, 7))
  const keyOf = (month: string) => `${game}/${monthDocId(setKey, month)}`
  const missing: string[] = []
  for (const month of wanted) {
    const hit = monthCache.get(keyOf(month))
    if (!hit || !(await stillGood(game, hit.fetchedAt, endOfMonthMs(month)))) missing.push(month)
  }

  const fetchedAt = Date.now()
  const found = new Map<string, Record<string, unknown>>()
  if (missing.length === 1) {
    const snap = await getDoc(doc(db, PRICE_HISTORY_COLLECTION, game, 'months', monthDocId(setKey, missing[0])))
    if (snap.exists()) found.set(missing[0], snap.data())
  } else if (missing.length > 1) {
    const snap = await getDocs(query(
      collection(db, PRICE_HISTORY_COLLECTION, game, 'months'),
      where(documentId(), '>=', monthDocId(setKey, missing[0])),
      where(documentId(), '<=', monthDocId(setKey, missing[missing.length - 1])),
    ))
    snap.forEach((d) => found.set(String(d.data().month ?? ''), d.data()))
  }
  // A month with no doc is cached too (as empty), so it isn't asked for again.
  for (const month of missing) {
    const data = found.get(month)
    const parsed = data ? parseMonth(data) : null
    cacheMonth(keyOf(month), { days: parsed?.days ?? null, fetchedAt, size: parsed?.size ?? 100 })
  }

  const months = new Map<string, MonthDoc>()
  for (const month of wanted) {
    const days = monthCache.get(keyOf(month))?.days
    if (days) months.set(month, days)
  }
  return months
}

// ── Daily closes (Portfolio baselines) ────────────────────────────────────────────────────────
// price_history/{key}/days/{YYYY-MM-DD}__{n}: every card's price for one day, one compressed file
// per game (price-history.mjs). Portfolio needs four past days, so a server instance holds a
// handful of these instead of months of every set — and past days never change, so they're kept.
type PriceMap = Record<string, number[]>
interface DayFile { t: number; prices: PriceMap }
const dayCache = new Map<string, { file: DayFile | null; fetchedAt: number }>()
const dayLoading = new Map<string, Promise<DayFile | null>>() // requests at the same moment share one read
const MAX_DAY_FILES = 60

async function loadDay(key: CatalogKey, day: string): Promise<DayFile | null> {
  const cacheKey = `${key}/${day}`
  const hit = dayCache.get(cacheKey)
  if (hit && await stillGood(key, hit.fetchedAt, Date.parse(`${day}T23:59:59.999Z`))) {
    dayCache.delete(cacheKey); dayCache.set(cacheKey, hit) // most recently used goes last
    return hit.file
  }
  let loading = dayLoading.get(cacheKey)
  if (!loading) {
    loading = fetchDay(key, day).finally(() => dayLoading.delete(cacheKey))
    dayLoading.set(cacheKey, loading)
  }
  return loading
}

async function fetchDay(key: CatalogKey, day: string): Promise<DayFile | null> {
  const cacheKey = `${key}/${day}`
  let decoded: Awaited<ReturnType<typeof decodePriceChunks>>
  try {
    const snap = await getDocs(query(
      collection(db, PRICE_HISTORY_COLLECTION, key, DAYS_COLLECTION),
      where(documentId(), '>=', dayDocId(day, 0)),
      where(documentId(), '<=', dayDocId(day, '~')),
    ))
    decoded = await decodePriceChunks(snap.docs.map((d) => d.data()))
  } catch (err) {
    // Not cached, so the next request tries again. Portfolio shows no change rather than failing.
    console.error(`Daily prices ${key}/${day} unreadable:`, err)
    return null
  }
  const file = decoded ? { t: Date.parse(decoded.t), prices: decoded.prices as PriceMap } : null
  dayCache.set(cacheKey, { file, fetchedAt: Date.now() })
  while (dayCache.size > MAX_DAY_FILES) dayCache.delete(dayCache.keys().next().value!)
  return file
}

// Each card's first recorded price (price_history/{key}/firsts) — changes only when a card is new.
const firstsCache = new Map<CatalogKey, { prices: PriceMap; fetchedAt: number }>()

async function loadFirsts(key: CatalogKey): Promise<PriceMap> {
  const hit = firstsCache.get(key)
  if (hit && await stillGood(key, hit.fetchedAt, Infinity)) return hit.prices
  const decoded = await getDocs(collection(db, PRICE_HISTORY_COLLECTION, key, FIRSTS_COLLECTION))
    .then((snap) => decodePriceChunks(snap.docs.map((d) => d.data())))
    .catch((err) => { console.error(`First prices ${key} unreadable:`, err); return null })
  if (!decoded && !hit) return {} // not cached: try again next request
  const prices = (decoded?.prices ?? hit?.prices ?? {}) as PriceMap
  firstsCache.set(key, { prices, fetchedAt: Date.now() })
  return prices
}

export interface Baseline { d1: number | null; d7: number | null; d30: number | null; d365: number | null; first: number | null }
const BASELINE_WINDOWS = { d1: 1, d7: 7, d30: 30, d365: 365 } as const

// How many days back from a cutoff to look for a card's last price (a day's file can be missing,
// or a card unpriced that day) — the "latest price at or before" the month-doc series gives.
const LOOKBACK_DAYS = 3

/** Each item's price 24h / 7d / 30d / 1y ago, and its first recorded price — Portfolio's P&L. */
export async function loadBaselines(items: HistoryItem[], now = Date.now()): Promise<Record<string, Baseline>> {
  const out: Record<string, Baseline> = {}
  const byCatalog = new Map<CatalogKey, { game: Game; items: HistoryItem[] }>()
  for (const it of items) {
    const key = catalogKeyFor(it.game, it.language)
    if (!byCatalog.has(key)) byCatalog.set(key, { game: it.game, items: [] })
    byCatalog.get(key)!.items.push(it)
  }

  for (const [key, { game, items: gameItems }] of Array.from(byCatalog.entries())) {
    const catalog = await loadCatalog<{ id: string; rarity?: string; publicCode?: string }>(key)
    const byId = new Map(catalog.map((c) => [c.id, c]))
    const priceOf = (item: HistoryItem, tuple: number[] | undefined): number | null => {
      if (!tuple) return null
      const card = byId.get(item.apiId)
      const price = catalogPrice(game, { ...tupleToFields(tuple), rarity: card?.rarity, publicCode: card?.publicCode }, { isFoil: item.isFoil, edition: item.edition, finish: item.finish })
      return price > 0 ? price : null
    }

    // Per window: the day files at or before its cutoff, newest first.
    const windows = await Promise.all((Object.keys(BASELINE_WINDOWS) as (keyof typeof BASELINE_WINDOWS)[]).map(async (name) => {
      const cutoff = now - BASELINE_WINDOWS[name] * DAY_MS
      const files: DayFile[] = []
      for (let back = 0; back < LOOKBACK_DAYS; back++) {
        const file = await loadDay(key, new Date(cutoff - back * DAY_MS).toISOString().slice(0, 10))
        if (file && file.t <= cutoff) files.push(file)
      }
      return { name, files }
    }))
    const firsts = await loadFirsts(key)

    for (const item of gameItems) {
      const b: Baseline = { d1: null, d7: null, d30: null, d365: null, first: priceOf(item, firsts[item.apiId]) }
      for (const { name, files } of windows) {
        for (const file of files) {
          const price = priceOf(item, file.prices[item.apiId])
          if (price !== null) { b[name] = price; break }
        }
      }
      out[item.key] = b
    }
  }
  return out
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

  // Grouped by catalog (Japanese Pokémon has its own catalog and history), priced by game.
  const byCatalog = new Map<CatalogKey, { game: Game; items: HistoryItem[] }>()
  for (const it of items) {
    const key = catalogKeyFor(it.game, it.language)
    if (!byCatalog.has(key)) byCatalog.set(key, { game: it.game, items: [] })
    byCatalog.get(key)!.items.push(it)
  }

  for (const [catalogKey, { game, items: gameItems }] of Array.from(byCatalog.entries())) {
    const catalog = await loadCatalog<{ id: string; rarity?: string; publicCode?: string; set?: string; setCode?: string; setName?: string }>(catalogKey)
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
      const monthDocs = await loadSetMonths(catalogKey, setKey, fromMonth)
      for (const monthDoc of Array.from(monthDocs.values())) {
        for (const entry of Array.from(monthDoc.values())) {
          if (new Date(entry.t).getTime() < fromMs) continue
          for (const { item, rarity, publicCode } of rows) {
            const tuple = entry.p[item.apiId]
            if (!tuple) continue
            const price = catalogPrice(game, { ...tupleToFields(tuple), rarity, publicCode }, { isFoil: item.isFoil, edition: item.edition, finish: item.finish })
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
