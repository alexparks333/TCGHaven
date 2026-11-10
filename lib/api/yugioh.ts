// Yu-Gi-Oh! — the catalog (catalog/yugioh, from TCGplayer: scripts/lib/yugioh-tcgplayer.mjs) and
// its set list (catalog_meta/yugioh.sets, written by the sync). Docs: docs/games.md (Yu-Gi-Oh!).
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { loadVisibleCatalog } from './catalog'
import { rankCards } from './cardSearch'
import { searchOptionsFor } from './searchTerms'

export interface YugiohCard {
  id: string            // tcg-{productId}
  name: string           // as printed
  variant?: string       // TCGplayer's version: "Starlight Rare", "Extended Art", "Quarter Century Secret Rare"…
  number: string         // printed set code + number, "MAMS-EN001"
  set: string            // set code, "MAMS"
  setName: string
  rarity?: string
  cardType?: string
  attribute?: string
  imageUrl?: string
  marketPrice?: number
  lowPriceNM?: number
  variantPrices?: Record<string, number>  // "1st:normal" / "unlimited:normal" / "limited:normal" → price
  hidden?: boolean
}

export interface YugiohSet {
  id: string
  code: string
  name: string
  releaseDate: string
  cardCount: number
  setType: string        // yugioh-tcgplayer.mjs setTypeOf(): booster / structure / starter / tin / special / promo
}

// The set list the sync writes. Cached briefly (a sync invalidates it on this server).
let _sets: { at: number; sets: YugiohSet[] } | null = null
const SETS_TTL_MS = 10 * 60 * 1000

export async function getYugiohSets(): Promise<YugiohSet[]> {
  if (_sets && Date.now() - _sets.at < SETS_TTL_MS) return _sets.sets
  const sets = ((await getDoc(doc(db, 'catalog_meta', 'yugioh'))).data()?.sets ?? []) as YugiohSet[]
  if (sets.length) _sets = { at: Date.now(), sets }
  return sets
}

export function invalidateYugiohSetsCache() {
  _sets = null
}

// `onlyId` skips ranking and returns just that catalog card (the Cardex's "add this card").
export async function searchYugiohCards(query: string, onlyId?: string): Promise<YugiohCard[]> {
  if (!query.trim()) return []
  const cards = await loadVisibleCatalog<YugiohCard>('yugioh')
  if (onlyId) return cards.filter((c) => c.id === onlyId)
  return rankCards(cards, query, searchOptionsFor('yugioh'))
}

/** The name shown in search and Add Card: the printed name + its version, "Blue-Eyes … (Starlight Rare)" */
export function yugiohDisplayName(c: Pick<YugiohCard, 'name' | 'variant'>): string {
  return c.variant ? `${c.name} (${c.variant})` : c.name
}
