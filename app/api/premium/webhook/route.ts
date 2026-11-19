import { NextResponse } from 'next/server'
import { eventUid, recordEvent, syncEntitlement, webhookAuthorized, type RcEvent } from '@/lib/premiumBilling'

// RevenueCat's webhook (set in RevenueCat → Integrations → Webhooks, with an Authorization header
// value = REVENUECAT_WEBHOOK_AUTH). Every purchase, renewal, cancellation, refund and expiry: the
// event is kept for Finances (premium_events) and the account's Premium re-read from RevenueCat.
// RevenueCat retries anything that isn't a 200, so a failure here answers 500.
export async function POST(request: Request) {
  if (!(await webhookAuthorized(request.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { event?: RcEvent } | null
  const event = body?.event
  if (!event) return NextResponse.json({ error: 'No event' }, { status: 400 })
  const uid = eventUid(event)
  try {
    await recordEvent(event, uid)
    if (uid && event.type !== 'TEST') await syncEntitlement(uid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Premium webhook failed:', event.type, (err as Error).message)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
