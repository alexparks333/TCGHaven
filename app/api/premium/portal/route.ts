import { NextResponse } from 'next/server'
import { callerUid } from '@/lib/firebase/verifyAdminRequest'
import { createPortal, returnBase } from '@/lib/premiumBilling'

// POST → { url } of Stripe's billing portal, where a website subscriber cancels or changes plan.
export async function POST(request: Request) {
  const uid = await callerUid(request)
  if (!uid) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  try {
    return NextResponse.json({ url: await createPortal(uid, returnBase(request)) })
  } catch (err) {
    console.error('Premium portal failed:', (err as Error).message)
    return NextResponse.json({ error: 'Couldn’t open your subscription. Try again in a moment.' }, { status: 502 })
  }
}
