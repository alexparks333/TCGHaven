import { NextResponse } from 'next/server'
import { loadSetRegistry, saveSetRegistry, invalidateRegistryCache, type RiftboundRegistrySet } from '@/lib/api/registry'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'
import { matchSetName } from '@/scripts/lib/text-norm.mjs'
import { ensureSignedIn, downloadRiftbound } from '@/scripts/lib/catalog-sync.mjs'

const TCGCSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://tcgcsv.com/',
}

interface RiftboundCard {
  setName: string
  setCode: string
  marketPrice: number
}

// The actual sync, with no auth check of its own — kept in this plain module (not route.ts)
// rather than exported alongside POST, because Next.js's route-file export validator only
// allows a fixed allowlist of names (GET/POST/dynamic/maxDuration/...) from a route.ts — a
// custom export like this one fails the build. The cron route (app/api/cron/sync-prices/route.ts)
// imports this directly to run in-process, having already authorized the overall run via
// CRON_SECRET, without a second, redundant auth check here; route.ts's POST is the real HTTP
// entry point and checks the caller before calling this.
export async function runRiftboundSync(): Promise<Response> {
  try {
    await ensureSignedIn()

    invalidateRegistryCache()
    const registry = await loadSetRegistry()
    const knownNames = new Set(registry.riftbound.sets.map((s) => s.setName))

    const first = await downloadRiftbound()
    const newNames: string[] = first.setNames.filter((n: string) => !knownNames.has(n))
    const nowIso = new Date().toISOString()

    // Register genuinely new sets with conservative defaults, backfilling setCode/cardCount
    // from the cards this sync just wrote (no second Firestore read needed).
    for (const setName of newNames) {
      const cards = (first.cards as RiftboundCard[]).filter((c) => c.setName === setName)
      registry.riftbound.sets.push({
        setName, setCode: cards[0]?.setCode ?? '', releaseDate: null, cardCount: cards.length,
        cardexGroup: 'Main Sets', tcgcsvGroupId: null, groupMatchConfidence: null,
        needsReview: true, source: 'auto-detected', addedAt: nowIso,
      } as RiftboundRegistrySet)
    }

    // Any set that's brand-new OR already registered but still missing a tcgcsvGroupId (e.g.
    // released before its TCGPlayer group existed) gets a fresh fuzzy-match attempt.
    const needsGroupMatch = new Set(newNames)
    for (const s of registry.riftbound.sets) {
      if (s.tcgcsvGroupId == null) needsGroupMatch.add(s.setName)
    }

    const groupMatches: Array<{ setName: string; matched: boolean; groupId: number | null; confidence: number | null }> = []
    let anyNewGroupMatched = false

    if (needsGroupMatch.size > 0) {
      const res = await fetch('https://tcgcsv.com/tcgplayer/89/groups', { headers: TCGCSV_HEADERS })
      if (res.ok) {
        const data = await res.json()
        const groups = (data.results ?? []).map((g: { groupId: number; name: string }) => ({ groupId: g.groupId, name: g.name }))
        for (const setName of Array.from(needsGroupMatch)) {
          const alreadyUsed = new Set(registry.riftbound.sets.map((s) => s.tcgcsvGroupId).filter((id): id is number => id != null))
          const candidateGroups = groups.filter((g: { groupId: number }) => !alreadyUsed.has(g.groupId))
          const result = matchSetName(setName, candidateGroups)
          groupMatches.push({ setName, matched: !!result.match, groupId: result.match?.groupId ?? null, confidence: result.confidence })
          const entry = registry.riftbound.sets.find((s) => s.setName === setName)
          if (entry && result.match) {
            entry.tcgcsvGroupId = result.match.groupId
            entry.groupMatchConfidence = result.confidence
            entry.needsReview = true // still flagged — see the post-reprice "zero prices" safety net below
            anyNewGroupMatched = true
          }
        }
      }
    }

    await saveSetRegistry(registry)
    // getSetsForGame()'s own wrapping cache (lib/api/search.ts) never expires on its own and
    // doesn't know the registry changed underneath it — without this, a newly-auto-detected set
    // is fully written to Firestore but stays invisible in the set picker (AddCardDialog, Admin
    // Catalog) until the server process restarts. Same bug class that briefly made every Pokemon
    // set except a custom one disappear — see CLAUDE.md quirk #15.
    if (newNames.length > 0) invalidateSetsCache('riftbound')

    // A newly-matched tcgcsvGroupId can only be priced by re-running the sync now that the
    // registry override is in place.
    if (anyNewGroupMatched) {
      const second = await downloadRiftbound()
      const registry2 = await loadSetRegistry()
      for (const m of groupMatches) {
        if (!m.matched) continue
        const cards = (second.cards as RiftboundCard[]).filter((c) => c.setName === m.setName)
        const anyPriced = cards.some((c) => (c.marketPrice ?? 0) > 0)
        if (!anyPriced && cards.length > 0) {
          const entry = registry2.riftbound.sets.find((s) => s.setName === m.setName)
          if (entry) entry.needsReview = true
        }
      }
      await saveSetRegistry(registry2)
    }

    invalidateCatalogCache('riftbound')
    await recordSyncStatus('riftbound', { ok: true, at: new Date().toISOString(), setCount: first.setNames.length, newSets: newNames })
    return NextResponse.json({ ok: true, setCount: first.setNames.length, newSets: newNames, groupMatches })
  } catch (err) {
    await recordSyncStatus('riftbound', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
