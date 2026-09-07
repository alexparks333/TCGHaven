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
  try {
    const res = await fetch('https://api.scryfall.com/sets', { headers: SCRYFALL_HEADERS })
    if (res.ok) {
      const data = await res.json()
      sets = (data.data ?? [])
        .filter((s: { digital?: boolean; set_type?: string }) => !s.digital && !MTG_EXCLUDED_SET_TYPES.has(s.set_type ?? ''))
        .map((s: { code: string; name: string; released_at?: string; card_count?: number; set_type?: string }) => ({
          code: s.code,
          name: s.name,
          releaseDate: s.released_at ?? '',
          cardCount: s.card_count ?? 0,
          setType: s.set_type,
        }))
    }
  } catch {
    // fall through — manual sets below still get returned even if Scryfall is unreachable
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

  if (sets.length > 0) _setsCache = { data: sets, loadedAt: Date.now() }
  return sets
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
