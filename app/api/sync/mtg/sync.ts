import { NextResponse } from 'next/server'
import { ensureSignedIn, downloadMTG } from '@/scripts/lib/catalog-sync.mjs'
import { invalidateMtgSetsCache } from '@/lib/api/mtg'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'
import { findNewRarities } from '@/lib/api/syncHealth'

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
    // MTG has no registry either (live Scryfall set list) — same generic newSetNames signal as
    // Pokemon. Image checks here are bounded to new/previously-flagged cards only (see
    // syncToFirestore()'s comment) — otherwise checking all ~100k MTG cards' images every run
    // would be its own real cost, on top of the write-quota concern that already keeps MTG off
    // the automatic cron.
    const newRarities = findNewRarities(result.cards)
    const status = {
      ok: true, at: new Date().toISOString(), setCount: result.setNames.length,
      newSets: result.newSetNames, newRarities,
      totalBrokenImages: result.totalBrokenImages, newlyBrokenImages: result.newlyBrokenImages, newlyFixedImages: result.newlyFixedImages,
    }
    await recordSyncStatus('mtg', status)
    return NextResponse.json(status)
  } catch (err) {
    await recordSyncStatus('mtg', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
