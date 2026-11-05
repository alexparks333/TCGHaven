import { NextResponse } from 'next/server'
import { loadSetRegistry, updateSetRegistry, invalidateRegistryCache } from '@/lib/api/registry'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'
import { ensureSignedIn, downloadLorcana } from '@/scripts/lib/catalog-sync.mjs'
import { findNewRarities } from '@/lib/api/syncHealth'

// The actual sync, with no auth check of its own — kept in this plain module (not route.ts)
// rather than exported alongside POST, because Next.js's route-file export validator only
// allows a fixed allowlist of names (GET/POST/dynamic/maxDuration/...) from a route.ts — a
// custom export like this one fails the build. The cron route (app/api/cron/sync-prices/route.ts)
// imports this directly to run in-process, having already authorized the overall run via
// CRON_SECRET, without a second, redundant auth check here; route.ts's POST is the real HTTP
// entry point and checks the caller before calling this.
export async function runLorcanaSync(): Promise<Response> {
  try {
    await ensureSignedIn()

    const result = await downloadLorcana()
    // Read after the download: it saves the promo review (lorcana.placements) itself, which this
    // must not overwrite. Always the live doc — we're about to append to it.
    invalidateRegistryCache()
    const unknown = (sets: Array<{ setName: string }>) => {
      const known = new Set(sets.map((s) => s.setName))
      return (result.setNames as string[]).filter((n) => !known.has(n))
    }
    let newNames = unknown((await loadSetRegistry()).lorcana.sets)

    if (newNames.length > 0) {
      const nowIso = new Date().toISOString()
      // Added to the latest registry in a transaction, so a staff edit made meanwhile isn't undone
      newNames = await updateSetRegistry((registry) => {
        const adding = unknown(registry.lorcana.sets)
        for (const setName of adding) {
          registry.lorcana.sets.push({
            setName, code: null, lorcastId: null, releaseDate: null,
            cardexGroup: 'Special Sets',
            needsReview: true, source: 'auto-detected', addedAt: nowIso,
          } as (typeof registry.lorcana.sets)[number])
        }
        return adding
      })
      // getSetsForGame()'s own wrapping cache (lib/api/search.ts) never expires on its own and
      // doesn't know the registry changed underneath it — without this, a newly-auto-detected
      // set is fully written to Firestore but stays invisible in the set picker (AddCardDialog,
      // Admin Catalog) until the server process restarts. This is the exact same class of bug
      // that briefly made every Pokemon set except a custom one disappear — see CLAUDE.md quirk
      // #15, and the POST /api/set-registry route's own "New Set" form, which already did this
      // correctly for the manual-entry path but was missing here on the auto-detected one.
      invalidateSetsCache('lorcana')
    }

    invalidateCatalogCache('lorcana')
    const newRarities = findNewRarities(result.cards)
    const status = {
      ok: true, at: new Date().toISOString(), setCount: result.setNames.length,
      newSets: newNames, newRarities, newPlacements: result.newPlacements ?? 0,
      totalBrokenImages: result.totalBrokenImages, newlyBrokenImages: result.newlyBrokenImages, newlyFixedImages: result.newlyFixedImages,
    }
    await recordSyncStatus('lorcana', status)
    return NextResponse.json(status)
  } catch (err) {
    await recordSyncStatus('lorcana', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
