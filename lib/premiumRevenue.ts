import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore'
import { APPLE_CUT } from './finance'

// Haven Premium's real money for the staff portal's Finances page: premium_events (one per
// RevenueCat webhook event — lib/premiumBilling.ts recordEvent) and the live entitlements.
// Sandbox (test) purchases are left out.

export interface PremiumEventRow {
  type: string; store: string | null; sandbox: boolean; periodType: string | null; trialConversion: boolean
  grossUsd: number; netUsd: number | null; day: string
}

export interface MonthRevenue { gross: number; net: number; newSubs: number; trials: number; conversions: number; cancellations: number; refunds: number }
export interface PremiumRevenue {
  hasEvents: boolean
  byMonth: Record<string, MonthRevenue>   // 'YYYY-MM'
  activeByStore: Record<string, number>   // apple / google / stripe / promo / permanent
  activeTotal: number
  trialing: number
}

const empty = (): MonthRevenue => ({ gross: 0, net: 0, newSubs: 0, trials: 0, conversions: 0, cancellations: 0, refunds: 0 })

/** What the store / Stripe keeps when RevenueCat didn't say (takehome_percentage missing) */
const fallbackNet = (gross: number, store: string | null) =>
  store === 'apple' || store === 'google' ? gross * (1 - APPLE_CUT) : gross * (1 - 0.029) - (gross > 0 ? 0.3 : 0)

export function summarizeEvents(rows: PremiumEventRow[], includeTests = false): Pick<PremiumRevenue, 'hasEvents' | 'byMonth'> {
  const byMonth: Record<string, MonthRevenue> = {}
  let hasEvents = false
  for (const r of rows) {
    if (r.sandbox && !includeTests) continue
    hasEvents = true
    const m = (byMonth[r.day.slice(0, 7)] ??= empty())
    m.gross += r.grossUsd
    m.net += r.netUsd ?? fallbackNet(r.grossUsd, r.store)
    if (r.type === 'INITIAL_PURCHASE') { if (r.periodType === 'TRIAL') m.trials++; else m.newSubs++ }
    if (r.trialConversion) m.conversions++
    if (r.type === 'CANCELLATION') { if (r.grossUsd < 0) m.refunds++; else m.cancellations++ }
  }
  return { hasEvents, byMonth }
}

export async function loadPremiumRevenue(db: Firestore, fromDay: string, includeTests = false): Promise<PremiumRevenue> {
  const [events, ents] = await Promise.all([
    getDocs(query(collection(db, 'premium_events'), where('day', '>=', fromDay))),
    getDocs(query(collection(db, 'entitlements'), where('active', '==', true))),
  ])
  const rows = events.docs.map((d) => {
    const x = d.data()
    return {
      type: String(x.type ?? ''), store: typeof x.store === 'string' ? x.store : null, sandbox: x.sandbox === true,
      periodType: typeof x.periodType === 'string' ? x.periodType : null, trialConversion: x.trialConversion === true,
      grossUsd: Number(x.grossUsd) || 0, netUsd: typeof x.netUsd === 'number' ? x.netUsd : null, day: String(x.day ?? ''),
    }
  })
  const activeByStore: Record<string, number> = {}
  let activeTotal = 0, trialing = 0
  const now = Date.now()
  for (const d of ents.docs) {
    const x = d.data()
    const exp = typeof x.expiresAt === 'number' ? x.expiresAt : null
    if (exp !== null && exp <= now) continue
    const store = typeof x.source === 'string' ? x.source : 'other'
    activeByStore[store] = (activeByStore[store] ?? 0) + 1
    activeTotal++
    if (x.trial === true) trialing++
  }
  return { ...summarizeEvents(rows, includeTests), activeByStore, activeTotal, trialing }
}
