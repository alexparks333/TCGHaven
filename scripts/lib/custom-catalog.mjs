import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data')
const PATH = join(DATA_DIR, 'custom-catalog.json')

const EMPTY_SIDE = { additions: [], exclusions: [] }

export function loadCustomCatalog() {
  try {
    return JSON.parse(readFileSync(PATH, 'utf-8'))
  } catch {
    return { pokemon: { ...EMPTY_SIDE }, lorcana: { ...EMPTY_SIDE }, riftbound: { ...EMPTY_SIDE } }
  }
}

// Applies admin-managed hides/additions to a freshly-downloaded card array for one game,
// right before that game's own sort runs (so placement comes from the existing comparator,
// not bespoke insert logic). Fresh scraped data always wins an id collision against a custom
// addition — the addition's whole purpose was filling a gap that may no longer exist.
export function applyCustomCatalog(game, cards) {
  const side = loadCustomCatalog()[game] ?? EMPTY_SIDE
  const exclusions = new Set(side.exclusions ?? [])
  const filtered = cards.filter((c) => !exclusions.has(c.id))

  const ids = new Set(filtered.map((c) => c.id))
  for (const addition of side.additions ?? []) {
    if (exclusions.has(addition.id)) continue // exclusions always win, even over the admin's own addition
    if (ids.has(addition.id)) {
      console.log(`   custom-catalog: "${addition.id}" now present in fresh ${game} data — addition is redundant, skipping`)
      continue
    }
    filtered.push(addition)
    ids.add(addition.id)
  }

  if (exclusions.size > 0 || (side.additions ?? []).length > 0) {
    console.log(`   custom-catalog (${game}): ${exclusions.size} excluded, ${(side.additions ?? []).length} additions considered`)
  }

  return filtered
}
