// The TCGplayer-sourced games — Star Wars: Unlimited, Gundam, Flesh and Blood, Digimon, Palworld, Cyberpunk:
// their catalogs (catalog/{game}, built by scripts/lib/tcgplayer-games.mjs) and set lists
// (catalog_meta/{game}.sets, written by the sync). Docs: docs/games.md ("TCGplayer-sourced games").
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { loadVisibleCatalog } from './catalog'
import { rankCards } from './cardSearch'
import { searchOptionsFor } from './searchTerms'
import type { TcgplayerSourcedGame } from '../types'

export interface TcgplayerGameCard {
  id: string            // tcg-{productId}
  name: string           // as printed ("Rising Energy (Red)", "Han Solo - I Got a Really Good Feeling")
  variant?: string       // TCGplayer's version: "Hyperspace Foil", "LR+", "Alternate Art", "Marvel"…
  number: string         // as printed: "228/262", "GD01-118", "WTR040", "BT26-066", "EBP01-001"
  set: string            // set code (TCGplayer's abbreviation)
  setName: string
  rarity?: string
  cardType?: string
  color?: string         // Gundam / Digimon / Palworld colour
  aspect?: string        // Star Wars: Unlimited aspect
  cardClass?: string     // Flesh and Blood class
  imageUrl?: string      // '' until TCGplayer has a photo
  marketPrice?: number
  marketPriceFoil?: number
  lowPriceNM?: number
  lowPriceNMFoil?: number
  variantPrices?: Record<string, number>  // Flesh and Blood: "1st:rainbow" / "unlimited:cold"… → price
  hidden?: boolean
}

export interface TcgplayerGameSet {
  id: string
  code: string
  name: string
  releaseDate: string
  cardCount: number
  setType: string        // tcgplayer-games.mjs setTypeOf()
}

// The set lists the sync writes. Cached briefly per game.
const _sets: Partial<Record<TcgplayerSourcedGame, { at: number; sets: TcgplayerGameSet[] }>> = {}
const SETS_TTL_MS = 10 * 60 * 1000

export async function getTcgplayerGameSets(game: TcgplayerSourcedGame): Promise<TcgplayerGameSet[]> {
  const hit = _sets[game]
  if (hit && Date.now() - hit.at < SETS_TTL_MS) return hit.sets
  const sets = ((await getDoc(doc(db, 'catalog_meta', game))).data()?.sets ?? []) as TcgplayerGameSet[]
  if (sets.length) _sets[game] = { at: Date.now(), sets }
  return sets
}

export function invalidateTcgplayerGameSetsCache(game: TcgplayerSourcedGame) {
  delete _sets[game]
}

// `onlyId` skips ranking and returns just that catalog card (the Cardex's "add this card").
export async function searchTcgplayerGameCards(game: TcgplayerSourcedGame, query: string, onlyId?: string): Promise<TcgplayerGameCard[]> {
  if (!query.trim()) return []
  const cards = await loadVisibleCatalog<TcgplayerGameCard>(game)
  if (onlyId) return cards.filter((c) => c.id === onlyId)
  return rankCards(cards, query, searchOptionsFor(game))
}

/** The name shown in search, Add Card and the Cardex: the printed name + its version */
export function tcgplayerGameDisplayName(c: Pick<TcgplayerGameCard, 'name' | 'variant'>): string {
  return c.variant ? `${c.name} (${c.variant})` : c.name
}
