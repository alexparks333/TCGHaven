import { NextResponse } from 'next/server'
import { ensureSignedIn, downloadMTG } from '@/scripts/lib/catalog-sync.mjs'

export const dynamic = 'force-dynamic'
// MTG's bulk data file is the largest of any game here (100k+ printings, several hundred MB) and
// only grows — this is very likely to exceed a Vercel function's time/memory limits on most
// plans, the same way Pokemon's sync sometimes does at a fraction of the size. Firestore writes
// already applied are unaffected by a timeout (syncToFirestore() commits in small batches as it
// goes) — rerun it, or fall back to `npm run download-cards` locally, which has no such limit and
// is the reliable way to sync MTG in practice.
export const maxDuration = 300

export async function POST() {
  try {
    await ensureSignedIn()
    const result = await downloadMTG()
    return NextResponse.json({ ok: true, setCount: result.setNames.length })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
