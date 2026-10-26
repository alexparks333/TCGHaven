import type { Game } from '../types'
import { RARITY_LABELS_BY_GAME } from '../utils'
import type { SearchableCard, SearchOptions } from './cardSearch'

// Per-game "item specifics" a search can match beyond the card's own name/set/rarity fields —
// the words a collector actually types for a variant ("ahri signature", "shanks parallel",
// "zoro secret rare") even though the catalog stores something terser (rarity "Star", an id
// suffix "_p1", rarity "SEC"). Every caller that searches a game's catalog must pass the same
// options: cardSearch.ts caches each card's search index on first use.
export function searchOptionsFor(game: Game): SearchOptions {
  const labels = RARITY_LABELS_BY_GAME[game] ?? {}
  return {
    extraTerms: (card: SearchableCard & { cardType?: string }) => {
      const parts: string[] = []
      if (card.rarity && labels[card.rarity]) parts.push(labels[card.rarity])
      if (game === 'riftbound' && card.cardType) parts.push(card.cardType)
      if (game === 'onepiece' && /_p\d+$/.test(card.id)) parts.push('parallel alt art alternate')
      return parts.join(' ') || undefined
    },
  }
}
