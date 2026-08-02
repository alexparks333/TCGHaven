import { readFileSync } from 'fs'
import { join } from 'path'

// Single source of truth for Lorcana/Riftbound set metadata that used to be hardcoded
// across CardexPage.tsx, the pack-analysis route, and lib/api/{lorcana,riftbound}.ts.
// The Settings "Sync Card Data" feature appends newly-discovered sets here instead of
// editing TypeScript source. Deliberately uncached (unlike lib/api/catalog.ts's card
// JSON cache) — this file is tiny, and always re-reading it means Settings-page edits
// are reflected immediately with no invalidation plumbing.

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
  lorcana: { groupOrder: string[]; sets: LorcanaRegistrySet[] }
  riftbound: { groupOrder: string[]; sets: RiftboundRegistrySet[] }
}

const EMPTY_REGISTRY: SetRegistry = {
  schemaVersion: 1,
  lorcana: { groupOrder: [], sets: [] },
  riftbound: { groupOrder: [], sets: [] },
}

export function loadSetRegistry(): SetRegistry {
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'set-registry.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return EMPTY_REGISTRY
  }
}

export function getLorcanaRegistrySets(): LorcanaRegistrySet[] {
  return loadSetRegistry().lorcana.sets
}

export function getRiftboundRegistrySets(): RiftboundRegistrySet[] {
  return loadSetRegistry().riftbound.sets
}

export function getLorcanaBoosterSets() {
  return getLorcanaRegistrySets()
    .filter((s) => s.packAnalysis?.included)
    .map((s) => ({
      name: s.setName,
      id: s.packAnalysis.id ?? s.code ?? s.setName,
      released: s.packAnalysis.released ?? s.releaseDate ?? '',
      packPrice: s.packAnalysis.packPrice ?? 5.99,
      hasEpic: !!s.packAnalysis.hasEpic,
    }))
}
