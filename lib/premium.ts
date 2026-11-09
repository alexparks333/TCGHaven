import {
  collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, runTransaction, serverTimestamp, updateDoc,
  type Firestore,
} from 'firebase/firestore'

// Haven Premium settings (2026-11-09), edited by the Owner in the staff portal's Haven Premium page
// (components/admin/insights/PremiumPage.tsx).
//
//   premium/config         { monthly, yearly, yearlyOn, history[], updatedAt } — the prices. Readable
//                          by everyone (the app shows them on the upgrade screen); only the Owner writes.
//   promo_codes/{CODE}     { code, months, maxUses, uses, expires, active, note, createdAt, createdBy }
//                          — a code giving `months` free months of Premium. Owner only for now;
//                          redeeming one (checked and counted on the server) comes with Premium itself.
//
// Prices here are what the website charges (Stripe) and what the app shows. On iPhone, Apple charges
// whatever price is set for the subscription in App Store Connect — keep the two in step by hand.

export interface PriceChange { at: number; by: string; monthly: number; yearly: number; yearlyOn: boolean }

export interface PremiumConfig {
  monthly: number     // USD per month
  yearly: number      // USD per year
  yearlyOn: boolean   // offer the yearly plan
  history: PriceChange[]
}

export const DEFAULT_PREMIUM: PremiumConfig = { monthly: 3.99, yearly: 29.99, yearlyOn: true, history: [] }

export function toConfig(d: Record<string, unknown> | undefined): PremiumConfig {
  if (!d) return DEFAULT_PREMIUM
  const n = (v: unknown, f: number) => (typeof v === 'number' && v > 0 ? v : f)
  return {
    monthly: n(d.monthly, DEFAULT_PREMIUM.monthly),
    yearly: n(d.yearly, DEFAULT_PREMIUM.yearly),
    yearlyOn: d.yearlyOn !== false,
    history: Array.isArray(d.history) ? (d.history as PriceChange[]) : [],
  }
}

/** How much the yearly plan saves against 12 monthly payments (0–1). */
export const yearlySaving = (c: Pick<PremiumConfig, 'monthly' | 'yearly'>) => (c.monthly > 0 ? Math.max(0, 1 - c.yearly / (c.monthly * 12)) : 0)

export function watchPremiumConfig(db: Firestore, onChange: (c: PremiumConfig) => void): () => void {
  return onSnapshot(doc(db, 'premium', 'config'), (s) => onChange(toConfig(s.data())), () => onChange(DEFAULT_PREMIUM))
}

export async function loadPremiumConfig(db: Firestore): Promise<PremiumConfig> {
  try { return toConfig((await getDoc(doc(db, 'premium', 'config'))).data()) } catch { return DEFAULT_PREMIUM }
}

/** Save new prices, adding the change to the history (newest first, last 50 kept). */
export async function savePrices(db: Firestore, next: Omit<PremiumConfig, 'history'>, by: string): Promise<void> {
  const ref = doc(db, 'premium', 'config')
  await runTransaction(db, async (tx) => {
    const cur = toConfig((await tx.get(ref)).data())
    const change: PriceChange = { at: Date.now(), by, monthly: next.monthly, yearly: next.yearly, yearlyOn: next.yearlyOn }
    tx.set(ref, { ...next, history: [change, ...cur.history].slice(0, 50), updatedAt: serverTimestamp() })
  })
}

// ── Promo codes ────────────────────────────────────────────────────────────────────────────

export interface PromoCode {
  code: string           // the doc id, upper case
  months: number         // free months of Premium
  maxUses: number | null // null = unlimited
  uses: number
  expires: string | null // 'YYYY-MM-DD' — last day it can be redeemed; null = never
  active: boolean        // switched off = can't be redeemed (kept for its history)
  note: string
  createdAt: number
  createdBy: string
}

export type PromoStatus = 'active' | 'off' | 'expired' | 'used up'
export function promoStatus(p: PromoCode, today = new Date().toISOString().slice(0, 10)): PromoStatus {
  if (!p.active) return 'off'
  if (p.expires && p.expires < today) return 'expired'
  if (p.maxUses !== null && p.uses >= p.maxUses) return 'used up'
  return 'active'
}

export const CODE_PATTERN = /^[A-Z0-9-]{4,24}$/
export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '-')

/** A readable random code, e.g. HAVEN-7KQ2-XM4P (no look-alike characters). */
export function makeCode(prefix = 'HAVEN'): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(8)
  crypto.getRandomValues(bytes)
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join('')
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`
}

function toPromo(id: string, d: Record<string, unknown>): PromoCode {
  const at = d.createdAt as { toMillis?: () => number } | number | undefined
  return {
    code: id,
    months: typeof d.months === 'number' ? d.months : 1,
    maxUses: typeof d.maxUses === 'number' ? d.maxUses : null,
    uses: typeof d.uses === 'number' ? d.uses : 0,
    expires: typeof d.expires === 'string' ? d.expires : null,
    active: d.active !== false,
    note: String(d.note ?? ''),
    createdAt: typeof at === 'number' ? at : at?.toMillis?.() ?? 0,
    createdBy: String(d.createdBy ?? ''),
  }
}

export async function listPromoCodes(db: Firestore): Promise<PromoCode[]> {
  const snap = await getDocs(collection(db, 'promo_codes'))
  return snap.docs.map((d) => toPromo(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt)
}

/** Create a code; refuses one that already exists (codes are never reused). */
export async function createPromoCode(db: Firestore, p: Omit<PromoCode, 'uses' | 'createdAt'>): Promise<void> {
  const ref = doc(db, 'promo_codes', p.code)
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) throw new Error(`The code ${p.code} already exists.`)
    tx.set(ref, { ...p, uses: 0, createdAt: serverTimestamp() })
  })
}

export const setPromoActive = (db: Firestore, code: string, active: boolean) => updateDoc(doc(db, 'promo_codes', code), { active })
export const deletePromoCode = (db: Firestore, code: string) => deleteDoc(doc(db, 'promo_codes', code))
