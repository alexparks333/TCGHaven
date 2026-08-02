import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'

// TypeScript-side mirror of scripts/lib/custom-catalog.mjs's schema. Kept separate rather
// than cross-importing the .mjs script — that file lives outside the Next.js build graph
// (unbundled, run standalone by node) and this one is a small, easily-kept-in-sync duplicate
// used only by the Admin Catalog API routes below.

export type CatalogGame = 'pokemon' | 'lorcana' | 'riftbound'

export interface CustomCatalogSide {
  additions: Array<Record<string, unknown> & { id: string }>
  exclusions: string[]
}

export type CustomCatalog = Record<CatalogGame, CustomCatalogSide>

const PATH = join(process.cwd(), 'data', 'custom-catalog.json')

const EMPTY_SIDE: CustomCatalogSide = { additions: [], exclusions: [] }
const EMPTY: CustomCatalog = { pokemon: { ...EMPTY_SIDE }, lorcana: { ...EMPTY_SIDE }, riftbound: { ...EMPTY_SIDE } }

export function loadCustomCatalog(): CustomCatalog {
  try {
    return JSON.parse(readFileSync(PATH, 'utf-8'))
  } catch {
    return EMPTY
  }
}

export function saveCustomCatalog(data: CustomCatalog) {
  const tmp = PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, PATH)
}
