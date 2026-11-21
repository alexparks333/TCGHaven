import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/cronAuth'
import { runStats } from '@/lib/stats/aggregate'

// The Statistics totals job (lib/stats/aggregate.ts), called by the sync-prices workflow twice a
// day with the cron secret.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isAuthorized = (req: NextRequest) => cronAuthorized(req) // lib/cronAuth.ts

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, ...(await runStats()) })
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
