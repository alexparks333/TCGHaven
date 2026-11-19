// Haven Premium's shared rules — no Firebase imports, so the app, the server routes and tests can
// all use them (docs/premium-business.md "Decided 2026-11-19").

export const FREE_SCANS_PER_MONTH = 10

export type EntitlementSource = 'apple' | 'google' | 'stripe' | 'promo' | 'permanent'

export interface Entitlement {
  active: boolean
  source: EntitlementSource | null
  plan: 'monthly' | 'yearly' | null
  /** ms; null = no end (Permanent Premium) */
  expiresAt: number | null
  willRenew: boolean
  trial: boolean
  updatedAt: number
}

export interface PremiumLaunch {
  /** The Owner's launch switch: false = nothing is locked yet */
  gatesOn: boolean
}

function millis(v: unknown): number | null {
  if (typeof v === 'number') return v
  const t = (v as { toMillis?: () => number } | null)?.toMillis?.()
  return typeof t === 'number' ? t : null
}

const SOURCES: EntitlementSource[] = ['apple', 'google', 'stripe', 'promo', 'permanent']

export function toEntitlement(d: Record<string, unknown> | undefined): Entitlement | null {
  if (!d) return null
  return {
    active: d.active === true,
    source: SOURCES.includes(d.source as EntitlementSource) ? (d.source as EntitlementSource) : null,
    plan: d.plan === 'monthly' || d.plan === 'yearly' ? d.plan : null,
    expiresAt: millis(d.expiresAt),
    willRenew: d.willRenew === true,
    trial: d.trial === true,
    updatedAt: millis(d.updatedAt) ?? 0,
  }
}

/** Paid up right now. Cancelling keeps Premium to the end of the period paid for (expiresAt). */
export function entitlementActive(e: Entitlement | null, now = Date.now()): boolean {
  if (!e || !e.active) return false
  return e.expiresAt === null || e.expiresAt > now
}

export const toLaunch = (d: Record<string, unknown> | undefined): PremiumLaunch => ({ gatesOn: d?.gatesOn === true })

/** 'YYYY-MM' (UTC) — the month free scans are counted in */
export const scanMonth = (now = new Date()) => now.toISOString().slice(0, 7)
