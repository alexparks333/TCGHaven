import { loadVisibleCatalog, scoreMatch, parseSearchQuery, normNum } from './catalog'
import { getOnePieceRegistrySets } from './registry'

export interface OnePieceCard {
  id: string        // apitcg's own id — e.g. "OP01-024" (regular), "OP01-024_p1" (parallel)
  name: string
  set: string        // print-numbering prefix, e.g. "OP01", "EB02" (see catalog-sync.mjs)
  setName: string
  number: string
  rarity?: string    // L, C, UC, R, SR, SEC, "SP CARD"
  imageUrl?: string
  marketPrice?: number
  hidden?: boolean
}

export interface OnePieceSet {
  code: string
  name: string
  releaseDate: string
  cardCount: number
  source?: string
}

// Fallback used only if the registry (Firestore registry/main doc) is missing or empty —
// mirrors RIFTBOUND_SETS_FALLBACK's existing pattern. One Piece has no live external "sets" API
// (unlike Pokemon), so — like Riftbound — the registry itself is the set list, populated by
// app/api/sync/onepiece/route.ts the first time a sync runs.
const ONEPIECE_SETS_FALLBACK: OnePieceSet[] = []

export async function getOnePieceSets(): Promise<OnePieceSet[]> {
  const registrySets = await getOnePieceRegistrySets()
  if (registrySets.length === 0) return ONEPIECE_SETS_FALLBACK
  return registrySets.map((s) => ({
    code: s.code,
    name: s.setName,
    releaseDate: s.releaseDate ?? '',
    cardCount: s.cardCount,
    source: s.source,
  }))
}

export async function searchOnePieceCards(query: string): Promise<OnePieceCard[]> {
  if (!query.trim()) return []
  const { nameQuery, numberFilter } = parseSearchQuery(query)
  if (!nameQuery) return []
  const cards = await loadVisibleCatalog<OnePieceCard>('onepiece')
  return cards
    .filter((c) => !numberFilter || normNum(c.number) === normNum(numberFilter))
    .map((c) => ({ c, score: scoreMatch(c.name, nameQuery) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ c }) => c)
}
