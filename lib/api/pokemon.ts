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
  try {
    const res = await fetch(`${BASE_URL}/sets?orderBy=releaseDate&pageSize=250`, { headers: HEADERS })
    if (res.ok) {
      const data = await res.json()
      sets = data.data ?? []
    }
  } catch {
    // fall through — manual sets below still get returned even if the live API is unreachable
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
  // Only cache a non-empty result — a transient API failure shouldn't
  // pin an empty set list in memory for the life of the process
  if (sets.length > 0) _setsCache = sets
  return sets
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
