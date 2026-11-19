'use client'

import { Capacitor } from '@capacitor/core'
import { authFetch } from './firebase/authFetch'
import { inApp } from './nativeApp'

// Buying and managing Haven Premium (docs/premium-business.md "Decided 2026-11-19").
//
//   Website   → Stripe Checkout (POST /api/premium/checkout) and Stripe's billing portal
//               (POST /api/premium/portal). RevenueCat follows the Stripe subscription (its Stripe
//               integration) and its webhook updates entitlements/{uid}.
//   iPhone    → Apple in-app purchase, Android → Google Play Billing, both through RevenueCat's
//               plugin. The RevenueCat user id is the Firebase uid, so all three meet in one place.
//
// The public RevenueCat app keys (NEXT_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY) are meant to ship in
// the app; the secret key and webhook password live only on the server.

export type Plan = 'monthly' | 'yearly'
export type PurchaseResult = { ok: true } | { ok: false; cancelled?: boolean; error?: string }

const nativeKey = () =>
  Capacitor.getPlatform() === 'android' ? process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY : process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY

/** Can this device buy Premium right now? (The app needs its store key; the website always can.) */
export const canBuyHere = () => !inApp() || !!nativeKey()

let configuredFor: string | null = null
async function purchases(uid: string) {
  const { Purchases } = await import('@revenuecat/purchases-capacitor')
  const apiKey = nativeKey()
  if (!apiKey) throw new Error('In-app purchases aren’t set up in this version of the app yet.')
  if (configuredFor === null) {
    await Purchases.configure({ apiKey, appUserID: uid })
    configuredFor = uid
  } else if (configuredFor !== uid) {
    await Purchases.logIn({ appUserID: uid })
    configuredFor = uid
  }
  return Purchases
}

export async function buyPremium(uid: string, plan: Plan): Promise<PurchaseResult> {
  try {
    if (inApp()) {
      const Purchases = await purchases(uid)
      const { current } = await Purchases.getOfferings()
      const pkg = plan === 'yearly' ? current?.annual : current?.monthly
      if (!pkg) return { ok: false, error: 'That plan isn’t available in the store right now.' }
      await Purchases.purchasePackage({ aPackage: pkg })
      await tellServer() // don't wait for RevenueCat's webhook to unlock
      return { ok: true }
    }
    const res = await authFetch('/api/premium/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.url) return { ok: false, error: data.error ?? 'Couldn’t open checkout. Try again in a moment.' }
    window.location.href = data.url
    return { ok: true }
  } catch (err) {
    const e = err as { userCancelled?: boolean | null; message?: string }
    if (e?.userCancelled) return { ok: false, cancelled: true }
    return { ok: false, error: e?.message || 'The purchase didn’t go through.' }
  }
}

/** Apple requires a Restore Purchases button: a reinstall or new phone gets Premium back. */
export async function restorePremium(uid: string): Promise<PurchaseResult> {
  try {
    const Purchases = await purchases(uid)
    await Purchases.restorePurchases()
    await tellServer()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || 'Couldn’t restore purchases.' }
  }
}

/** Where to cancel or change: the store it was bought in. */
export async function manageSubscription(source: string | null): Promise<PurchaseResult> {
  if (source === 'apple') { window.open('https://apps.apple.com/account/subscriptions', '_blank'); return { ok: true } }
  if (source === 'google') { window.open('https://play.google.com/store/account/subscriptions', '_blank'); return { ok: true } }
  const res = await authFetch('/api/premium/portal', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) return { ok: false, error: data.error ?? 'Couldn’t open your subscription. Try again in a moment.' }
  window.location.href = data.url
  return { ok: true }
}

/** Ask the server to re-read RevenueCat now (after a purchase or restore) */
async function tellServer() {
  await authFetch('/api/premium/refresh', { method: 'POST' }).catch(() => {})
}
