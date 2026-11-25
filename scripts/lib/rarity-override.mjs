// A card's rarity set by hand in Admin Catalog (2026-11-24, the Owner's call). A new set's cards are
// grouped by the rarity their sync reports — usually right, sometimes not. Staff can move a card to
// another rarity group, or rename / delete a set's groups (components/admin/RarityGroups.tsx); the
// card then carries:
//   rarity          what everything shows and groups by (the override, while there is one)
//   rarityOverride  the rarity staff chose — every sync keeps it (applyRarityOverride below)
//   rarityAuto      what the sync says the rarity is, kept up to date — "Back to automatic" restores it
// The syncs match cards on the fresh source data before writing, so an override never changes
// which product a card is matched to. docs/catalog.md "Rarity overrides". Tests: npm run test:rarity.

/** The card the sync writes, with a hand-set rarity kept (and the sync's own rarity noted) */
export function applyRarityOverride(existing, card) {
  const override = existing?.rarityOverride
  if (!override) return card
  return { ...card, rarity: override, rarityOverride: override, rarityAuto: card.rarity ?? existing.rarityAuto ?? '' }
}

/**
 * The fields to write when staff move a card to `next` (Admin Catalog). Picking the sync's own rarity
 * again clears the override. → { rarity, rarityOverride, rarityAuto } with null meaning "delete the field".
 */
export function rarityPatch(card, next) {
  const auto = card.rarityOverride ? (card.rarityAuto ?? '') : (card.rarity ?? '')
  if (next === auto) return { rarity: auto, rarityOverride: null, rarityAuto: null }
  return { rarity: next, rarityOverride: next, rarityAuto: auto }
}
