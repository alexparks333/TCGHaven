import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { updateSetRegistry, loadSetRegistry, invalidateRegistryCache, type RiftboundPlacement } from '@/lib/api/registry'

// Where each game's Needs Review (TCGplayer promo placements) lives.
//
// Riftbound and Lorcana keep theirs on registry/main (`riftbound.placements`, …). Pokémon has its
// own doc, registry/pokemon-review: it has thousands of TCGplayer promo products, and registry/main
// is a single Firestore document (1 MiB cap; ~311 bytes per placement). Same shape as a registry
// side, plus `baseline` — the promo products the first run accepted, by id only.
// Keep in sync with REVIEW_DOCS in scripts/lib/catalog-sync.mjs.

export type ReviewGame = 'riftbound' | 'lorcana' | 'pokemon'
export const REVIEW_GAMES: ReviewGame[] = ['riftbound', 'lorcana', 'pokemon']
const REVIEW_DOCS: Partial<Record<ReviewGame, string>> = { pokemon: 'pokemon-review' }

export interface ReviewSide {
  placements: RiftboundPlacement[]
  completedReviews: Array<{ at: string; completedAt: string }>
}

/** A set a reviewed card can be placed in. `id` = Pokémon's set id (its cards' `set` field). */
export interface ReviewSetInfo {
  setName: string
  setCode?: string
  code?: string | null
  id?: string
  tcgplayerOnly?: boolean
  tcgplayerRarity?: string
  cardexGroup?: string | null
}

/**
 * Pokémon's sets, for placing a reviewed card: the set list the sync saves (catalog_meta/pokemon —
 * GitHub's sets plus the ones built from TCGplayer) and custom sets from the Admin Catalog (the
 * registry, id as getPokemonSets() derives it). `cardexGroup` = the series (the Cardex's group).
 */
export async function loadPokemonReviewSets(): Promise<ReviewSetInfo[]> {
  // Live: a custom set made a moment ago (maybe on another server) must count
  invalidateRegistryCache()
  const [meta, registry] = await Promise.all([getDoc(doc(db, 'catalog_meta', 'pokemon')), loadSetRegistry()])
  const listed = ((meta.data()?.sets ?? []) as Array<{ id: string; name: string; series?: string }>)
    .map((s) => ({ setName: s.name, id: s.id, cardexGroup: s.series || 'Other' }))
  const custom = registry.pokemon.sets
    .filter((s) => s.source === 'manual' && !listed.some((x) => x.setName === s.setName))
    .map((s) => ({
      setName: s.setName,
      id: s.code || s.setName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, ''),
      cardexGroup: 'Custom Sets',
    }))
  return [...listed, ...custom]
}

export function isReviewGame(game: unknown): game is ReviewGame {
  return typeof game === 'string' && (REVIEW_GAMES as string[]).includes(game)
}

/** A game's review as stored now (live read, no cache). */
export async function loadReviewSide(game: ReviewGame): Promise<ReviewSide> {
  const own = REVIEW_DOCS[game]
  if (own) {
    const data = (await getDoc(doc(db, 'registry', own))).data() ?? {}
    return { placements: data.placements ?? [], completedReviews: data.completedReviews ?? [] }
  }
  const side = (await loadSetRegistry())[game as 'riftbound' | 'lorcana']
  return { placements: side.placements ?? [], completedReviews: side.completedReviews ?? [] }
}

/**
 * Runs `change` on the latest copy of a game's review, in a transaction (re-run if someone else
 * wrote meanwhile) — the same contract as updateSetRegistry(): `change` may run more than once and
 * must only edit what it's given. Throw RegistryRejection to save nothing. Callers must have run
 * ensureAdminAuth() first.
 */
export async function updateReviewSide<T>(
  game: ReviewGame,
  change: (side: ReviewSide, sets: ReviewSetInfo[]) => T,
  { sets: givenSets = [] }: { sets?: ReviewSetInfo[] } = {},
): Promise<T> {
  const own = REVIEW_DOCS[game]
  if (!own) {
    return updateSetRegistry((registry) => {
      const raw = registry[game as 'riftbound' | 'lorcana']
      const side: ReviewSide = { placements: raw.placements ?? [], completedReviews: raw.completedReviews ?? [] }
      // The latest registry's sets — one created a moment ago in another tab counts
      const result = change(side, raw.sets as ReviewSetInfo[])
      raw.placements = side.placements
      raw.completedReviews = side.completedReviews
      return result
    })
  }
  const ref = doc(db, 'registry', own)
  return runTransaction(db, async (tx) => {
    const data = (await tx.get(ref)).data() ?? {}
    const side: ReviewSide = structuredClone({ placements: data.placements ?? [], completedReviews: data.completedReviews ?? [] })
    const result = change(side, givenSets)
    // merge: keeps `baseline` (the sync's) untouched
    tx.set(ref, { placements: side.placements, completedReviews: side.completedReviews, updatedAt: serverTimestamp() }, { merge: true })
    return result
  })
}
