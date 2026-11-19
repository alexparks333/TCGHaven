import { NextResponse } from 'next/server'
import { callerIdentity } from '@/lib/premiumServer'
import { PromoRefused, redeemPromo } from '@/lib/premiumBilling'

// POST { code } → { until (ms), kind }: a promo code's free months of Haven Premium for the
// signed-in collector — checked and counted on the server (lib/premiumBilling.ts redeemPromo: each
// code once per person, one starter code per person ever). Website only: Apple doesn't allow
// unlocking features with our own codes inside the iPhone app (guideline 3.1.1).
export async function POST(request: Request) {
  const me = await callerIdentity(request)
  if (!me) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (typeof body?.code !== 'string') return NextResponse.json({ error: 'Enter a code.' }, { status: 400 })
  try {
    return NextResponse.json(await redeemPromo(me.uid, me.email, body.code))
  } catch (err) {
    if (err instanceof PromoRefused) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('Promo redeem failed:', (err as Error).message)
    return NextResponse.json({ error: 'Couldn’t redeem the code. Try again in a moment.' }, { status: 502 })
  }
}
