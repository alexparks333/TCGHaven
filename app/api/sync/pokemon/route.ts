import { NextResponse } from 'next/server'
import { ensureSignedIn, downloadPokemon } from '@/scripts/lib/catalog-sync.mjs'

export const dynamic = 'force-dynamic'
// Pokemon's catalog is large (170+ sets, 20k+ cards) — this is the slowest of the three games
// to resync. Give it the most headroom; on a Vercel plan whose function timeout is shorter than
// this, the request will simply time out (Firestore writes already applied are unaffected,
// since syncToFirestore() commits in small batches as it goes) — rerun it, or fall back to
// `npm run download-cards` locally, which has no such limit.
export const maxDuration = 300

export async function POST() {
  try {
    await ensureSignedIn()
    const result = await downloadPokemon()
    return NextResponse.json({ ok: true, setCount: result.setNames.length })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
