import { NextResponse } from 'next/server'
import { loadSetRegistry, saveSetRegistry, invalidateRegistryCache, type OnePieceRegistrySet } from '@/lib/api/registry'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'
import { ensureSignedIn, downloadOnePiece } from '@/scripts/lib/catalog-sync.mjs'

interface OnePieceCard {
  setName: string
  set: string
  marketPrice: number
}

// Simpler than Riftbound's sync route: One Piece needs no per-set TCGPlayer group-ID matching
// (catalog-sync.mjs's downloadOnePiece() matches prices by exact card code, not by group name —
// see its own header comment), so this route only has one job — find any setName the scrape
// discovered that the registry doesn't know about yet, and register it with conservative
// defaults. Mirrors Riftbound's newNames diffing, minus everything group-match-related.
//
// The actual sync, with no auth check of its own — kept in this plain module (not route.ts)
// rather than exported alongside POST, because Next.js's route-file export validator only
// allows a fixed allowlist of names (GET/POST/dynamic/maxDuration/...) from a route.ts — a
// custom export like this one fails the build. The cron route (app/api/cron/sync-prices/route.ts)
// imports this directly to run in-process, having already authorized the overall run via
// CRON_SECRET, without a second, redundant auth check here; route.ts's POST is the real HTTP
// entry point and checks the caller before calling this.
export async function runOnePieceSync(): Promise<Response> {
  try {
    await ensureSignedIn()

    invalidateRegistryCache()
    const registry = await loadSetRegistry()
    const knownNames = new Set(registry.onepiece.sets.map((s) => s.setName))

    const result = await downloadOnePiece()
    const newNames: string[] = result.setNames.filter((n: string) => !knownNames.has(n))
    const nowIso = new Date().toISOString()

    // `setCodesBySetName` is bracket-only (null for a promo/event "set" with no official product
    // code) — deliberately NOT the same as a card's own `set` field, which falls back to a
    // print-numbering prefix for display purposes. Using that fallback here would tag e.g. a
    // "Treasure Cup" promo as code "OP09" just because its cards happen to be numbered from
    // OP09's print run, miscategorizing it into the Cardex's Main Sets group alongside the real
    // numbered boosters — see catalog-sync.mjs's downloadOnePiece() and buildOnePieceGroups() in
    // CardexPage.tsx.
    const setCodesBySetName = result.setCodesBySetName as Record<string, string | null>
    for (const setName of newNames) {
      const cards = (result.cards as OnePieceCard[]).filter((c) => c.setName === setName)
      registry.onepiece.sets.push({
        setName, code: setCodesBySetName[setName] ?? '', releaseDate: null, cardCount: cards.length,
        source: 'auto-detected', addedAt: nowIso,
      } as OnePieceRegistrySet)
    }

    if (newNames.length > 0) {
      await saveSetRegistry(registry)
      // getSetsForGame()'s own wrapping cache (lib/api/search.ts) never expires on its own and
      // doesn't know the registry changed underneath it — without this, a newly-auto-detected
      // set is fully written to Firestore but stays invisible in the set picker (AddCardDialog,
      // Admin Catalog) until the server process restarts. Same bug class that briefly made every
      // Pokemon set except a custom one disappear — see CLAUDE.md quirk #15.
      invalidateSetsCache('onepiece')
    }

    invalidateCatalogCache('onepiece')
    await recordSyncStatus('onepiece', { ok: true, at: new Date().toISOString(), setCount: result.setNames.length, newSets: newNames })
    return NextResponse.json({ ok: true, setCount: result.setNames.length, newSets: newNames })
  } catch (err) {
    await recordSyncStatus('onepiece', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
