import { NextResponse } from 'next/server'
import { handleStripeEvent, revenueCatOn, stripeSignatureOk } from '@/lib/premiumBilling'

// Stripe's webhook (Stripe dashboard → Developers → Webhooks → https://www.tcghaven.org/api/premium/stripe-webhook,
// events: customer.subscription.created / updated / deleted, invoice.paid, charge.refunded; its
// signing secret = STRIPE_WEBHOOK_SECRET). Used while RevenueCat isn't set up: keeps each website
// subscriber's Premium current (renewals, cancellations, failed payments) and records payments for
// Finances. Once RevenueCat is on, RevenueCat reports Stripe instead and this only acknowledges.
export async function POST(request: Request) {
  const body = await request.text()
  if (!(await stripeSignatureOk(body, request.headers.get('stripe-signature')))) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  }
  if (revenueCatOn()) return NextResponse.json({ ok: true, skipped: 'revenuecat' })
  try {
    await handleStripeEvent(JSON.parse(body))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Stripe webhook failed:', (err as Error).message)
    return NextResponse.json({ error: 'Failed' }, { status: 500 }) // Stripe retries
  }
}
