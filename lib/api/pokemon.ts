import { loadVisibleCatalog, scoreMatch, parseSearchQuery, normNum } from './catalog'
import { getPokemonRegistrySets } from './registry'

const BASE_URL = 'https://api.pokemontcg.io/v2'

const HEADERS: Record<string, string> = process.env.POKEMON_TCG_API_KEY
  ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY }
  : {}

export interface PokemonCard {
  id: string
  name: string
  set: { id: string; name: string }
  number: string
  images: { small: string; large: string }
  tcgplayer?: {
    prices?: {
      holofoil?: { market: number; low?: number }
      normal?: { market: number; low?: number }
      reverseHolofoil?: { market: number; low?: number }
      '1stEditionHolofoil'?: { market: number; low?: number }
    }
  }
}

export interface PokemonSet {
  id: string
  name: string
  series: string
  releaseDate: string
  total: number
  images: { symbol: string; logo: string }
  source?: string
}

// ── Static catalog search (built by npm run download-cards) ──────────────────

interface CatalogCard {
  id: string
  name: string
  set: string
  setName: string
  number: string
  imageUrl: string
  marketPrice: number
  marketPriceFoil: number
  lowPriceNM: number
  lowPriceNMFoil: number
  hidden?: boolean
}

export async function searchPokemonCards(query: string): Promise<PokemonCard[]> {
  if (!query.trim()) return []
  const catalog = await loadVisibleCatalog<CatalogCard>('pokemon')
  if (catalog.length > 0) {
    const { nameQuery, numberFilter } = parseSearchQuery(query)
    if (!nameQuery) return []
    return catalog
      .filter((c) => !numberFilter || normNum(c.number) === normNum(numberFilter))
      .map((c) => ({ c, score: scoreMatch(c.name, nameQuery) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(({ c }) => ({
        id: c.id,
        name: c.name,
        set: { id: c.set, name: c.setName },
        number: c.number,
        images: { small: c.imageUrl, large: c.imageUrl },
        // Carry prices from the catalog into the search result
        tcgplayer: {
          prices: {
            normal: c.marketPrice > 0 ? { market: c.marketPrice, low: c.lowPriceNM || undefined } : undefined,
            holofoil: c.marketPriceFoil > 0 ? { market: c.marketPriceFoil, low: c.lowPriceNMFoil || undefined } : undefined,
          },
        },
      }))
  }
  // Fallback: live API
  try {
    const res = await fetch(
      `${BASE_URL}/cards?q=name:"${encodeURIComponent(query)}*"&pageSize=20&orderBy=name`,
      { headers: HEADERS }
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.data ?? []
  } catch {
    return []
  }
}

let _setsCache: PokemonSet[] | null = null

export async function getPokemonSets(): Promise<PokemonSet[]> {
  if (_setsCache) return _setsCache
  let sets: PokemonSet[] = []
  let liveFetchOk = false
  // api.pokemontcg.io/v2/sets is genuinely flaky in practice — observed real-world error rates
  // as high as 50-60% of requests (500s/502s) while diagnosing why a newly-released set wasn't
  // showing up. One failed attempt (or three) shouldn't be allowed to define this whole
  // process's view of the catalog, so retry with backoff before giving up. This only costs
  // latency on the rare call that actually has to hit the live API — once it succeeds, the
  // in-memory cache above serves every request after that for free.
  for (let attempt = 0; attempt < 5 && !liveFetchOk; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt))
    try {
      // no-store: without this, Next.js's own fetch Data Cache (disk-backed under .next/cache,
      // survives a dev-server restart) can pin a response from before a new set existed — this
      // is the in-memory `_setsCache` above's problem all over again, one layer further down
      // and outside our own control to invalidate. This is a genuinely live endpoint
      // (`getPokemonSets()` is already cached in-memory for that purpose); Next's own fetch
      // cache should never be the thing deciding freshness here.
      const res = await fetch(`${BASE_URL}/sets?orderBy=releaseDate&pageSize=250`, { headers: HEADERS, cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const fetched: PokemonSet[] = data.data ?? []
        // A degraded upstream has been observed returning 200 OK with an empty `data` array
        // (not just outright 5xx) — treating that as "success" would let an empty result slip
        // past the retry loop and get permanently cached below, same failure mode as the 5xx
        // case this loop already guards against.
        if (fetched.length > 0) {
          sets = fetched
          liveFetchOk = true
        }
      }
    } catch {
      // try again, or fall through to manual-only after the last attempt
    }
  }
  // Sets created via the Admin Catalog "New Set" form ("source": "manual" in
  // the registry) don't exist on api.pokemontcg.io at all, so the live fetch above will
  // never include them — merge them in regardless of whether that fetch succeeded, same as
  // getLorcanaSets() already does for Lorcana's manual sets.
  const manualOnly = (await getPokemonRegistrySets()).filter(
    (s) => s.source === 'manual' && !sets.some((x) => x.name === s.setName),
  )
  if (manualOnly.length > 0) {
    sets = [...sets, ...manualOnly.map((s) => ({
      id: s.code || s.setName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, ''),
      name: s.setName,
      series: 'Custom',
      releaseDate: s.releaseDate ?? '',
      total: 0,
      images: { symbol: '', logo: '' },
      source: 'manual',
    }))]
  }
  // Only cache when the live fetch actually succeeded — a manual-only (or empty) list reflects
  // a transient upstream failure surviving all retries, not the real catalog, and caching that
  // would pin the partial view in memory for the rest of this process's life. This is exactly
  // what happened once already while diagnosing why a newly-released set wasn't showing up.
  if (liveFetchOk) _setsCache = sets
  return sets
}

/** Whether the last getPokemonSets() call (this one or an earlier one in this process) actually
 * got a real result from the live API, vs. falling back to manual-only after every retry failed.
 * getSetsForGame() (lib/api/search.ts) needs this — its own wrapping cache only checks
 * "non-empty" before pinning a result for the rest of the process's life, which a manual-only
 * fallback (rarely empty — there's often at least one custom set) satisfies just fine. Without
 * this check, a single unlucky moment of complete pokemontcg.io downtime permanently reduces the
 * whole Cardex/AddCardDialog set picker down to whatever manual sets exist — this happened for
 * real while diagnosing why a newly-released set wasn't showing up. */
export function isPokemonSetsCacheReliable(): boolean {
  return _setsCache !== null
}

/** Drops the cached Pokemon set list — called after registering a new custom set so it shows
 * up without waiting for server restart (this cache never expires on its own otherwise). */
export function invalidatePokemonSetsCache() {
  _setsCache = null
}

export async function getPokemonCardPrice(apiId: string, isFoil: boolean): Promise<number | null> {
  try {
    const res = await fetch(`${BASE_URL}/cards/${apiId}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const prices = data.data?.tcgplayer?.prices
    if (!prices) return null
    const price = isFoil
      ? prices.holofoil?.market ?? prices.reverseHolofoil?.market
      : prices.normal?.market ?? prices.holofoil?.market
    return price ?? null
  } catch {
    return null
  }
}

export function getPokemonCardMarketPrice(card: PokemonCard, isFoil: boolean): number {
  const prices = card.tcgplayer?.prices
  if (!prices) return 0
  if (isFoil) return prices.holofoil?.market ?? prices.reverseHolofoil?.market ?? prices.normal?.market ?? 0
  return prices.normal?.market ?? prices.holofoil?.market ?? 0
}
