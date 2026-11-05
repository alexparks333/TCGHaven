import { NextResponse } from 'next/server'
import { loadSetRegistry, updateSetRegistry, invalidateRegistryCache, type RiftboundRegistrySet } from '@/lib/api/registry'
import { invalidateSetsCache } from '@/lib/api/search'
import { invalidateCatalogCache } from '@/lib/api/catalog'
import { recordSyncStatus } from '@/lib/api/syncStatus'
import { matchSetName } from '@/scripts/lib/text-norm.mjs'
import { ensureSignedIn, downloadRiftbound } from '@/scripts/lib/catalog-sync.mjs'
import { findNewRarities } from '@/lib/api/syncHealth'

const TCGCSV_HEADERS = {
  // tcgcsv blocks disguised browser User-Agents ("Please identify your application") — name the app.
  'User-Agent': 'TCGHaven/1.0 (+https://tcghaven.org)',
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

    const first = await downloadRiftbound()
    // Read after the download: it registers new TCGplayer bundle sets and product placements itself
    // (discoverRiftboundProducts in catalog-sync.mjs), which this must not overwrite or re-add.
    // Every write below goes through updateSetRegistry (a transaction on the latest copy), so a
    // staff edit made while the sync runs is never undone.
    invalidateRegistryCache()
    const unknown = (sets: RiftboundRegistrySet[]) => {
      const known = new Set(sets.map((s) => s.setName))
      return (first.setNames as string[]).filter((n) => !known.has(n))
    }
    const before = (await loadSetRegistry()).riftbound.sets
    const nowIso = new Date().toISOString()

    // TCGPlayer's group list, fetched up front (no slow work inside a transaction) — only needed
    // when a set is brand-new or still has no tcgcsvGroupId (e.g. released before its group existed).
    let groups: Array<{ groupId: number; name: string }> | null = null
    if (unknown(before).length > 0 || before.some((s) => s.tcgcsvGroupId == null)) {
      const res = await fetch('https://tcgcsv.com/tcgplayer/89/groups', { headers: TCGCSV_HEADERS, cache: 'no-store' })
      if (res.ok) groups = ((await res.json()).results ?? []).map((g: { groupId: number; name: string }) => ({ groupId: g.groupId, name: g.name }))
    }

    type GroupMatch = { setName: string; matched: boolean; groupId: number | null; confidence: number | null }
    const { newNames, groupMatches } = await updateSetRegistry((registry) => {
      const newNames = unknown(registry.riftbound.sets)
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
      // Any set that's brand-new OR already registered but still missing a tcgcsvGroupId gets a
      // fresh fuzzy-match attempt.
      const groupMatches: GroupMatch[] = []
      if (groups) {
        const needsGroupMatch = new Set(newNames)
        for (const s of registry.riftbound.sets) if (s.tcgcsvGroupId == null) needsGroupMatch.add(s.setName)
        for (const setName of Array.from(needsGroupMatch)) {
          const alreadyUsed = new Set(registry.riftbound.sets.map((s) => s.tcgcsvGroupId).filter((id): id is number => id != null))
          const result = matchSetName(setName, groups.filter((g) => !alreadyUsed.has(g.groupId)))
          groupMatches.push({ setName, matched: !!result.match, groupId: result.match?.groupId ?? null, confidence: result.confidence })
          const entry = registry.riftbound.sets.find((s) => s.setName === setName)
          if (entry && result.match) {
            entry.tcgcsvGroupId = result.match.groupId
            entry.groupMatchConfidence = result.confidence
            entry.needsReview = true // still flagged — see the post-reprice "zero prices" safety net below
          }
        }
      }
      return { newNames, groupMatches }
    })
    const anyNewGroupMatched = groupMatches.some((m) => m.matched)
    // getSetsForGame()'s own wrapping cache (lib/api/search.ts) never expires on its own and
    // doesn't know the registry changed underneath it — without this, a newly-auto-detected set
    // is fully written to Firestore but stays invisible in the set picker (AddCardDialog, Admin
    // Catalog) until the server process restarts. Same bug class that briefly made every Pokemon
    // set except a custom one disappear — see CLAUDE.md quirk #15.
    if (newNames.length > 0 || first.discovered.newSets.length > 0) invalidateSetsCache('riftbound')

    // A newly-matched tcgcsvGroupId can only be priced by re-running the sync now that the
    // registry override is in place.
    if (anyNewGroupMatched) {
      const second = await downloadRiftbound()
      const unpriced = groupMatches.filter((m) => {
        if (!m.matched) return false
        const cards = (second.cards as RiftboundCard[]).filter((c) => c.setName === m.setName)
        return cards.length > 0 && !cards.some((c) => (c.marketPrice ?? 0) > 0)
      }).map((m) => m.setName)
      if (unpriced.length) {
        await updateSetRegistry((registry) => {
          for (const entry of registry.riftbound.sets) if (unpriced.includes(entry.setName)) entry.needsReview = true
        })
      }
    }

    invalidateCatalogCache('riftbound')
    // Reported from `first`, same as setCount above — a second downloadRiftbound() run (when a
    // group just got matched) only changes prices for the newly-matched set, not rarities/images.
    const newRarities = findNewRarities(first.cards)
    const status = {
      ok: true, at: new Date().toISOString(), setCount: first.setNames.length,
      newSets: [...newNames, ...first.discovered.newSets.map((s: { setName: string }) => s.setName)], newRarities, groupMatches,
      newPlacements: first.discovered.newPlacements.length + (first.discovered.returned?.length ?? 0),
      unplaced: first.discovered.newPlacements.filter((p: { setName: string | null }) => !p.setName).length,
      totalBrokenImages: first.totalBrokenImages, newlyBrokenImages: first.newlyBrokenImages, newlyFixedImages: first.newlyFixedImages,
    }
    await recordSyncStatus('riftbound', status)
    return NextResponse.json(status)
  } catch (err) {
    await recordSyncStatus('riftbound', { ok: false, at: new Date().toISOString(), error: (err as Error).message })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
