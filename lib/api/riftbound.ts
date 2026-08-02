import { loadCatalog, scoreMatch, parseSearchQuery, normNum } from './catalog'
import { getRiftboundRegistrySets } from './registry'

export interface RiftboundCard {
  id: string
  name: string
  number: string
  publicCode?: string
  setCode: string
  setName: string
  rarity?: string
  cardType?: string
  tags?: string[]
  imageUrl?: string
  marketPrice?: number
  marketPriceFoil?: number
  lowPriceNM?: number
  lowPriceNMFoil?: number
}

export interface RiftboundSet {
  code: string
  name: string
  releaseDate: string
  cardCount: number
}

// Fallback used only if data/set-registry.json is missing (e.g. first run before
// the registry migration lands) — mirrors LORCANA_SETS_FALLBACK's existing pattern.
const RIFTBOUND_SETS_FALLBACK: RiftboundSet[] = [
  { code: 'OGN', name: 'Origins', releaseDate: '2025-10-31', cardCount: 298 },
  { code: 'SFD', name: 'Spiritforged', releaseDate: '2026-02-13', cardCount: 221 },
  { code: 'UNL', name: 'Unleashed', releaseDate: '2026-05-08', cardCount: 219 },
  { code: 'VEN', name: 'Vendetta', releaseDate: '2026-07-31', cardCount: 228 },
  { code: 'RAD', name: 'Radiance', releaseDate: '2026-10-01', cardCount: 0 },
]

export function getRiftboundSets(): RiftboundSet[] {
  const registrySets = getRiftboundRegistrySets()
  if (registrySets.length === 0) return RIFTBOUND_SETS_FALLBACK
  return registrySets.map((s) => ({
    code: s.setCode,
    name: s.setName,
    releaseDate: s.releaseDate ?? '',
    cardCount: s.cardCount,
  }))
}

export async function searchRiftboundCards(query: string): Promise<RiftboundCard[]> {
  if (!query.trim()) return []
  const { nameQuery, numberFilter } = parseSearchQuery(query)
  if (!nameQuery) return []
  const cards = loadCatalog<RiftboundCard>('riftbound-cards.json')
  return cards
    .filter((c) => !numberFilter || normNum(c.number) === normNum(numberFilter))
    .map((c) => ({ c, score: scoreMatch(c.name, nameQuery, c.tags) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ c }) => c)
}
