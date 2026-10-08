import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { loadCatalog } from '@/lib/api/catalog'
import { catalogPrice } from '@/lib/pricing'
import type { Game } from '@/lib/types'
import { PRICE_HISTORY_COLLECTION, setKeyOf, monthDocId, tupleToFields } from '@/scripts/lib/price-history.mjs'

// Server-side reader for the shared price history (format: scripts/lib/price-history.mjs).
// Everything a page needs is computed here and only the answer is sent to the browser — a
// phone never downloads the raw history.
//
// Month docs are cached in this server process: past months basically never change (6h TTL just
// in case of an admin backfill), the current month gains a new day each sync (15 min TTL). Since
// every user reads the same docs, Firestore reads are shared across all of them.

export interface HistoryItem {
  key: string       // the caller's id for this row (a user card id) — echoed back in results
  game: Game
  apiId: string     // catalog card id
  isFoil?: boolean
}

export interface PricePoint { date: string; price: number }

type DayEntry = { t: string; p: Record<string, number[]> }
type MonthDoc = Map<string, DayEntry>   // 'DD' -> that day's entry, parsed

const CURRENT_MONTH_TTL_MS = 15 * 60 * 1000
const PAST_MONTH_TTL_MS = 6 * 60 * 60 * 1000
const monthCache = new Map<string, { doc: MonthDoc; fetchedAt: number }>()

async function loadMonth(game: Game, setKey: string, month: string): Promise<MonthDoc> {
  const cacheKey = `${game}/${setKey}/${month}`
  const ttl = month === new Date().toISOString().slice(0, 7) ? CURRENT_MONTH_TTL_MS : PAST_MONTH_TTL_MS
  const hit = monthCache.get(cacheKey)
  if (hit && Date.now() - hit.fetchedAt < ttl) return hit.doc

  const snap = await getDoc(doc(db, PRICE_HISTORY_COLLECTION, game, 'months', monthDocId(setKey, month)))
  const parsed: MonthDoc = new Map()
  const days = (snap.data()?.days ?? {}) as Record<string, string>
  for (const [dd, raw] of Object.entries(days)) {
    try { parsed.set(dd, JSON.parse(raw) as DayEntry) } catch { /* skip a malformed day */ }
  }
  monthCache.set(cacheKey, { doc: parsed, fetchedAt: Date.now() })
  return parsed
}

function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = []
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1)
  while (d.getTime() <= end) {
    out.push(d.toISOString().slice(0, 7))
    d.setUTCMonth(d.getUTCMonth() + 1)
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
  const months = monthsBetween(from, new Date())
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
      const docs = await Promise.all(months.map((m) => loadMonth(game, setKey, m)))
      for (const monthDoc of docs) {
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
