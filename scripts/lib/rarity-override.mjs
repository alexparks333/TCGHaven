// Hand overrides that survive every sync: a card's rarity (below) and its set (further down).
// A card's rarity set by hand in Admin Catalog (2026-11-24, the Owner's call). A new set's cards are
// grouped by the rarity their sync reports — usually right, sometimes not. Staff can move a card to
// another rarity group, or rename / delete a set's groups (components/admin/RarityGroups.tsx); the
// card then carries:
//   rarity          what everything shows and groups by (the override, while there is one)
//   rarityOverride  the rarity staff chose — every sync keeps it (applyRarityOverride below)
//   rarityAuto      what the sync says the rarity is, kept up to date — "Back to automatic" restores it
// The syncs match cards on the fresh source data before writing, so an override never changes
// which product a card is matched to. docs/catalog.md "Rarity overrides". Tests: npm run test:rarity.

/** The card the sync writes, with everything staff set by hand kept: its rarity and its set */
export function applyHandOverrides(existing, card) {
  return applySetOverride(existing, applyRarityOverride(existing, card))
}

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

// ── The set, by hand (2026-11-24) ─────────────────────────────────────────────────────────────
// A card the source files under the wrong set (Riot's gallery lists Unleashed's Nexus Night "c" runes
// as Spiritforged, SFD-R01c…): staff move it — Admin Catalog's Edit card → Set — and it stays:
//   setOverride  { setName, and the set's code field: setCode (Riftbound) or set (other games) }
//   setAuto      the same fields as the sync reports them, kept up to date
// The card's id never changes, so anyone who logged it keeps it.

const SET_FIELDS = ['setName', 'setCode', 'set']
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]))

/** The card the sync writes, moved to the set staff chose (the sync's own set noted in setAuto) */
export function applySetOverride(existing, card) {
  const override = existing?.setOverride
  if (!override?.setName) return card
  const keys = Object.keys(override).filter((k) => SET_FIELDS.includes(k))
  const auto = pick(card, keys)
  return { ...card, ...pick(override, keys), setOverride: override, setAuto: Object.keys(auto).length ? auto : existing.setAuto ?? {} }
}

/**
 * The fields to write when staff move a card to another set: `to` = { setName, setCode? , set? }.
 * Moving it back to the sync's own set clears the override (null = delete the field).
 */
export function setPatch(card, to) {
  const keys = Object.keys(to).filter((k) => SET_FIELDS.includes(k))
  const auto = card.setOverride ? (card.setAuto ?? {}) : pick(card, keys)
  if (auto.setName === to.setName) return { ...pick(to, keys), setOverride: null, setAuto: null }
  return { ...pick(to, keys), setOverride: pick(to, keys), setAuto: auto }
}
