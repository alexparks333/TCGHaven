import { doc, getDoc, runTransaction, setDoc, serverTimestamp } from 'firebase/firestore'
import { CODE_PATTERN, normalizeCode, promoStatus, type PromoCode, type PromoKind } from './premium'
import { db } from './firebase/config'
import { ensureAdminAuth } from './firebase/adminAuth'
import { entitlementActive, toEntitlement, type Entitlement, type EntitlementSource } from './premiumRules'

// Haven Premium billing on the server (docs/premium-business.md "Decided 2026-11-19"). Server-only.
//
// RevenueCat is the source of truth for who's paying, on every platform: the apps buy through its
// plugin, the website through Stripe Checkout (each finished checkout is handed to RevenueCat, and
// RevenueCat's Stripe integration follows renewals and cancellations). Whenever something changes
// — RevenueCat's webhook, a purchase, a restore — syncEntitlement() re-reads RevenueCat and writes
// entitlements/{uid} through the sync bot (firestore.rules: only it can).
//
// Env (server only; keep the values in 1Password — never commit or print them):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY, STRIPE_TRIAL_DAYS (optional)
//   REVENUECAT_SECRET_KEY        — RevenueCat's secret API key (v1)
//   REVENUECAT_STRIPE_KEY        — RevenueCat's public key for its Stripe app (posting checkouts)
//   REVENUECAT_WEBHOOK_AUTH      — the Authorization header value set on RevenueCat's webhook
//   REVENUECAT_ENTITLEMENT       — the entitlement id in RevenueCat (default "premium")
//   NEXT_PUBLIC_SITE_URL         — where Stripe sends people back (default https://www.tcghaven.org)

export class BillingNotReady extends Error {}

const need = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new BillingNotReady(`${name} isn’t set`)
  return v
}
export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tcghaven.org').replace(/\/$/, '')

/** Where Stripe sends people back: the site they came from, if it's ours (the live site, or the dev
 *  server, so testing on localhost comes back to localhost); anything else gets the live site. */
export function returnBase(request: Request): string {
  const origin = request.headers.get('origin') ?? ''
  const ok = origin === siteUrl() || origin === 'https://www.tcghaven.org'
    || (process.env.NODE_ENV === 'development' && /^http:\/\/localhost:\d+$/.test(origin))
  return ok ? origin : siteUrl()
}

// ── Stripe (REST: form-encoded, no SDK) ─────────────────────────────────────────────────────

async function stripe<T>(method: 'GET' | 'POST', path: string, params?: Record<string, string>): Promise<T> {
  const body = params ? new URLSearchParams(params).toString() : undefined
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && body ? `?${body}` : ''}`
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${need('STRIPE_SECRET_KEY')}`, ...(method === 'POST' && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
    body: method === 'POST' ? body : undefined,
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Stripe ${path}: ${(data as { error?: { message?: string } })?.error?.message ?? res.status}`)
  return data as T
}

async function readEntitlementDoc(uid: string): Promise<Record<string, unknown> | undefined> {
  await ensureAdminAuth()
  return (await getDoc(doc(db, 'entitlements', uid))).data()
}

/** A Stripe Checkout page for a subscription; returns its URL. */
export async function createCheckout(uid: string, plan: 'monthly' | 'yearly', base = siteUrl()): Promise<string> {
  const price = need(plan === 'yearly' ? 'STRIPE_PRICE_YEARLY' : 'STRIPE_PRICE_MONTHLY')
  const existing = await readEntitlementDoc(uid)
  const customer = typeof existing?.stripeCustomerId === 'string' ? existing.stripeCustomerId : ''
  const trialDays = Number(process.env.STRIPE_TRIAL_DAYS || 0)
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    client_reference_id: uid,
    'subscription_data[metadata][app_user_id]': uid,
    'metadata[app_user_id]': uid,
    allow_promotion_codes: 'true',
    success_url: `${base}/premium?checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/premium`,
  }
  if (customer) params.customer = customer
  // The free trial is for a first subscription only
  if (trialDays > 0 && !existing) params['subscription_data[trial_period_days]'] = String(trialDays)
  const session = await stripe<{ url: string }>('POST', 'checkout/sessions', params)
  return session.url
}

/** Stripe's billing portal, where a website subscriber changes plan, card or cancels. */
export async function createPortal(uid: string, base = siteUrl()): Promise<string> {
  const d = await readEntitlementDoc(uid)
  const customer = typeof d?.stripeCustomerId === 'string' ? d.stripeCustomerId : ''
  if (!customer) throw new Error('No website subscription found for this account.')
  const s = await stripe<{ url: string }>('POST', 'billing_portal/sessions', { customer, return_url: `${base}/premium` })
  return s.url
}

/** After Stripe Checkout: check the session is this account's, keep its Stripe customer, and hand
 *  the purchase to RevenueCat (so it's one subscriber across web and app). */
export async function finishCheckout(uid: string, sessionId: string): Promise<void> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error('Bad checkout session')
  const s = await stripe<{ client_reference_id: string | null; customer: string | null; status: string }>('GET', `checkout/sessions/${sessionId}`)
  if (s.client_reference_id !== uid) throw new Error('That checkout belongs to another account')
  if (s.status !== 'complete') return
  await ensureAdminAuth()
  if (s.customer) await setDoc(doc(db, 'entitlements', uid), { stripeCustomerId: s.customer }, { merge: true })
  // Without RevenueCat (website-only testing), syncEntitlement reads Stripe itself
  if (!process.env.REVENUECAT_STRIPE_KEY) return
  const res = await fetch('https://api.revenuecat.com/v1/receipts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${need('REVENUECAT_STRIPE_KEY')}`, 'Content-Type': 'application/json', 'X-Platform': 'stripe' },
    body: JSON.stringify({ app_user_id: uid, fetch_token: sessionId }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`RevenueCat receipts: ${res.status}`)
}

// ── RevenueCat → entitlements/{uid} ─────────────────────────────────────────────────────────

interface RcSubscription {
  store?: string; period_type?: string; expires_date?: string | null
  unsubscribe_detected_at?: string | null; billing_issues_detected_at?: string | null
}
interface RcSubscriber {
  entitlements?: Record<string, { expires_date?: string | null; product_identifier?: string }>
  subscriptions?: Record<string, RcSubscription>
}

const STORES: Record<string, EntitlementSource> = { app_store: 'apple', mac_app_store: 'apple', play_store: 'google', stripe: 'stripe', rc_billing: 'stripe' }

/** What RevenueCat says about this account's Premium (null = RevenueCat has nothing). */
export function entitlementFromSubscriber(sub: RcSubscriber, entitlementId: string, now = Date.now()): Omit<Entitlement, 'updatedAt'> | null {
  const ent = sub.entitlements?.[entitlementId]
  if (!ent) return null
  const product = ent.product_identifier ?? ''
  const s = sub.subscriptions?.[product] ?? {}
  const expiresAt = ent.expires_date ? Date.parse(ent.expires_date) : null
  return {
    active: expiresAt === null || expiresAt > now,
    source: STORES[s.store ?? ''] ?? null,
    plan: /year|annual/i.test(product) ? 'yearly' : 'monthly',
    expiresAt,
    willRenew: !s.unsubscribe_detected_at && !s.billing_issues_detected_at && expiresAt !== null,
    trial: s.period_type === 'trial',
  }
}

async function revenueCatSubscriber(uid: string): Promise<RcSubscriber> {
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${need('REVENUECAT_SECRET_KEY')}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`RevenueCat subscribers: ${res.status}`)
  return ((await res.json()) as { subscriber?: RcSubscriber }).subscriber ?? {}
}

/** Re-read RevenueCat and write entitlements/{uid}. A promo or Permanent Premium the account
 *  already has is kept while it lasts longer than what's paid for. */
export async function syncEntitlement(uid: string): Promise<Entitlement | null> {
  const stored = await readEntitlementDoc(uid)
  // RevenueCat when it's set up (every platform); until then the website's Stripe subscription
  const paid = revenueCatOn()
    ? entitlementFromSubscriber(await revenueCatSubscriber(uid), process.env.REVENUECAT_ENTITLEMENT || 'premium')
    : typeof stored?.stripeCustomerId === 'string' ? await entitlementFromStripe(stored.stripeCustomerId) : null
  const current = toEntitlement(stored)
  const gift = current && (current.source === 'promo' || current.source === 'permanent') && entitlementActive(current) ? current : null
  const giftLasts = (g: Entitlement) => g.expiresAt === null || !paid?.expiresAt || g.expiresAt > paid.expiresAt
  const next = gift && (!paid?.active || giftLasts(gift)) ? { ...gift } : paid
  if (!next) return current
  await setDoc(doc(db, 'entitlements', uid), {
    active: next.active, source: next.source, plan: next.plan, expiresAt: next.expiresAt,
    willRenew: next.willRenew, trial: next.trial, updatedAt: serverTimestamp(),
  }, { merge: true })
  await setDoc(doc(db, 'premium_public', uid), publicMark(next))
  return { ...next, updatedAt: Date.now() }
}

/** premium_public/{uid}: the only part of someone's Premium others may see — whether they have it
 *  (and until when), for the crown beside their name. Never how they pay. */
const publicMark = (e: Pick<Entitlement, 'active' | 'expiresAt'>) => ({ active: e.active, expiresAt: e.expiresAt, updatedAt: serverTimestamp() })

// ── Stripe alone (before RevenueCat is set up) ──────────────────────────────────────────────

export const revenueCatOn = () => !!process.env.REVENUECAT_SECRET_KEY

interface StripeSub {
  id: string; status: string; cancel_at_period_end: boolean; customer: string
  metadata?: Record<string, string>
  current_period_end?: number
  items?: { data?: Array<{ current_period_end?: number; price?: { id?: string; recurring?: { interval?: string } } }> }
}

const LIVE_STATUSES = ['active', 'trialing', 'past_due']

/** Premium from the customer's Stripe subscriptions (the newest live one, else the latest ended). */
export async function entitlementFromStripe(customer: string, now = Date.now()): Promise<Omit<Entitlement, 'updatedAt'> | null> {
  const list = await stripe<{ data: StripeSub[] }>('GET', 'subscriptions', { customer, status: 'all', limit: '10' })
  const sub = list.data.find((s) => LIVE_STATUSES.includes(s.status)) ?? list.data[0]
  return sub ? entitlementOfStripeSub(sub, now) : null
}

export function entitlementOfStripeSub(sub: StripeSub, now = Date.now()): Omit<Entitlement, 'updatedAt'> {
  const item = sub.items?.data?.[0]
  // current_period_end moved from the subscription to its items in Stripe's 2025 API versions
  const end = (item?.current_period_end ?? sub.current_period_end ?? 0) * 1000
  const live = LIVE_STATUSES.includes(sub.status)
  return {
    active: live && end > now,
    source: 'stripe',
    plan: item?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly',
    expiresAt: end || null,
    willRenew: live && !sub.cancel_at_period_end,
    trial: sub.status === 'trialing',
  }
}

/** Stripe's webhook signature (Stripe-Signature: t=…,v1=…): HMAC-SHA256 of `${t}.${body}` with
 *  STRIPE_WEBHOOK_SECRET, at most 5 minutes old. */
export async function stripeSignatureOk(body: string, header: string | null): Promise<boolean> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !header) return false
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]))
  const t = Number(parts.t)
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3))
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false
  const { createHmac, timingSafeEqual } = await import('crypto')
  const want = createHmac('sha256', secret).update(`${t}.${body}`).digest()
  return sigs.some((s) => { const got = Buffer.from(s, 'hex'); return got.length === want.length && timingSafeEqual(got, want) })
}

interface StripeEvent { id: string; type: string; created: number; livemode: boolean; data: { object: Record<string, unknown> } }

/** A Stripe event → the account it's about, and (for Finances) the same row RevenueCat's events
 *  make. Only used while RevenueCat isn't set up — after that RevenueCat reports Stripe too. */
export async function handleStripeEvent(e: StripeEvent): Promise<void> {
  const o = e.data.object
  let uid: string | null = null
  let row: RcEvent | null = null
  const base = { id: `stripe_${e.id}`, store: 'stripe', environment: e.livemode ? 'PRODUCTION' : 'SANDBOX', event_timestamp_ms: e.created * 1000 }
  if (e.type.startsWith('customer.subscription.')) {
    const sub = o as unknown as StripeSub
    uid = sub.metadata?.app_user_id ?? null
    if (e.type === 'customer.subscription.created' && sub.status === 'trialing') row = { ...base, type: 'INITIAL_PURCHASE', period_type: 'TRIAL', price: 0 }
    if (e.type === 'customer.subscription.deleted') row = { ...base, type: 'EXPIRATION', price: 0 }
    const prev = (e.data as { previous_attributes?: { cancel_at_period_end?: boolean } }).previous_attributes
    if (e.type === 'customer.subscription.updated' && sub.cancel_at_period_end && prev?.cancel_at_period_end === false) row = { ...base, type: 'CANCELLATION', price: 0 }
  } else if (e.type === 'invoice.paid') {
    const inv = o as { amount_paid?: number; billing_reason?: string; parent?: { subscription_details?: { metadata?: Record<string, string> } }; subscription_details?: { metadata?: Record<string, string> } }
    uid = inv.parent?.subscription_details?.metadata?.app_user_id ?? inv.subscription_details?.metadata?.app_user_id ?? null
    const amount = (inv.amount_paid ?? 0) / 100
    if (amount > 0) row = { ...base, type: inv.billing_reason === 'subscription_create' ? 'INITIAL_PURCHASE' : 'RENEWAL', period_type: 'NORMAL', price: amount }
  } else if (e.type === 'charge.refunded') {
    const ch = o as { amount_refunded?: number; metadata?: Record<string, string> }
    row = { ...base, type: 'CANCELLATION', price: -((ch.amount_refunded ?? 0) / 100) }
  }
  if (row) await recordEvent(row, uid)
  if (uid) await syncEntitlement(uid)
}

// ── RevenueCat's webhook ────────────────────────────────────────────────────────────────────

export interface RcEvent {
  id?: string; type?: string; app_user_id?: string; original_app_user_id?: string; aliases?: string[]
  store?: string; environment?: string; product_id?: string; period_type?: string
  price?: number | null; price_in_purchased_currency?: number | null; currency?: string | null
  takehome_percentage?: number | null; event_timestamp_ms?: number; expiration_at_ms?: number | null
  is_trial_conversion?: boolean
}

/** The webhook's password, compared in constant time. */
export async function webhookAuthorized(header: string | null): Promise<boolean> {
  const want = process.env.REVENUECAT_WEBHOOK_AUTH
  if (!want || !header) return false
  const { timingSafeEqual, createHash } = await import('crypto')
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(header), h(want))
}

/** A Firebase uid from the event (RevenueCat's anonymous ids start with $RCAnonymousID). */
export function eventUid(e: RcEvent): string | null {
  const ids = [e.app_user_id, e.original_app_user_id, ...(e.aliases ?? [])]
  return ids.find((id): id is string => typeof id === 'string' && !!id && !id.startsWith('$RCAnonymousID')) ?? null
}

/** Keep the event for Finances: premium_events/{id} — what was paid, the store's cut and what's
 *  kept (RevenueCat's takehome_percentage already allows for Apple's / Google's rate). */
export async function recordEvent(e: RcEvent, uid: string | null): Promise<void> {
  if (!e.id) return
  await ensureAdminAuth()
  const gross = typeof e.price === 'number' ? e.price : 0 // USD
  const take = typeof e.takehome_percentage === 'number' ? e.takehome_percentage : null
  await setDoc(doc(db, 'premium_events', e.id), {
    type: e.type ?? 'UNKNOWN',
    uid: uid ?? null,
    store: STORES[e.store ?? ''] ?? e.store ?? null,
    sandbox: e.environment === 'SANDBOX',
    product: e.product_id ?? null,
    periodType: e.period_type ?? null,
    trialConversion: e.is_trial_conversion === true,
    grossUsd: Math.round(gross * 100) / 100,
    netUsd: take === null ? null : Math.round(gross * take * 100) / 100,
    at: e.event_timestamp_ms ?? Date.now(),
    day: new Date(e.event_timestamp_ms ?? Date.now()).toISOString().slice(0, 10),
    createdAt: serverTimestamp(),
  })
}

// ── Promo codes (promo_codes/{CODE}, made on the staff portal's Haven Premium page) ──────────

/** Who has used which codes — promo_redemptions/{id}, one doc per account (u_{uid}) and one per
 *  email address (e_{sha256 of the lowercased email}), so a new account on the same email doesn't
 *  start over. { codes: string[], starter: code | null }. Only the server reads or writes them;
 *  they're kept when Premium ends (that's the point). */
async function redemptionIds(uid: string, email: string | null): Promise<string[]> {
  const ids = [`u_${uid}`]
  if (email) {
    const { createHash } = await import('crypto')
    ids.push(`e_${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`)
  }
  return ids
}

/** Redeem a code for free months: checked and counted here, never by the app.
 *  - every code works once per person;
 *  - a starter code only if the person has never used ANY starter code;
 *  - not while a paid subscription that renews is running (it'd be wasted), nor with Permanent Premium;
 *  - the months stack on any promo time left.
 *  Returns the new end (ms). */
export async function redeemPromo(uid: string, email: string | null, raw: string): Promise<{ until: number; kind: PromoKind }> {
  const code = normalizeCode(raw)
  if (!CODE_PATTERN.test(code)) throw new PromoRefused('That isn’t a valid code.')
  await ensureAdminAuth()
  const codeRef = doc(db, 'promo_codes', code)
  const entRef = doc(db, 'entitlements', uid)
  const usedRefs = (await redemptionIds(uid, email)).map((id) => doc(db, 'promo_redemptions', id))
  return runTransaction(db, async (tx) => {
    const [c, e, ...used] = await Promise.all([tx.get(codeRef), tx.get(entRef), ...usedRefs.map((r) => tx.get(r))])
    // One answer for a code that doesn't exist, has expired, is used up or is switched off — so
    // nobody can find real codes by trying names and reading the messages (security review 2026-11-21)
    if (!c.exists()) throw new PromoRefused(CODE_UNUSABLE)
    const d = c.data()
    const promo: PromoCode = {
      code, kind: d.kind === 'gift' ? 'gift' : 'starter', months: Number(d.months) || 1,
      maxUses: typeof d.maxUses === 'number' ? d.maxUses : null, uses: Number(d.uses) || 0,
      expires: typeof d.expires === 'string' ? d.expires : null, active: d.active !== false,
      note: '', createdAt: 0, createdBy: '',
    }
    const status = promoStatus(promo)
    if (status !== 'active') throw new PromoRefused(CODE_UNUSABLE)

    const history = used.map((u) => u.data() ?? {})
    const codesUsed = new Set(history.flatMap((h) => (Array.isArray(h.codes) ? (h.codes as string[]) : [])))
    // Codes redeemed before promo_redemptions existed were listed on the entitlement
    const ed = e.data() ?? {}
    if (Array.isArray(ed.redeemed)) for (const x of ed.redeemed as string[]) codesUsed.add(x)
    if (codesUsed.has(code)) throw new PromoRefused('You’ve already used this code.')
    if (promo.kind === 'starter' && history.some((h) => typeof h.starter === 'string')) {
      throw new PromoRefused('You’ve already used a starter code — starter codes are one per person.')
    }

    const current = toEntitlement(ed)
    if (current?.source === 'permanent' || (current && ['apple', 'google', 'stripe'].includes(current.source ?? '') && entitlementActive(current) && current.willRenew)) {
      throw new PromoRefused('You already have Haven Premium.')
    }
    const from = current?.source === 'promo' && entitlementActive(current) && current.expiresAt ? current.expiresAt : Date.now()
    const until = new Date(from)
    until.setUTCMonth(until.getUTCMonth() + promo.months)

    tx.update(codeRef, { uses: promo.uses + 1 })
    tx.set(entRef, { active: true, source: 'promo', plan: null, expiresAt: until.getTime(), willRenew: false, trial: false, updatedAt: serverTimestamp() }, { merge: true })
    tx.set(doc(db, 'premium_public', uid), publicMark({ active: true, expiresAt: until.getTime() }))
    usedRefs.forEach((ref, i) => {
      const h = history[i]
      tx.set(ref, {
        codes: [...(Array.isArray(h.codes) ? (h.codes as string[]) : []), code],
        starter: typeof h.starter === 'string' ? h.starter : promo.kind === 'starter' ? code : null,
        updatedAt: serverTimestamp(),
      })
    })
    return { until: until.getTime(), kind: promo.kind }
  })
}

const CODE_UNUSABLE = 'That code can’t be used — check it and try again.'

export class PromoRefused extends Error {}
