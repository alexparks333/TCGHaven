import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { staffDb } from './firebase/staff'

// Haven Premium's price lives in premium/config (lib/premium.ts — the Haven Premium page).
// Finances (staff portal, Owner only — firestore.rules `finance/{doc}`). For now: the running costs
// the Owner tracks by hand, in finance/costs. Revenue joins this when Haven Premium payments are
// built (Apple in-app purchase on iPhone, Stripe on the web): subscriptions, how long people stay,
// why they cancel.

export const APPLE_CUT = 0.15          // Apple Small Business Program rate (30% above $1M a year)

export const COST_CATEGORIES = ['Hosting', 'Database & storage', 'Apple & app stores', 'Domain & email', 'AI & tools', 'Marketing', 'Contractors', 'Other'] as const
export type CostCategory = (typeof COST_CATEGORIES)[number]
export type Cadence = 'monthly' | 'yearly' | 'once'

export interface CostItem {
  id: string
  name: string            // e.g. "Vercel Pro"
  category: CostCategory
  amount: number          // USD per charge
  cadence: Cadence        // monthly / yearly (charged once a year) / once (a one-off)
  start: string           // 'YYYY-MM' — first month charged
  end?: string            // 'YYYY-MM' — last month charged (recurring costs that stopped)
  note?: string
}

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7)
export const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1 + n, 1))
  return monthKey(d)
}
export const monthLabel = (m: string, long = false) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit', timeZone: 'UTC' })

/** What an item costs in month `m`. `spread`: a yearly bill counts 1/12 every month (true) or all
 *  in the month it's charged (false — what actually leaves the bank). */
export function costIn(item: CostItem, m: string, spread: boolean): number {
  if (m < item.start || (item.end && m > item.end)) return 0
  if (item.cadence === 'monthly') return item.amount
  if (item.cadence === 'once') return m === item.start ? item.amount : 0
  if (spread) return item.amount / 12
  return Number(m.slice(5)) === Number(item.start.slice(5)) ? item.amount : 0
}

const ref = () => doc(staffDb, 'finance', 'costs')

export async function loadCosts(): Promise<CostItem[]> {
  const snap = await getDoc(ref())
  return snap.exists() ? ((snap.data().items as CostItem[]) ?? []) : []
}

export async function saveCosts(items: CostItem[]): Promise<void> {
  // JSON round-trip drops undefined (Firestore rejects it)
  await setDoc(ref(), { items: JSON.parse(JSON.stringify(items)), updatedAt: serverTimestamp() })
}
