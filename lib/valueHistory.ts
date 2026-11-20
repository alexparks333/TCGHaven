import { collection, doc, FieldPath, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase/config'
import { entryBaseline } from './entryBaseline'
import type { Card, Game } from './types'
import type { PriceBaseline } from './store'
import type { GradedSource } from './api/gradedPrices'

// The collection's value over time = real snapshots of what the collector actually had, one per
// (local) day, kept a month to a doc: users/{uid}/value_months/{YYYY-MM} (saveValueDay below). Written by
// components/ValueSnapshotter.tsx whenever the app is open and the inventory or its prices change
// (today's entry is simply overwritten, so the last write of the day stands). Nothing is rebuilt
// backwards: a card counts from the day it was logged, and a sold or deleted card stays in the days
// it was owned (2026-11-19 — the old chart priced TODAY's cards on every past day). Days the app
// wasn't opened have no entry; the chart carries the last one.
//
// Each day is split so the Portfolio's filters apply to the past exactly as to the pie chart
// (2026-11-20): by game, by group (hidden groups), and — for the price floor — the value of the
// cards priced under each of a set of floors (FLOORS plus the floor set that day). A floor that day
// didn't save uses the nearest lower one it did.

/** Totals: v = value, c = cost (what was paid), e = the "since added" baseline */
export interface GameDay { v: number; c: number; e: number }
/** One group's totals (b: per floor, the totals of its cards priced UNDER that floor — [v, c, e];
 *  a floor missing from b = nothing under it) */
export interface GroupDay extends GameDay { b?: Record<string, [number, number, number]> }
/** One day: t = the floors it saved; g = game → group → totals ('_' = no group) */
export interface DayTotals { t: number[]; g: Partial<Record<Game, Record<string, GroupDay>>> }
export interface ValueDay { day: string; totals: DayTotals }
/** What the chart counts — the Portfolio's filters */
export interface ValueFilter { games: Game[]; hiddenGroups: string[]; floor: number }

/** Common floors always saved; the collector's own floor that day is added */
const FLOORS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100]
const NO_GROUP = '_'

/** The collector's local calendar day, YYYY-MM-DD */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const round2 = (n: number) => Math.round(n * 100) / 100

/** Today's totals, valued exactly as Portfolio values them (currentPrice ?? purchasePrice, × quantity;
 *  the floor compares the one-copy price, as Portfolio does) and with Analytics' "since added" baseline. */
export function dayTotals(
  cards: Card[],
  baselines: Record<string, PriceBaseline>,
  graded: Record<string, GradedSource>,
  floor: number,
): DayTotals {
  const t = Array.from(new Set([...FLOORS, ...(floor > 0 ? [round2(floor)] : [])])).sort((a, b) => a - b)
  const g: DayTotals['g'] = {}
  for (const card of cards) {
    const price = card.currentPrice ?? card.purchasePrice
    const v = price * card.quantity
    const c = card.purchasePrice * card.quantity
    // Since added — one rule with Portfolio (lib/entryBaseline.ts); unknown counts as today's value (no gain)
    const e = (entryBaseline(card, baselines, graded) ?? price) * card.quantity
    const grp = ((g[card.game] ??= {})[card.group || NO_GROUP] ??= { v: 0, c: 0, e: 0 })
    grp.v += v; grp.c += c; grp.e += e
    for (const f of t) {
      if (price >= f) continue
      const under = ((grp.b ??= {})[String(f)] ??= [0, 0, 0])
      under[0] += v; under[1] += c; under[2] += e
    }
  }
  for (const groups of Object.values(g)) for (const grp of Object.values(groups ?? {})) {
    grp.v = round2(grp.v); grp.c = round2(grp.c); grp.e = round2(grp.e)
    for (const k of Object.keys(grp.b ?? {})) grp.b![k] = grp.b![k].map(round2) as [number, number, number]
  }
  return { t, g }
}

/** One day's totals under the Portfolio's filters (games, hidden groups, price floor) */
export function sumDay(totals: DayTotals, { games, hiddenGroups, floor }: ValueFilter): GameDay {
  // The floor this day can apply: the largest it saved that isn't above the one set now
  let f: number | null = null
  if (floor > 0) for (const x of totals.t) if (x <= floor + 1e-9) f = x
  const out = { v: 0, c: 0, e: 0 }
  for (const game of games) {
    for (const [group, grp] of Object.entries(totals.g[game] ?? {})) {
      if (group !== NO_GROUP && hiddenGroups.includes(group)) continue
      out.v += grp.v; out.c += grp.c; out.e += grp.e
      const under = f != null ? grp.b?.[String(f)] : undefined
      if (under) { out.v -= under[0]; out.c -= under[1]; out.e -= under[2] }
    }
  }
  return out
}

// Days saved before groups and floors (the first layout, 2026-11-19/20: game → { v, c, e }) are
// skipped, not read: without groups and floors they'd count hidden groups and cheap cards, and the
// line would drop off a ledge where the new days start. The chart starts at the new layout.
function readDay(raw: unknown): DayTotals | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!r.g || typeof r.g !== 'object') return null
  return { t: Array.isArray(r.t) ? (r.t as number[]) : [], g: r.g as DayTotals['g'] }
}

// Stored a month per doc — users/{uid}/value_months/{YYYY-MM} = { month, days: { 'DD': DayTotals } } —
// so a year of chart is 12 reads, not 365. Saving a day replaces just that day's field (mergeFields),
// so a game or group that's gone since the last write goes too, and the doc is created on the month's
// first day. A day is a few KB at most (well under Firestore's 1MB a doc for a month).
export async function saveValueDay(uid: string, day: ValueDay): Promise<void> {
  const month = day.day.slice(0, 7), dd = day.day.slice(8, 10)
  await setDoc(
    doc(db, 'users', uid, 'value_months', month),
    { month, days: { [dd]: day.totals }, updatedAt: serverTimestamp() },
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
          const { month, days: byDay } = d.data() as { month?: string; days?: Record<string, unknown> }
          if (typeof month !== 'string' || !byDay) continue
          for (const [dd, raw] of Object.entries(byDay)) {
            const totals = readDay(raw)
            if (totals) days.push({ day: `${month}-${dd}`, totals })
          }
        }
        return days.sort((x, y) => (x.day < y.day ? -1 : 1))
      })
    p.catch(() => cache.delete(uid))
    cache.set(uid, p)
  }
  return p
}
