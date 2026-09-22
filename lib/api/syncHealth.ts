import { CARDEX_RARITY_ORDER } from './catalog'

/**
 * Distinct rarity values in a freshly-synced card list that CARDEX_RARITY_ORDER (lib/api/catalog.ts)
 * doesn't know about yet. The Cardex's per-game rarity toggle (see CLAUDE.md's "Per-Game Rarity
 * Toggle Filter") already derives its button list dynamically from whatever's actually in a set —
 * a new value shows up as a *working* toggle with no code change needed — but it'll have a flat
 * gray color and a raw, un-relabeled string until someone adds a `CARDEX_RARITY_ORDER`/
 * `RARITY_COLORS`/`RARITY_LABELS_BY_GAME` entry for it. This is purely a "go add the polish"
 * signal for the admin (surfaced via the Sync panel — see AdminCatalogPage.tsx), not something
 * the filter itself needs to function.
 */
export function findNewRarities(cards: { rarity?: string }[]): string[] {
  const present = new Set(cards.map((c) => c.rarity).filter((r): r is string => !!r))
  return Array.from(present).filter((r) => !(r in CARDEX_RARITY_ORDER))
}
