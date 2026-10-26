import { loadVisibleCatalog } from './catalog'
import { rankCards } from './cardSearch'
import { searchOptionsFor } from './searchTerms'
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
  hidden?: boolean
}

export interface RiftboundSet {
  code: string
  name: string
  releaseDate: string
  cardCount: number
  source?: string
}

// Fallback used only if the registry (Firestore registry/main doc) is missing or empty —
// mirrors LORCANA_SETS_FALLBACK's existing pattern.
const RIFTBOUND_SETS_FALLBACK: RiftboundSet[] = [
  { code: 'OGN', name: 'Origins', releaseDate: '2025-10-31', cardCount: 298 },
  { code: 'SFD', name: 'Spiritforged', releaseDate: '2026-02-13', cardCount: 221 },
  { code: 'UNL', name: 'Unleashed', releaseDate: '2026-05-08', cardCount: 219 },
  { code: 'VEN', name: 'Vendetta', releaseDate: '2026-07-31', cardCount: 228 },
  { code: 'RAD', name: 'Radiance', releaseDate: '2026-10-01', cardCount: 0 },
]

export async function getRiftboundSets(): Promise<RiftboundSet[]> {
  const registrySets = await getRiftboundRegistrySets()
  if (registrySets.length === 0) return RIFTBOUND_SETS_FALLBACK
  return registrySets.map((s) => ({
    code: s.setCode,
    name: s.setName,
    releaseDate: s.releaseDate ?? '',
    cardCount: s.cardCount,
    source: s.source,
  }))
}

// `onlyId` skips ranking and returns just that catalog card (the Cardex's "add this card").
export async function searchRiftboundCards(query: string, onlyId?: string): Promise<RiftboundCard[]> {
  if (!query.trim()) return []
  const cards = await loadVisibleCatalog<RiftboundCard>('riftbound')
  if (onlyId) return cards.filter((c) => c.id === onlyId)
  return rankCards(cards, query, searchOptionsFor('riftbound'))
}
