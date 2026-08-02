import { loadCatalog, scoreMatch, parseSearchQuery, normNum } from './catalog'
import { getLorcanaRegistrySets } from './registry'

const BASE = 'https://api.lorcast.com/v0'

export interface LorcanaCard {
  id: string
  name: string
  version?: string
  collector_number: string
  rarity: string
  set: { id: string; name: string; code: string }
  image_uris?: { digital?: { small?: string; normal?: string; large?: string } }
  prices?: { usd?: number; usd_foil?: number | null }
}

export interface LorcanaSet {
  id: string
  code: string
  name: string
  card_count?: number
  released_at?: string
}

// ── Static catalog search (built by npm run download-cards) ──────────────────

interface LorcanaCatalogCard {
  id: string
  name: string
  set: string
  setName: string
  number: string
  rarity: string
  imageUrl: string
  marketPrice: number
  marketPriceFoil: number
}

// Lorcana tiebreaker: small bonus when the first query word matches the start
// of the card's version subtitle ("Mickey Mouse - Bob Cratchit" → "bob").
function scoreLorcanaMatch(name: string, query: string): number {
  const score = scoreMatch(name, query)
  if (score < 0) return score
  const n = name.toLowerCase()
  const first = query.toLowerCase().split(/\s+/).filter(Boolean)[0]
  const versionStart = n.includes(' - ') ? n.split(' - ').slice(1).join(' - ').split(/[\s\-·,']+/)[0] : null
  if (first && versionStart && (versionStart === first || versionStart.startsWith(first))) return score + 8
  return score
}

export async function searchLorcanaCards(query: string): Promise<LorcanaCard[]> {
  if (!query.trim()) return []
  const catalog = loadCatalog<LorcanaCatalogCard>('lorcana-cards.json')
  if (catalog.length > 0) {
    const { nameQuery, numberFilter } = parseSearchQuery(query)
    if (!nameQuery) return []
    return catalog
      .filter((c) => !numberFilter || normNum(c.number) === normNum(numberFilter))
      .map((c) => ({ c, score: scoreLorcanaMatch(c.name, nameQuery) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(({ c }) => {
        const [name, ...versionParts] = c.name.split(' - ')
        return {
          id: c.id,
          name,
          version: versionParts.length > 0 ? versionParts.join(' - ') : undefined,
          collector_number: c.number,
          rarity: c.rarity ?? '',
          set: { id: '', code: c.set, name: c.setName },
          image_uris: { digital: { small: c.imageUrl } },
          prices: { usd: c.marketPrice, usd_foil: c.marketPriceFoil },
        }
      })
  }
  // Fallback: live API
  try {
    const res = await fetch(`${BASE}/cards/search?q=${encodeURIComponent(query)}&page_size=20`)
    if (!res.ok) return []
    const data = await res.json()
    return data.results ?? data ?? []
  } catch {
    return []
  }
}

export async function getLorcanaSets(): Promise<LorcanaSet[]> {
  try {
    const res = await fetch(`${BASE}/sets`)
    if (!res.ok) return getRegistryLorcanaSets()
    const data = await res.json()
    return (data.results ?? data ?? []).length > 0 ? (data.results ?? data) : getRegistryLorcanaSets()
  } catch {
    return getRegistryLorcanaSets()
  }
}

// Fallback when the live lorcast /sets API is unreachable — sourced from
// data/set-registry.json (kept up to date by the Settings "Sync Card Data" feature)
// instead of a hardcoded array. LORCANA_SETS_MINIMAL_FALLBACK only covers the
// extremely unlikely case where the registry file itself is missing.
function getRegistryLorcanaSets(): LorcanaSet[] {
  const sets = getLorcanaRegistrySets()
  if (sets.length === 0) return LORCANA_SETS_MINIMAL_FALLBACK
  return sets.map((s) => ({
    id: s.lorcastId ?? '',
    code: s.code ?? '',
    name: s.setName,
    released_at: s.releaseDate ?? undefined,
  }))
}

const LORCANA_SETS_MINIMAL_FALLBACK: LorcanaSet[] = [
  { id: '1', code: 'TFC', name: 'The First Chapter', released_at: '2023-08-18' },
  { id: '2', code: 'ROF', name: 'Rise of the Floodborn', released_at: '2023-11-17' },
  { id: '3', code: 'ITI', name: 'Into the Inklands', released_at: '2024-02-23' },
]
