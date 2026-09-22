import { NextResponse } from 'next/server'
import { ensureSignedIn, downloadPokemon } from '@/scripts/lib/catalog-sync.mjs'
import { invalidatePokemonSetsCache } from '@/lib/api/pokemon'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'

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
    // Two stacked in-memory set-list caches, neither of which expires on its own — without this,
    // a newly-released set's cards land in Firestore just fine (confirmed by this sync's own
    // setCount) but the set picker (Admin Catalog, AddCardDialog, Cardex) keeps serving the
    // pre-sync list until the server process restarts. getSetsForGame() (lib/api/search.ts)
    // checks its OWN cache first and short-circuits before ever calling getPokemonSets() again,
    // so clearing only the inner one isn't enough — both need dropping. Same class of gotcha as
    // the Lorcana/Riftbound set-picker cache (CLAUDE.md quirk #15), just missing here until now.
    invalidatePokemonSetsCache()
    invalidateSetsCache('pokemon')
    // Card data self-heals within 2 minutes anyway (loadCatalog()'s delta-pull, lib/api/catalog.ts)
    // since every write here stamps updatedAt — but there's no reason to make a freshly-run sync
    // wait up to 2 minutes to show its own results when this process already has the answer now.
    invalidateCatalogCache('pokemon')
    await recordSyncStatus('pokemon', { ok: true, at: new Date().toISOString(), setCount: result.setNames.length })
    return NextResponse.json({ ok: true, setCount: result.setNames.length })
  } catch (err) {
    await recordSyncStatus('pokemon', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
