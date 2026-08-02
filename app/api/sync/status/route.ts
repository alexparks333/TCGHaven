import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'sync-status.json'), 'utf-8')
    return NextResponse.json(JSON.parse(raw), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ phase: 'idle' }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
