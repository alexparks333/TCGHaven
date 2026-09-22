import { NextResponse } from 'next/server'
import { ensureSignedIn, downloadMTG } from '@/scripts/lib/catalog-sync.mjs'
import { invalidateMtgSetsCache } from '@/lib/api/mtg'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'

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
    // MTG's own set list comes from a live Scryfall fetch (lib/api/mtg.ts), not the registry, so
    // there's no new-set diffing here — but both its set-picker cache and the card-data cache
    // still need dropping so this sync's own results are visible immediately rather than after
    // an up-to-an-hour (sets) or up-to-2-minute (cards) self-heal window.
    invalidateMtgSetsCache()
    invalidateSetsCache('mtg')
    invalidateCatalogCache('mtg')
    await recordSyncStatus('mtg', { ok: true, at: new Date().toISOString(), setCount: result.setNames.length })
    return NextResponse.json({ ok: true, setCount: result.setNames.length })
  } catch (err) {
    await recordSyncStatus('mtg', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
