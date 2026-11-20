import { collection, doc, FieldPath, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase/config'
import { conditionPrice } from './pricing'
import type { Card, Game } from './types'
import type { PriceBaseline } from './store'
import type { GradedSource } from './api/gradedPrices'

// The collection's value over time = real snapshots of what the collector actually had, one per
// (local) day, kept a month to a doc: users/{uid}/value_months/{YYYY-MM} (saveValueDay below). Written by
// components/ValueSnapshotter.tsx whenever the app is open and the inventory or its prices change
// (today's entry is simply overwritten, so the last write of the day stands). Split by game so the
// Portfolio game filter still works on the past. Nothing is rebuilt backwards: a card counts from
// the day it was logged, and a sold or deleted card stays in the days it was owned
// (2026-11-19 — the old chart priced TODAY's cards on every past day, so a slab logged yesterday
// showed a month back). Days the app wasn't opened have no entry; the chart carries the last one.

/** One game's totals on a day: v = value, c = cost (what was paid), e = the "since added" baseline */
export interface GameDay { v: number; c: number; e: number }
export interface ValueDay { day: string; games: Partial<Record<Game, GameDay>> }

/** The collector's local calendar day, YYYY-MM-DD */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const round2 = (n: number) => Math.round(n * 100) / 100

/** Today's totals per game, valued exactly as Portfolio values them (currentPrice ?? purchasePrice,
 *  × quantity) and with Analytics' "since added" baseline. */
export function valueByGame(
  cards: Card[],
  baselines: Record<string, PriceBaseline>,
  graded: Record<string, GradedSource>,
): Partial<Record<Game, GameDay>> {
  const out: Partial<Record<Game, GameDay>> = {}
  for (const c of cards) {
    const g = (out[c.game] ??= { v: 0, c: 0, e: 0 })
    g.v += (c.currentPrice ?? c.purchasePrice) * c.quantity
    g.c += c.purchasePrice * c.quantity
    // Same rule as PortfolioAnalyticsPage: a graded-priced slab against what was paid
    g.e += (graded[c.id] ? c.purchasePrice : (c.priceAtEntry != null ? conditionPrice(c.priceAtEntry, c) : baselines[c.id]?.first ?? c.purchasePrice)) * c.quantity
  }
  for (const g of Object.values(out)) { g.v = round2(g.v); g.c = round2(g.c); g.e = round2(g.e) }
  return out
}

// Stored a month per doc — users/{uid}/value_months/{YYYY-MM} = { month, days: { 'DD': games } } —
// so a year of chart is 12 reads, not 365. Saving a day replaces just that day's field (mergeFields),
// so a game that's gone since the last write goes too, and the doc is created on the month's first day.
export async function saveValueDay(uid: string, day: ValueDay): Promise<void> {
  const month = day.day.slice(0, 7), dd = day.day.slice(8, 10)
  await setDoc(
    doc(db, 'users', uid, 'value_months', month),
    { month, days: { [dd]: day.games }, updatedAt: serverTimestamp() },
    { mergeFields: ['month', new FieldPath('days', dd), 'updatedAt'] },
  )
  cache.delete(uid)
}

// Read once per session per user (both charts share it); a new snapshot clears it
const cache = new Map<string, Promise<ValueDay[]>>()

/** Up to two years of days, oldest first */
export function loadValueDays(uid: string): Promise<ValueDay[]> {
  let p = cache.get(uid)
  if (!p) {
    p = getDocs(query(collection(db, 'users', uid, 'value_months'), orderBy('month', 'desc'), limit(24)))
      .then((snap) => {
        const days: ValueDay[] = []
        for (const d of snap.docs) {
          const { month, days: byDay } = d.data() as { month?: string; days?: Record<string, ValueDay['games']> }
          if (typeof month !== 'string' || !byDay) continue
          for (const [dd, games] of Object.entries(byDay)) if (games) days.push({ day: `${month}-${dd}`, games })
        }
        return days.sort((x, y) => (x.day < y.day ? -1 : 1))
      })
    p.catch(() => cache.delete(uid))
    cache.set(uid, p)
  }
  return p
}
