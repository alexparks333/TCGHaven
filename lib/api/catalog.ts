import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Shared static-catalog helpers for the three game modules.
 * Server-side only (uses fs) — never import from a client component.
 */

// One in-memory copy per catalog file, shared by every consumer
// (search modules and API routes). Lives for the server process lifetime;
// refreshed by `npm run build && npm run start` after `npm run download-cards`.
const _cache = new Map<string, unknown[]>()

export function loadCatalog<T>(filename: string): T[] {
  const hit = _cache.get(filename)
  if (hit) return hit as T[]
  try {
    const file = join(process.cwd(), 'public', 'data', filename)
    const data = JSON.parse(readFileSync(file, 'utf8')) as T[]
    _cache.set(filename, data)
    return data
  } catch {
    // Catalog missing (download-cards not run yet) — don't cache the failure
    return []
  }
}

/**
 * Clears the in-memory catalog cache — must be called after anything writes
 * directly to public/data/*.json outside of the normal build+restart cycle
 * (e.g. the Admin Catalog "add"/"hide" routes), otherwise the running server
 * keeps serving the stale in-memory copy for the rest of its process lifetime.
 * Pass a filename to clear just that one entry, or omit to clear everything.
 */
export function invalidateCatalogCache(filename?: string) {
  if (filename) _cache.delete(filename)
  else _cache.clear()
}

// Rarity sort weight shared by Cardex display and the Admin Catalog listing —
// keep both in sync with a single comparator rather than duplicating it.
export const CARDEX_RARITY_ORDER: Record<string, number> = {
  Common: 0, Uncommon: 1, Rare: 2, Super_rare: 3, Legendary: 4, Enchanted: 5, Epic: 6, Promo: 7,
  Showcase: 90, Star: 91,
}

/** Sorts catalog cards by collector number, then rarity, matching Cardex's display order. */
export function sortCatalogCards<T extends { number: string; rarity?: string }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const aNum = parseInt(a.number, 10)
    const bNum = parseInt(b.number, 10)
    const aIsR = isNaN(aNum)
    const bIsR = isNaN(bNum)
    if (!aIsR && !bIsR) {
      const numDiff = aNum - bNum
      if (numDiff !== 0) return numDiff
      return (CARDEX_RARITY_ORDER[a.rarity ?? ''] ?? 50) - (CARDEX_RARITY_ORDER[b.rarity ?? ''] ?? 50)
    }
    if (aIsR && bIsR) return a.number.localeCompare(b.number)
    return aIsR ? 1 : -1 // R-format (Rune) cards sort after numeric cards
  })
}

/**
 * Splits a raw search string into a name portion and an optional collector-number
 * filter. Any token that is purely digits (e.g. "138", "088") is treated as a
 * number filter; everything else is the name query.
 *
 * "Rayquaza 138"  → { nameQuery: "Rayquaza", numberFilter: "138" }
 * "Mickey Mouse"  → { nameQuery: "Mickey Mouse", numberFilter: null }
 */
export function parseSearchQuery(raw: string): { nameQuery: string; numberFilter: string | null } {
  const words = raw.trim().split(/\s+/)
  const nums: string[] = []
  const names: string[] = []
  for (const w of words) {
    if (/^\d+$/.test(w)) nums.push(w)
    else names.push(w)
  }
  return {
    nameQuery: names.join(' '),
    numberFilter: nums.length > 0 ? nums[0] : null,
  }
}

/** Normalise a collector number for comparison — strips leading zeros so "088" === "88". */
export function normNum(n: string) { return String(parseInt(n, 10)) }

/**
 * Relevance score for a card name against a search query (higher = better),
 * or -1 if any query word doesn't match the START of a name token (or tag).
 * No mid-word substring matching — "cr" will NOT match "incredible",
 * only names with a token starting with "cr" (e.g. "cratchit").
 *
 * Scoring: exact token match = 30, token prefix = 15, tag match = 20,
 * first-word-starts-name bonus = 10.
 */
export function scoreMatch(name: string, query: string, tags?: string[]): number {
  const tokens = name.toLowerCase().split(/[\s\-·,']+/).filter(Boolean)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  let score = 0
  for (const w of words) {
    if (tokens.some((t) => t === w)) score += 30
    else if (tokens.some((t) => t.startsWith(w))) score += 15
    else if (tags?.some((tag) => {
      const t = tag.toLowerCase()
      return t === w || t.startsWith(w)
    })) score += 20 // tag hit (e.g. "ahri" finds LeBlanc's "Deceiver" tagged ["Ahri"])
    else return -1
  }
  const first = words[0]
  if (tokens[0] === first || tokens[0]?.startsWith(first)) score += 10
  return score
}
