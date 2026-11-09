import { NextRequest, NextResponse } from 'next/server'
import { runStats } from '@/lib/stats/aggregate'

// The Statistics totals job (lib/stats/aggregate.ts), called by the sync-prices workflow twice a
// day with the cron secret.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('x-cron-secret') === secret || req.nextUrl.searchParams.get('secret') === secret
}

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
