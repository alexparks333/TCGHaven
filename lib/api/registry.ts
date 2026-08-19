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

// Pokemon has no cardexGroup/packAnalysis — it isn't part of the Cardex or Pack Analysis
// features at all (see CLAUDE.md quirk #9: too many cards/sets for a Pokedex-style grid), so a
// manual entry here exists purely to make a custom set addable/searchable in the catalog, the
// same way Lorcana/Riftbound custom sets are.
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

export interface SetRegistry {
  schemaVersion: number
  pokemon: { sets: PokemonRegistrySet[] }
  lorcana: { groupOrder: string[]; sets: LorcanaRegistrySet[] }
  riftbound: { groupOrder: string[]; sets: RiftboundRegistrySet[] }
}

const EMPTY_REGISTRY: SetRegistry = {
  schemaVersion: 1,
  pokemon: { sets: [] },
  lorcana: { groupOrder: [], sets: [] },
  riftbound: { groupOrder: [], sets: [] },
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
  const data = snap.exists() ? (snap.data() as SetRegistry) : EMPTY_REGISTRY
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
