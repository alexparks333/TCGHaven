import { NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { runStats } from '@/lib/stats/aggregate'

// Statistics → "Refresh now": the same run as the twice-daily job, for staff.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized
  try {
    return NextResponse.json({ ok: true, ...(await runStats()) })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
