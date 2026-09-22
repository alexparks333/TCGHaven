import { NextResponse } from 'next/server'
import { ensureSignedIn, downloadMTG } from '@/scripts/lib/catalog-sync.mjs'
import { invalidateMtgSetsCache } from '@/lib/api/mtg'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'

// The actual sync, with no auth check of its own — kept in this plain module (not route.ts)
// rather than exported alongside POST, because Next.js's route-file export validator only
// allows a fixed allowlist of names (GET/POST/dynamic/maxDuration/...) from a route.ts — a
// custom export like this one fails the build. Not wired into the cron today (see MTG
// Integration.md), but kept in this same shape as every other game's sync so wiring it in later
// is just an import + Promise.allSettled entry in app/api/cron/sync-prices/route.ts, nothing to
// change here.
export async function runMtgSync(): Promise<Response> {
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
