import { NextResponse } from 'next/server'
import { loadSetRegistry, saveSetRegistry, invalidateRegistryCache } from '@/lib/api/registry'
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

    invalidateRegistryCache() // we're about to append to it — always start from the live doc
    const registry = await loadSetRegistry()
    const knownNames = new Set(registry.lorcana.sets.map((s) => s.setName))

    const result = await downloadLorcana()
    const newNames: string[] = result.setNames.filter((n: string) => !knownNames.has(n))

    if (newNames.length > 0) {
      const nowIso = new Date().toISOString()
      for (const setName of newNames) {
        registry.lorcana.sets.push({
          setName, code: null, lorcastId: null, releaseDate: null,
          cardexGroup: 'Special Sets',
          packAnalysis: { included: false },
          needsReview: true, source: 'auto-detected', addedAt: nowIso,
        } as (typeof registry.lorcana.sets)[number])
      }
      await saveSetRegistry(registry)
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
      newSets: newNames, newRarities,
      totalBrokenImages: result.totalBrokenImages, newlyBrokenImages: result.newlyBrokenImages, newlyFixedImages: result.newlyFixedImages,
    }
    await recordSyncStatus('lorcana', status)
    return NextResponse.json(status)
  } catch (err) {
    await recordSyncStatus('lorcana', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
