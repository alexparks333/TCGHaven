import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'

// Single source of truth for Lorcana/Riftbound set metadata that used to be hardcoded
// across CardexPage.tsx, the pack-analysis route, and lib/api/{lorcana,riftbound}.ts, then
// lived in data/set-registry.json before moving to Firestore (registry/main) so the Admin
// Catalog sync routes can write it from a Vercel serverless function, which has no writable
// local filesystem. Reads are cached in-process with a short staleness window (like
// lib/api/catalog.ts, just without the chunked-snapshot machinery — this doc is tiny) rather
// than the old "always re-read the file" approach, since a Firestore read isn't free the way a
// local fs read was.

// Pokemon has no cardexGroup/packAnalysis — it's not part of Pack Analysis, and unlike
// Lorcana/Riftbound its Cardex groups aren't registry-curated at all: CardexPage.tsx derives
// them automatically from the live api.pokemontcg.io `series` field instead (see CLAUDE.md
// quirk #9 for why hand-curating a cardexGroup per set isn't worth it for 170+ Pokemon sets). A
// manual entry here exists purely to make a custom set addable/searchable in the catalog, the
// same way Lorcana/Riftbound custom sets are — it still shows up in the Cardex too, just in its
// own "Custom Sets" group rather than a real era (see buildPokemonGroups() in CardexPage.tsx).
export interface PokemonRegistrySet {
  setName: string
  code: string | null
  releaseDate: string | null
  source: string
}

export interface LorcanaRegistrySet {
  setName: string
  code: string | null
  lorcastId: string | null
  releaseDate: string | null
  cardexGroup: string | null
  cardexLabel?: string
  packAnalysis: { included: boolean; id?: string; released?: string; packPrice?: number; hasEpic?: boolean }
  needsReview: boolean
  source: string
}

export interface RiftboundRegistrySet {
  setName: string
  setCode: string
  releaseDate: string | null
  cardCount: number
  cardexGroup: string | null
  tcgcsvGroupId: number | null
  groupMatchConfidence: number | null
  needsReview: boolean
  source: string
}

// One Piece has no live external "sets" API (unlike Pokemon) and no group-name-matching
// ambiguity for prices (unlike Riftbound — see catalog-sync.mjs's downloadOnePiece() comment:
// tcgcsv's extNumber IS the card code, so there's nothing to fuzzy-match). That means this
// registry entry is simpler than either: no tcgcsvGroupId/groupMatchConfidence/needsReview, but
// (like Riftbound) it IS the authoritative set list — app/api/sync/onepiece/route.ts backfills
// new entries here the same way Riftbound's sync route does, since there's no live API to read
// the set list from instead. No cardexGroup either — CardexPage.tsx's buildOnePieceGroups()
// derives the Cardex grouping automatically from `code`'s prefix (OP/ST/EB/PRB vs everything
// else), the same "don't hand-curate 50+ sets" reasoning as Pokemon's series-based grouping.
export interface OnePieceRegistrySet {
  setName: string
  code: string    // e.g. "OP01", "ST13", "EB01" — a promo/event "set" with no official bracketed
                   // code (e.g. a single-card tournament giveaway) falls back to its card's own
                   // print-numbering prefix instead, so this is never actually empty in practice
  releaseDate: string | null
  cardCount: number
  source: string
  addedAt?: string  // when an auto-detected sync discovered this set, for Settings/debugging
}

// Magic has a live external "sets" API (api.scryfall.com/sets) exactly like Pokemon does, so —
// same reasoning as PokemonRegistrySet above — this registry entry exists purely to make a
// custom/manual set (Admin Catalog "New Set") addable/searchable, not to describe real upstream
// sets (those come live from Scryfall, never written here). No cardexGroup either: MTG's Cardex
// grouping is derived automatically from Scryfall's own `set_type` field, the same "don't
// hand-curate hundreds of sets" reasoning as Pokemon's series-based grouping — see CLAUDE.md
// quirk #9 and buildMtgGroups() in CardexPage.tsx.
export interface MtgRegistrySet {
  setName: string
  code: string | null
  releaseDate: string | null
  source: string
}

export interface SetRegistry {
  schemaVersion: number
  pokemon: { sets: PokemonRegistrySet[] }
  lorcana: { groupOrder: string[]; sets: LorcanaRegistrySet[] }
  riftbound: { groupOrder: string[]; sets: RiftboundRegistrySet[] }
  onepiece: { sets: OnePieceRegistrySet[] }
  mtg: { sets: MtgRegistrySet[] }
}

const EMPTY_REGISTRY: SetRegistry = {
  schemaVersion: 1,
  pokemon: { sets: [] },
  lorcana: { groupOrder: [], sets: [] },
  riftbound: { groupOrder: [], sets: [] },
  onepiece: { sets: [] },
  mtg: { sets: [] },
}

const REGISTRY_DOC_PATH = ['registry', 'main'] as const
const STALE_MS = 2 * 60 * 1000 // same staleness window as lib/api/catalog.ts

let _cache: { data: SetRegistry; loadedAt: number } | null = null

export function invalidateRegistryCache() {
  _cache = null
}

export async function loadSetRegistry(): Promise<SetRegistry> {
  if (_cache && Date.now() - _cache.loadedAt < STALE_MS) return _cache.data
  const snap = await getDoc(doc(db, ...REGISTRY_DOC_PATH))
  // Merge over EMPTY_REGISTRY rather than trusting the stored doc alone — the real Firestore
  // document predates every game added after the registry's first write, so a brand-new game
  // key (e.g. `onepiece`) is genuinely `undefined` on it at runtime despite `SetRegistry` (and
  // the `as` cast below) claiming it's always present. Without this merge, every reader of
  // `registry.onepiece.sets` throws "Cannot read properties of undefined" the first time it
  // runs against real production data — caught when One Piece's own sync route hit exactly that.
  const data = snap.exists() ? { ...EMPTY_REGISTRY, ...(snap.data() as Partial<SetRegistry>) } : EMPTY_REGISTRY
  _cache = { data, loadedAt: Date.now() }
  return data
}

// Callers must have already authenticated the shared `auth` instance as the admin sync
// account (see lib/firebase/adminAuth.ts's ensureAdminAuth()) — Firestore rejects this write
// otherwise (see the `registry/{doc}` rule in firestore.rules).
export async function saveSetRegistry(registry: SetRegistry): Promise<void> {
  await setDoc(doc(db, ...REGISTRY_DOC_PATH), registry)
  _cache = { data: registry, loadedAt: Date.now() }
}

export async function getPokemonRegistrySets(): Promise<PokemonRegistrySet[]> {
  return (await loadSetRegistry()).pokemon.sets
}

export async function getLorcanaRegistrySets(): Promise<LorcanaRegistrySet[]> {
  return (await loadSetRegistry()).lorcana.sets
}

export async function getRiftboundRegistrySets(): Promise<RiftboundRegistrySet[]> {
  return (await loadSetRegistry()).riftbound.sets
}

export async function getOnePieceRegistrySets(): Promise<OnePieceRegistrySet[]> {
  return (await loadSetRegistry()).onepiece.sets
}

export async function getMtgRegistrySets(): Promise<MtgRegistrySet[]> {
  return (await loadSetRegistry()).mtg.sets
}

export async function getLorcanaBoosterSets() {
  return (await getLorcanaRegistrySets())
    .filter((s) => s.packAnalysis?.included)
    .map((s) => ({
      name: s.setName,
      id: s.packAnalysis.id ?? s.code ?? s.setName,
      released: s.packAnalysis.released ?? s.releaseDate ?? '',
      packPrice: s.packAnalysis.packPrice ?? 5.99,
      hasEpic: !!s.packAnalysis.hasEpic,
    }))
}
