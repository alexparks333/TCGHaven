import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Card, Game } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Per-game, per-rarity override for the Cardex zoom overlay's glow/border/card-back color —
// distinct from RARITY_COLORS (the rarity pill color used elsewhere), a separate, simpler palette
// by design. Only Riftbound is populated for now (the user's own testing ground); falls back to
// the card's game color for every other game/rarity until more are specified. Lives here (not in
// CardexPage.tsx, where the zoom overlay itself is defined) so PersonalCollectionsView.tsx — a
// sibling tab inside the same Cardex page, not a descendant of CardexPage's module — can share it
// without a circular import between the two.
const ZOOM_GLOW_COLORS: Partial<Record<Game, Record<string, string>>> = {
  riftbound: {
    Common: '#8a7a65',       // light gray
    Uncommon: '#5e5040',     // darker gray
    Rare: '#5e3a4a',         // dark purple
    Epic: '#a8861e',         // gold/yellow
    Overnumbered: '#a8861e', // gold/yellow
    Star: '#a8861e',         // gold/yellow (Overnumbered Signature)
  },
}

/**
 * The full-size version of a card image saved as a thumbnail. Older inventory cards stored
 * pokemontcg.io's small image ("…/swsh4/12.png", 245px wide) and lorcast's "digital/small" one,
 * which looked blurry at card size; both hosts serve a large copy at a predictable address
 * ("…/12_hires.png" ~734px, "digital/large" ~674px). Anything else is returned unchanged.
 */
export function sharpImageUrl(url: string | undefined): string | undefined {
  if (!url) return url
  if (url.includes('images.pokemontcg.io/')) return url.replace(/\/([^/_]+)\.png$/, '/$1_hires.png')
  if (url.includes('lorcast.io/') && url.includes('/digital/small/')) return url.replace('/digital/small/', '/digital/large/')
  return url
}

export function zoomGlowColor(game: Game, rarity: string, fallback: string): string {
  return ZOOM_GLOW_COLORS[game]?.[rarity] ?? fallback
}

// Unique identity key — same card from different purchase sessions (different Firestore
// documents/"lots") shares this key, so InventoryPage and PortfolioPage can both group separate
// additions of the same card into one displayed row without merging the underlying documents
// (each lot keeps its own purchase date/price/condition). A Nexus-flagged card shares its
// name/number/apiId with the regular printing it's a promo variant of, so it gets its own key
// segment here — otherwise it'd silently merge into the same group as regular copies.
export function cardIdentityKey(card: Card): string {
  const nexusPart = card.nexus ? '::nexus' : ''
  // A raw copy and a graded copy of the same print are economically distinct (a PSA 10 isn't
  // interchangeable with a raw copy for cost-basis/market-value purposes) and must never merge
  // into the same Inventory row — without this, grading info silently got dropped and both
  // landed in one group with a shared "Total Paid"/"Market" sum and only one grade badge shown.
  const gradePart = card.gradingCompany ? `::${card.gradingCompany}::${card.grade ?? ''}` : ''
  // Same for a Pokémon card's printing: a 1st Edition and an Unlimited copy (or a Holo and a
  // Reverse Holo) are priced differently and never share a row. Cards from before editions
  // existed have neither field and keep their old key.
  const printingPart = card.edition || card.finish ? `::${card.edition ?? ''}::${card.finish ?? ''}` : ''
  const langPart = card.language === 'ja' ? '::ja' : ''
  if (card.apiId) return `${card.game}${langPart}::${card.apiId}::${card.isFoil ? 'foil' : 'normal'}${printingPart}${gradePart}${nexusPart}`
  return `${card.game}${langPart}::${card.name}::${card.set}::${card.number}::${card.isFoil ? 'foil' : 'normal'}${printingPart}${gradePart}${nexusPart}`
}

// Whether `newCard` is the first copy of this exact print the user has ever added — same
// identity rules the Cardex uses to decide whether a set slot is "owned" (apiId when present,
// otherwise a per-game set/number fallback; see CLAUDE.md's Cardex matching section and quirk
// #5 for why Riftbound needs setCode+number rather than a bare number). Used to fire the
// "Card Unlocked" celebration in AddCardDialog — deliberately checked against inventory alone,
// not the catalog, so it also fires for a manually-typed card in an unregistered/Special set.
export function isFirstCopyOfCard(newCard: Card, existingCards: Card[]): boolean {
  // Edition/finish deliberately play no part: owning an Unlimited, Shadowless or 1st Edition copy
  // all unlock the same card. Language does — a Japanese card is its own card.
  return !existingCards.some((c) => {
    if (c.game !== newCard.game) return false
    if ((c.language === 'ja') !== (newCard.language === 'ja')) return false
    if (newCard.apiId) return c.apiId === newCard.apiId
    if (newCard.game === 'riftbound') return c.setCode === newCard.setCode && c.number === newCard.number
    return c.set === newCard.set && c.number === newCard.number
  })
}

// Constructing Intl.NumberFormat is expensive — build it once, reuse everywhere
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatCurrency(value: number): string {
  return USD.format(value)
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

// Returns today (or any Date) as a LOCAL-calendar "YYYY-MM-DD" string. Never use
// `new Date().toISOString().slice(0, 10)` for this — that reads the UTC day, which is a
// different calendar date than "today" for anyone not in UTC once the UTC day has rolled
// over but the local one hasn't (e.g. evenings in US timezones show tomorrow's date).
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatDate(iso: string): string {
  // Bare "YYYY-MM-DD" strings (what purchaseDate always is) get parsed by `new Date(iso)` as
  // UTC midnight per spec — formatting that back in a local timezone west of UTC then displays
  // the PREVIOUS day. Build the Date from local y/m/d parts instead so the displayed date always
  // matches what was actually picked, regardless of the viewer's timezone.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Riftbound's catalog `number` field is always the bare digit ("92") — any alt-art letter
// suffix ("092a/166", printed on the physical card) only survives in `publicCode`. Recover it
// so a card is shown/stored as "92a", not a bare "92" indistinguishable from the base card.
// Signature's "*" suffix is intentionally dropped — the "(Signature)" name suffix already
// disambiguates it, and "*" isn't how collectors write the number.
export function riftboundDisplayNumber(number: string, publicCode?: string): string {
  // "SP" subset cards (e.g. Vendetta's foil-only Special printings) have their real collector
  // code only in publicCode too ("VEN-SP6/006") — the bare `number` field is just "6", which
  // collides with an unrelated plain-numbered card sharing that digit. Must be checked before
  // the digit-suffix regex below, since "SP6" doesn't start with a digit and would otherwise
  // silently fall through to the bare, ambiguous number.
  const spMatch = (publicCode ?? '').match(/-(SP\d+)\//i)
  if (spMatch) return spMatch[1].toUpperCase()
  const m = (publicCode ?? '').match(/-(\d+)([a-zA-Z]?)\*?\//)
  if (!m) return number
  return `${parseInt(m[1], 10)}${m[2]}`
}

/**
 * Classifies a Riftbound card's variant type from its catalog `rarity` + `publicCode`.
 * A same-number alt-art print (foil-only) is stored as `rarity: 'Alt Art'`; a chase variant
 * whose collector number exceeds the set's total card count (e.g. "189/166", prints as a
 * regular card, not foil-only) is stored as `rarity: 'Overnumbered'`. Both flags are re-derived
 * from `publicCode` (the "a" suffix / the number exceeding the set-size denominator) rather
 * than trusting the rarity string alone — some sets (UNL, VEN) keep the base card's real rarity
 * (Rare, Epic, etc.) on their alt-art prints instead of ever reporting a distinct one, so
 * publicCode is the only reliable signal; this is the same rule
 * scripts/lib/catalog-sync.mjs uses to assign `rarity` in the first place, and it also keeps
 * this correct for an older doc that still has the pre-rename literal `'Showcase'` value.
 * Shared by lib/api/search.ts (new-card display) and the Settings repair tool (fixing
 * already-owned cards), so both agree on what "correct" looks like.
 */
export function riftboundVariantFlags(rarity: string | undefined, publicCode?: string) {
  const isStar = rarity === 'Star'
  const isSameNumAltCode = !isStar && (publicCode ?? '').includes('a/')
  const pubNums = (publicCode ?? '').match(/-(\d+)[a-zA-Z]?\*?\/(\d+)/)
  const isOvernumber = !isStar && !isSameNumAltCode
    && (rarity === 'Overnumbered' || (!!pubNums && parseInt(pubNums[1], 10) > parseInt(pubNums[2], 10)))
  const isAltArtShowcase = !isStar && !isOvernumber && (isSameNumAltCode || rarity === 'Alt Art' || rarity === 'Showcase')
  return { isStar, isOvernumber, isAltArtShowcase }
}

/**
 * Whether a Riftbound card variant is inherently foil-only (Star signatures, same-number
 * alt-art Showcase) or inherently NOT foil (Overnumbered — only ever has one, non-foil-labeled
 * price point). Returns null for regular cards, where foil-or-not is a genuine purchasing
 * choice this can't second-guess — callers should leave `isFoil` alone in that case.
 */
export function riftboundInherentFoil(rarity: string | undefined, publicCode?: string): boolean | null {
  const { isStar, isOvernumber, isAltArtShowcase } = riftboundVariantFlags(rarity, publicCode)
  if (isStar || isAltArtShowcase) return true
  if (isOvernumber) return false
  return null
}

/**
 * Friendlier display text for a raw Riftbound rarity string than showing it verbatim — 'Star' is
 * what the catalog calls a Signature variant, and 'Showcase'/'Promo' are Rune-card print-variant
 * labels that come straight from TCGPlayer's own product listing ('Showcase' has nothing to do
 * with the champion-card "Showcase" rarity that was renamed away, see CLAUDE.md quirk #18 —
 * spelling that out in the label so it doesn't look like that old value crept back in; 'Promo'
 * is just "Promo", as collectors call it). Shared by
 * CardexPage's rarity toggle/tooltip and InventoryPage's rarity filter popover so both describe
 * the same raw values the same way. Keys not unique to Riftbound (Lorcana has its own real
 * 'Promo' rarity, for instance) — callers must only apply this for Riftbound cards.
 */
export const RIFTBOUND_RARITY_LABELS: Record<string, string> = {
  Star: 'Overnumbered Signature',
  Showcase: 'Rune (Showcase)',
  Promo: 'Promo',
}

// Pokemon's rarity strings are already human-readable as stored ("Special Illustration Rare",
// "Rare Holo GX", ...) except this one — the pokemontcg.io API returns it SCREAMING_SNAKE_CASE
// (introduced with Ascended Heroes, 2026) unlike every other value it has ever returned.
export const POKEMON_RARITY_LABELS: Record<string, string> = {
  MEGA_ATTACK_RARE: 'Mega Attack Rare',
}

// One Piece's rarity field is always a bare abbreviation (see CLAUDE.md's catalog schema) —
// every value needs spelling out, unlike Pokemon/Riftbound where only a handful of oddities do.
// P and PR are both promo-card codes from two different scrape paths (apitcg's own vs. a
// tcgcsv-synthesized promo group — see catalog-sync.mjs's downloadOnePiece()), not a meaningfully
// different collector tier, so they're labeled distinctly only so the two toggles are
// distinguishable, not because "PR" means something more specific than "promo."
export const ONEPIECE_RARITY_LABELS: Record<string, string> = {
  L: 'Leader', C: 'Common', UC: 'Uncommon', R: 'Rare', SR: 'Super Rare',
  TR: 'Treasure Rare', SEC: 'Secret Rare', 'SP CARD': 'Special Rare',
  P: 'Promo', PR: 'Promo (PR)',
}

// Scryfall's `rarity` field is always lowercase ("common", "mythic", ...) — perfectly readable
// as-is, but every other game's rarity strings are Title Case, so a lowercase toggle pill would
// be the odd one out. Purely cosmetic capitalization, not a meaning change like the other maps.
export const MTG_RARITY_LABELS: Record<string, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic', special: 'Special', bonus: 'Bonus',
}

// Per-game rarity label overrides for the Cardex rarity toggle/tooltip and Inventory's rarity
// filter popover — keyed separately per game (not one flat merged map) because the same raw
// string can mean something different in two games' catalogs: Riftbound's Rune cards and
// Pokemon's real chase tier both happen to use the literal string "Promo", and relabeling one
// with the other's meaning would be actively wrong, not just cosmetically off.
export const RARITY_LABELS_BY_GAME: Partial<Record<Card['game'], Record<string, string>>> = {
  riftbound: RIFTBOUND_RARITY_LABELS,
  pokemon: POKEMON_RARITY_LABELS,
  onepiece: ONEPIECE_RARITY_LABELS,
  mtg: MTG_RARITY_LABELS,
}

// Build an eBay sold-listings search URL for a card.
// Format: "{name} {number} {gradingCompany} {grade} {tags}" (graded)
//      or "{name} {number} {setName} {finish} {tags}"    (raw)
// Tags go last: a Pokémon printing ("1st Edition", "Shadowless") and "Japanese". An Unlimited
// vintage copy excludes the pricier printings instead (-1st -shadowless), so their sales don't
// crowd out what an Unlimited copy actually sells for.
export function openEbaySearch(card: {
  name: string; number: string; set: string; game: string; gradingCompany?: string; grade?: string; isFoil?: boolean
  edition?: string; finish?: string; language?: string
}) {
  window.open(ebaySearchUrl(card), '_blank', 'noopener,noreferrer')
}

export function ebaySearchUrl(card: Parameters<typeof openEbaySearch>[0]): string {
  // a saved "✦ Holo" name suffix would just duplicate the finish word added below
  const parts: string[] = [card.name.replace(/\s+✦ (Holo|Foil)$/, '')]
  if (card.number && card.number !== 'N/A') parts.push(card.number)
  if (card.gradingCompany) {
    parts.push(card.gradingCompany)
    if (card.grade) parts.push(card.grade)
  } else {
    if (card.set && card.set !== 'N/A') parts.push(card.set)
    if (card.finish === 'reverse') parts.push('Reverse Holo')
    else if (card.finish === 'holofoil' || (!card.finish && card.isFoil)) parts.push('Holo')
  }
  if (card.edition === '1st') parts.push('1st Edition')
  else if (card.edition === 'shadowless') parts.push('Shadowless', '-1st')
  else if (card.edition === 'unlimited') parts.push('-1st', '-shadowless')
  if (card.language === 'ja') parts.push('Japanese')
  const query = parts.join(' ')
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`
}
