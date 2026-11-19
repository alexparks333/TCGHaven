import { NextResponse } from 'next/server'
import { callerUid } from '@/lib/firebase/verifyAdminRequest'
import { BillingNotReady, createCheckout, returnBase } from '@/lib/premiumBilling'

// Haven Premium on the website: POST { plan: 'monthly' | 'yearly' } → { url } of a Stripe Checkout
// page for the signed-in collector (lib/premiumBilling.ts).
export async function POST(request: Request) {
  const uid = await callerUid(request)
  if (!uid) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const plan = body?.plan === 'yearly' ? 'yearly' : 'monthly'
  try {
    return NextResponse.json({ url: await createCheckout(uid, plan, returnBase(request)) })
  } catch (err) {
    if (err instanceof BillingNotReady) return NextResponse.json({ error: 'Haven Premium isn’t on sale yet.' }, { status: 503 })
    console.error('Premium checkout failed:', (err as Error).message)
    return NextResponse.json({ error: 'Couldn’t open checkout. Try again in a moment.' }, { status: 502 })
  }
}
