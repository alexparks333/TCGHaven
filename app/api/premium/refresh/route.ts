import { NextResponse } from 'next/server'
import { callerUid } from '@/lib/firebase/verifyAdminRequest'
import { BillingNotReady, finishCheckout, syncEntitlement } from '@/lib/premiumBilling'

// POST { checkout?: Stripe Checkout session id } → { entitlement }: after a purchase or restore,
// re-read RevenueCat now instead of waiting for its webhook. Coming back from Stripe Checkout, the
// session is checked to be the caller's and handed to RevenueCat first.
export async function POST(request: Request) {
  const uid = await callerUid(request)
  if (!uid) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  try {
    if (typeof body?.checkout === 'string') await finishCheckout(uid, body.checkout)
    return NextResponse.json({ entitlement: await syncEntitlement(uid) })
  } catch (err) {
    if (err instanceof BillingNotReady) return NextResponse.json({ error: 'Haven Premium isn’t on sale yet.' }, { status: 503 })
    console.error('Premium refresh failed:', (err as Error).message)
    return NextResponse.json({ error: 'Couldn’t check your subscription. Try again in a moment.' }, { status: 502 })
  }
}
