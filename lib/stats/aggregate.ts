import {
  collection, doc, documentId, getCountFromServer, getDoc, getDocs, limit, orderBy, query,
  serverTimestamp, setDoc, startAfter, Timestamp, where, writeBatch, type Query, type QueryDocumentSnapshot, type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { ensureAdminAuth } from '../firebase/adminAuth'
import { usageDay } from '../usage'
import type { DailyStats, UsageTotals } from './types'

// The totals job (server only, signed in as the sync bot — the only account firestore.rules lets
// read user_stats / usage_days). Turns every account's counts-only summary and each day's activity
// into ONE doc per day, stats_daily/{day}, which is all the Statistics page reads.
//
// Each run (the sync-prices workflow calls /api/cron/stats twice a day; staff can press "Refresh now"):
//   1. Yesterday, if not final yet: its activity, sign-ups and retention, marked final.
//   2. Today: the whole snapshot (cards, accounts, social, titles) + today's activity so far.
// Cost per run ≈ one read per account (user_stats) + one per account active that day (usage_days)
// + a few count queries.

const PAGE = 1000
const DAY_MS = 86_400_000
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`)
const addDays = (day: string, n: number) => usageDay(dayStart(day) + n * DAY_MS)

async function forEachDoc(q: (after: QueryDocumentSnapshot | null) => Query, fn: (d: QueryDocumentSnapshot) => void) {
  let after: QueryDocumentSnapshot | null = null
  for (;;) {
    const snap: QuerySnapshot = await getDocs(q(after))
    snap.docs.forEach(fn)
    if (snap.docs.length < PAGE) return
    after = snap.docs[snap.docs.length - 1]
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const addInto = (into: Record<string, number>, from: unknown) => {
  if (!from || typeof from !== 'object') return
  for (const [k, v] of Object.entries(from as Record<string, unknown>)) into[k] = (into[k] ?? 0) + num(v)
}

/** One day's activity (usage_days where day == `day`). */
async function usageFor(day: string): Promise<UsageTotals> {
  const u: UsageTotals = { dau: 0, seconds: 0, sessions: 0, pageSeconds: {}, pageUsers: {}, pageVisits: {}, appUsers: 0, webUsers: 0, appSeconds: 0, webSeconds: 0 }
  await forEachDoc(
    (after) => after
      ? query(collection(db, 'usage_days'), where('day', '==', day), orderBy(documentId()), startAfter(after), limit(PAGE))
      : query(collection(db, 'usage_days'), where('day', '==', day), orderBy(documentId()), limit(PAGE)),
    (d) => {
      const x = d.data()
      const seconds = num(x.seconds)
      if (seconds <= 0 && num(x.sessions) <= 0) return
      u.dau += 1
      u.seconds += seconds
      u.sessions += num(x.sessions)
      addInto(u.pageSeconds, x.pages)
      addInto(u.pageVisits, x.visits)
      for (const k of Object.keys((x.visits as object) ?? {})) u.pageUsers[k] = (u.pageUsers[k] ?? 0) + 1
      if (num(x.app) > 0) { u.appUsers += 1; u.appSeconds += num(x.app) }
      if (num(x.web) > 0) { u.webUsers += 1; u.webSeconds += num(x.web) }
    },
  )
  return u
}

async function signupsOn(day: string): Promise<number> {
  const from = Timestamp.fromMillis(dayStart(day)), to = Timestamp.fromMillis(dayStart(day) + DAY_MS)
  return (await getCountFromServer(query(collection(db, 'profiles'), where('createdAt', '>=', from), where('createdAt', '<', to)))).data().count
}

const count = async (q: Query) => (await getCountFromServer(q)).data().count

/** Today's full snapshot: every account summary + titles + today's activity so far. */
async function snapshot(day: string): Promise<Omit<DailyStats, 'computedAt' | 'final'>> {
  const byGame: Record<string, number> = {}
  const uniqueByGame: Record<string, number> = {}
  const graded: Record<string, number> = {}
  const sizes: number[] = []
  const buckets: Record<string, number> = { '0': 0, '1–10': 0, '11–50': 0, '51–200': 0, '201–500': 0, '501–1000': 0, '1000+': 0 }
  const gamesPerAccount: Record<string, number> = {}
  let total = 0, unique = 0, japanese = 0, foil = 0, sold = 0, friendsSum = 0, withFriend = 0, badgesSum = 0, withBadge = 0
  let active7 = 0, active30 = 0, summaries = 0, appLast = 0
  const cohorts = { d1: [0, 0], d7: [0, 0], d30: [0, 0] } as Record<'d1' | 'd7' | 'd30', [number, number]>

  await forEachDoc(
    (after) => after
      ? query(collection(db, 'user_stats'), orderBy(documentId()), startAfter(after), limit(PAGE))
      : query(collection(db, 'user_stats'), orderBy(documentId()), limit(PAGE)),
    (d) => {
      const x = d.data()
      const c = (x.cards ?? {}) as Record<string, unknown>
      summaries += 1
      const t = num(c.total)
      total += t
      unique += num(c.unique)
      japanese += num(c.japanese)
      foil += num(c.foil)
      addInto(byGame, c.byGame)
      addInto(graded, c.graded)
      const games = Object.entries((c.byGame as Record<string, unknown>) ?? {}).filter(([, v]) => num(v) > 0)
      for (const [g] of games) uniqueByGame[g] = (uniqueByGame[g] ?? 0) + 1
      gamesPerAccount[String(Math.min(games.length, 5))] = (gamesPerAccount[String(Math.min(games.length, 5))] ?? 0) + 1
      sizes.push(t)
      buckets[t === 0 ? '0' : t <= 10 ? '1–10' : t <= 50 ? '11–50' : t <= 200 ? '51–200' : t <= 500 ? '201–500' : t <= 1000 ? '501–1000' : '1000+'] += 1
      sold += num(x.sold)
      friendsSum += num(x.friends); if (num(x.friends) > 0) withFriend += 1
      badgesSum += num(x.badgesEarned); if (num(x.badgesEarned) > 0) withBadge += 1
      if (x.platform === 'app') appLast += 1
      const last = typeof x.lastDay === 'string' ? x.lastDay : ''
      if (last >= addDays(day, -6)) active7 += 1
      if (last >= addDays(day, -29)) active30 += 1
      const first = typeof x.firstDay === 'string' ? x.firstDay : ''
      for (const [k, n] of [['d1', 1], ['d7', 7], ['d30', 30]] as const) {
        if (first && first === addDays(day, -n)) { cohorts[k][0] += 1; if (last >= addDays(first, n)) cohorts[k][1] += 1 }
      }
    },
  )
  sizes.sort((a, b) => a - b)
  const median = sizes.length ? (sizes.length % 2 ? sizes[(sizes.length - 1) / 2] : (sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2) : 0
  const withCards = sizes.filter((s) => s > 0).length

  const roles = collection(db, 'account_roles')
  const [accounts, signups, premium, creator, staff, banned, suspended, usage] = await Promise.all([
    count(query(collection(db, 'profiles'))),
    signupsOn(day),
    count(query(roles, where('role', '==', 'premium'))),
    count(query(roles, where('role', '==', 'creator'))),
    count(query(roles, where('role', '==', 'staff'))),
    count(query(roles, where('banned', '==', true))),
    count(query(roles, where('suspended', '==', true))),
    usageFor(day),
  ])

  return {
    day,
    accounts: { total: accounts, summaries, signups, withCards, active7, active30, appLast },
    roles: { premium, creator, staff, banned, suspended },
    cards: {
      total, unique, byGame, uniqueByGame, graded, japanese, foil, buckets, gamesPerAccount,
      avgPerAccount: summaries ? total / summaries : 0,
      avgPerCollector: withCards ? total / withCards : 0,
      median,
    },
    social: { avgFriends: summaries ? friendsSum / summaries : 0, withFriend, avgBadges: summaries ? badgesSum / summaries : 0, withBadge, sold },
    retention: {
      d1: { cohort: cohorts.d1[0], retained: cohorts.d1[1] },
      d7: { cohort: cohorts.d7[0], retained: cohorts.d7[1] },
      d30: { cohort: cohorts.d30[0], retained: cohorts.d30[1] },
    },
    usage,
  }
}

/** One run: finish yesterday (if needed), then today's snapshot. Returns the days written. */
// Day-by-day activity is kept 90 days (the daily totals are kept for good). Deletes every
// usage_days doc from before `before` — a few days at a time, so a missed run catches up.
const KEEP_DAYS = 90
async function purgeOldUsage(before: string): Promise<number> {
  let n = 0
  for (let round = 0; round < 20; round++) {
    const snap = await getDocs(query(collection(db, 'usage_days'), where('day', '<', before), limit(400)))
    if (snap.empty) break
    const batch = writeBatch(db)
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    n += snap.size
  }
  return n
}

export async function runStats(): Promise<{ finalized: string | null; today: string; purged: number }> {
  await ensureAdminAuth()
  const today = usageDay()
  const yesterday = addDays(today, -1)
  let finalized: string | null = null
  const yRef = doc(db, 'stats_daily', yesterday)
  const ySnap = await getDoc(yRef)
  if (!ySnap.exists() || ySnap.data().final !== true) {
    const [usage, signups] = await Promise.all([usageFor(yesterday), signupsOn(yesterday)])
    const base = ySnap.exists() ? {} : { day: yesterday }
    await setDoc(yRef, { ...base, usage, 'accounts': { ...(ySnap.data()?.accounts ?? {}), signups }, final: true, computedAt: serverTimestamp() }, { merge: true })
    finalized = yesterday
  }
  const s = await snapshot(today)
  await setDoc(doc(db, 'stats_daily', today), { ...s, final: false, computedAt: serverTimestamp() })
  const purged = await purgeOldUsage(addDays(today, -KEEP_DAYS))
  return { finalized, today, purged }
}
