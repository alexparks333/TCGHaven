import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { loadVisibleCatalog, scoreMatch, parseSearchQuery, normNum } from './catalog'
import { getMtgRegistrySets } from './registry'

// Scryfall set_type values that aren't real paper-collectible cards — tokens, art cards, and
// other memorabilia a physical collection wouldn't actually contain. Kept in sync with the same
// blocklist scripts/lib/catalog-sync.mjs's downloadMTG() applies when building the catalog, so
// the picker never offers a set with zero cataloged cards in it.
export const MTG_EXCLUDED_SET_TYPES = new Set(['token', 'memorabilia', 'art_series', 'minigame'])

// Scryfall rejects any request missing BOTH a User-Agent and an Accept header with a plain 400
// ("HTTP requests to api.scryfall.com must contain a User-Agent and Accept header") — Node's
// fetch doesn't send a User-Agent by default, so every call here needs these set explicitly.
export const SCRYFALL_HEADERS = { 'User-Agent': 'TCGHaven/1.0', Accept: 'application/json' }

export interface MtgCard {
  id: string        // Scryfall's own UUID for this exact printing
  name: string
  set: string        // Scryfall set code, e.g. "khm"
  setName: string
  number: string     // collector_number, as-is (can contain letters/suffixes, e.g. "150a", "★")
  rarity?: string    // common, uncommon, rare, mythic, special, bonus
  imageUrl?: string
  marketPrice?: number
  marketPriceFoil?: number
  hidden?: boolean
}

export interface MtgSet {
  code: string
  name: string
  releaseDate: string
  cardCount: number
  setType?: string
  source?: string
}

let _setsCache: { data: MtgSet[]; loadedAt: number } | null = null
const STALE_MS = 60 * 60 * 1000 // Scryfall's set list changes rarely (new sets a few times/year)

export async function getMtgSets(): Promise<MtgSet[]> {
  if (_setsCache && Date.now() - _setsCache.loadedAt < STALE_MS) return _setsCache.data

  let sets: MtgSet[] = []
  let liveFetchOk = false
  // Scryfall is generally reliable, but treat it the same as api.pokemontcg.io regardless — a
  // single failed attempt landing at the exact moment this process's cache is empty would
  // otherwise get permanently masked by the manual-sets merge below (non-empty as long as any
  // custom set exists) and pin a degraded list for the full hour-long staleness window. This is
  // the exact bug class that briefly made every Pokemon set except a custom one disappear.
  for (let attempt = 0; attempt < 3 && !liveFetchOk; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt))
    try {
      const res = await fetch('https://api.scryfall.com/sets', { headers: SCRYFALL_HEADERS, cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const fetched: MtgSet[] = (data.data ?? [])
          .filter((s: { digital?: boolean; set_type?: string }) => !s.digital && !MTG_EXCLUDED_SET_TYPES.has(s.set_type ?? ''))
          .map((s: { code: string; name: string; released_at?: string; card_count?: number; set_type?: string }) => ({
            code: s.code,
            name: s.name,
            releaseDate: s.released_at ?? '',
            cardCount: s.card_count ?? 0,
            setType: s.set_type,
          }))
        if (fetched.length > 0) {
          sets = fetched
          liveFetchOk = true
        }
      }
    } catch {
      // try again, or fall through to manual-only after the last attempt
    }
  }

  // Sets created via the Admin Catalog "New Set" form ("source": "manual" in the registry)
  // don't exist on Scryfall at all — merge them in regardless of whether the live fetch above
  // succeeded, same as getPokemonSets() already does for Pokemon's manual sets.
  const manualOnly = (await getMtgRegistrySets()).filter(
    (s) => s.source === 'manual' && !sets.some((x) => x.name === s.setName),
  )
  if (manualOnly.length > 0) {
    sets = [...sets, ...manualOnly.map((s) => ({
      code: s.code || s.setName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, ''),
      name: s.setName,
      releaseDate: s.releaseDate ?? '',
      cardCount: 0,
      setType: undefined,
      source: 'manual',
    }))]
  }

  // Only cache when the live fetch actually succeeded — see isPokemonSetsCacheReliable() in
  // lib/api/pokemon.ts for the full reasoning; same fix, same bug class, applied here too.
  if (liveFetchOk) _setsCache = { data: sets, loadedAt: Date.now() }
  return sets
}

/** Same purpose as isPokemonSetsCacheReliable() — lets getSetsForGame() (lib/api/search.ts)
 * know whether its own wrapping cache is safe to populate from this call's result. */
export function isMtgSetsCacheReliable(): boolean {
  return _setsCache !== null
}

/**
 * Lightweight "did a brand new MTG set appear on Scryfall" check — a live sets fetch and a
 * comparison against the last-seen code list, with zero writes to `catalog/mtg/cards`. MTG is
 * deliberately left off the automatic 4x/day cron (a full sync is ~99k Firestore writes, enough
 * to blow through a Firebase Spark plan's daily quota in one run — see CLAUDE.md's MTG section),
 * which otherwise means a new MTG set can go unnoticed indefinitely until someone happens to
 * remember to click the manual Sync button. This closes that visibility gap safely: the cron can
 * call it every run, and it costs nothing but a Scryfall read plus one small Firestore doc write
 * (sync_status/mtg-new-set-check — a distinct doc from sync_status/mtg, the real sync's own
 * status, so this never overwrites that history).
 */
export async function checkForNewMtgSets(): Promise<{ newSets: string[] }> {
  // Unlike the real per-game sync routes, this function is never guaranteed to run alongside one
  // of ensureSignedIn()'s own calls — it used to only "work" by coincidence, racing against the
  // other games' sign-ins inside the cron's Promise.allSettled. Sign in explicitly so this stays
  // correct even if it's ever called on its own (a future admin button, a test, a reordering).
  await ensureAdminAuth()

  const sets = await getMtgSets()
  const codes = sets.filter((s) => s.source !== 'manual').map((s) => s.code)

  const ref = doc(db, 'sync_status', 'mtg-new-set-check')
  const snap = await getDoc(ref)
  const known: string[] = snap.exists() ? (snap.data().codes ?? []) : []
  const isFirstRun = known.length === 0
  const knownSet = new Set(known)
  const newCodes = codes.filter((c) => !knownSet.has(c))

  // merge: true — recordSyncStatus() (lib/api/syncStatus.ts) writes its own ok/at/newSets/error
  // fields to this exact same doc id right after this call returns. See that file's comment;
  // the two writers' field sets are disjoint by design, so merging is safe.
  await setDoc(ref, { codes, updatedAt: new Date().toISOString() }, { merge: true })

  // First-ever run has no real baseline — every set would otherwise report as "new", which is
  // noise, not a finding.
  return { newSets: isFirstRun ? [] : newCodes }
}

/** Drops the cached MTG set list — called after registering a new custom set so it shows up
 * without waiting for the hour-long staleness window to lapse. */
export function invalidateMtgSetsCache() {
  _setsCache = null
}

export async function searchMtgCards(query: string): Promise<MtgCard[]> {
  if (!query.trim()) return []
  const { nameQuery, numberFilter } = parseSearchQuery(query)
  if (!nameQuery) return []
  const cards = await loadVisibleCatalog<MtgCard>('mtg')
  return cards
    .filter((c) => !numberFilter || normNum(c.number) === normNum(numberFilter))
    .map((c) => ({ c, score: scoreMatch(c.name, nameQuery) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ c }) => c)
}
