import { doc, increment, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase/config'
import type { Card } from './types'

// Usage statistics (2026-11-09) — what the staff portal's Statistics page is built from. Two small
// docs per account, both written only by that account's own app and readable ONLY by the nightly
// totals job (lib/stats/aggregate.ts, the sync bot account) — staff see daily totals, never one
// person's numbers (firestore.rules).
//
//   usage_days/{day}_{uid}  one per account per day it's used: seconds active, sessions, which
//                           parts of the app (seconds + visits), phone app vs web. Saved every
//                           couple of minutes while open (increments, so no read). The totals
//                           job deletes each day's docs 90 days later.
//   user_stats/{uid}        a summary the device works out itself: how many cards per game, how many
//                           graded by which company, Japanese/foil counts, friends, badges, first
//                           and last day active. Counts only — never card names, prices or what was
//                           paid. Saved when it changes, at most every 30 minutes.
//
// Days are UTC ('YYYY-MM-DD') so every account's day lines up.

export const usageDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)

/** Which part of the app a path is — the Statistics page's "most used" sections. */
export function sectionOf(pathname: string): string {
  if (pathname === '/' || pathname.startsWith('/portfolio')) return 'portfolio'
  for (const s of ['inventory', 'cardex', 'badges', 'sold', 'friends', 'profile', 'creator']) {
    if (pathname === `/${s}` || pathname.startsWith(`/${s}/`)) return s
  }
  if (pathname.startsWith('/u/')) return 'profiles'
  return 'other'
}
export const SECTIONS = ['portfolio', 'inventory', 'cardex', 'badges', 'sold', 'friends', 'profile', 'profiles', 'creator', 'other'] as const

// ── Activity ────────────────────────────────────────────────────────────────────────────────

export interface UsageBatch {
  seconds: number
  sessions: number
  pages: Record<string, number>   // seconds per section
  visits: Record<string, number>  // times each section was opened
}

export const emptyBatch = (): UsageBatch => ({ seconds: 0, sessions: 0, pages: {}, visits: {} })
export const batchIsEmpty = (b: UsageBatch) => !b.seconds && !b.sessions && !Object.keys(b.visits).length

/** Adds a batch onto today's doc (increments only — nothing is read). */
export async function flushUsage(uid: string, b: UsageBatch, platform: 'app' | 'web', day = usageDay()): Promise<void> {
  const data: Record<string, unknown> = {
    uid,
    day,
    seconds: increment(b.seconds),
    sessions: increment(b.sessions),
    [platform]: increment(b.seconds),
    updatedAt: serverTimestamp(),
  }
  const pages: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(b.pages)) if (v) pages[k] = increment(v)
  const visits: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(b.visits)) if (v) visits[k] = increment(v)
  if (Object.keys(pages).length) data.pages = pages
  if (Object.keys(visits).length) data.visits = visits
  await setDoc(doc(db, 'usage_days', `${day}_${uid}`), data, { merge: true })
}

// ── Account summary ─────────────────────────────────────────────────────────────────────────

export interface UserSummary {
  cards: {
    total: number                     // every copy (quantity summed)
    unique: number                    // inventory rows
    byGame: Record<string, number>    // copies per game
    graded: Record<string, number>    // copies per grading company
    japanese: number
    foil: number
  }
  sold: number
  friends: number
  badgesEarned: number
  firstDay: string                    // the account's sign-up day (from sign-in metadata)
  lastDay: string                     // last day the app was used
  platform: 'app' | 'web'
}

export function summarize(cards: Card[], soldCount: number, friends: number, badgesEarned: number, firstDay: string, platform: 'app' | 'web'): UserSummary {
  const byGame: Record<string, number> = {}
  const graded: Record<string, number> = {}
  let total = 0, japanese = 0, foil = 0
  for (const c of cards) {
    const q = Math.max(0, c.quantity || 0)
    total += q
    byGame[c.game] = (byGame[c.game] ?? 0) + q
    if (c.gradingCompany) {
      const co = /^[A-Za-z]{2,5}$/.test(c.gradingCompany) ? c.gradingCompany.toUpperCase() : 'OTHER'
      graded[co] = (graded[co] ?? 0) + q
    }
    if (c.language === 'ja') japanese += q
    if (c.isFoil) foil += q
  }
  return {
    cards: { total, unique: cards.length, byGame, graded, japanese, foil },
    sold: soldCount, friends, badgesEarned, firstDay, lastDay: usageDay(), platform,
  }
}

export async function saveSummary(uid: string, s: UserSummary): Promise<void> {
  await setDoc(doc(db, 'user_stats', uid), { uid, ...s, updatedAt: serverTimestamp() })
}
