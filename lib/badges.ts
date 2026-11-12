import { patternCss, type PatternLook } from '@/lib/pagePatterns'
import type { Card, Game } from './types'
import type { ReliefSettings } from './reliefStudio'

// Haven Badges — trophies for collecting milestones, shown in each profile's pin book
// (components/badges/BadgeBook.tsx). Badges are made only by TCG Haven, in the staff portal's
// Badges page (/admin/badges): the books and badges live in Firestore at badge_catalog/main
// (lib/badgeCatalog.ts reads it live). The DEFAULT_* below are what the app shows until that doc
// exists, and what the admin page starts from. A badge is earned by owning cards from the catalog;
// once earned it's kept for good (a trophy — selling the cards later doesn't take it back).
//
// Requirement shape: "collect one of each" — a list of slots (e.g. each Origins Legend), and a
// slot is filled by owning ANY of its catalog card ids (e.g. that Legend's Overnumbered OR its
// Signature printing). Ownership is matched on the inventory card's apiId (the catalog id).

export interface BadgeSlot {
  label: string        // what the slot is, e.g. "Lee Sin"
  cardIds: string[]    // catalog ids — owning any one fills the slot
  // Display info for the staff portal (name/set/number/photo of each card), saved when a card is
  // picked there. Not used for earning — cardIds is the source of truth.
  cards?: SlotCard[]
}

export interface SlotCard {
  id: string
  name: string
  setName?: string
  number?: string
  imageUrl?: string
}

// A Badge Set is one pin book on the Badges shelf (components/badges/BadgeLibrary.tsx) — one per
// game for now. Its cover colors are its look on the shelf; `monogram` is embossed on the cover.
export interface BadgeSet {
  id: string
  name: string          // big title on the cover, e.g. "Riftbound"
  subtitle: string      // small line above it
  monogram: string
  game: Game
  cover: { from: string; to: string; accent: string }
  // A picture of the book's cover (staff upload, background removed): shown on the shelf and as the
  // open book's cover instead of the plain leather in `cover`'s colours
  coverImage?: string
  // Where a creator placed their cover picture (Creator Studio, docs/creators.md): its centre's
  // offset from the cover's centre in % of the cover's width / height, and its width as a multiple
  // of the cover's (1 = as wide as the cover). It may hang past the edges — the leather shows
  // where it doesn't reach. Unset = the picture fills the cover (staff covers).
  coverFit?: { x: number; y: number; scale: number }
  // A creator's cover lettering and pages (Creator Studio cover designer): unset = the classic
  // cover (staff books). See BookCover in components/badges/BadgeLibrary.tsx.
  coverStyle?: CoverStyle
  // The inside of the book (Creator Studio's Inside look): the pages' felt colour, the gold trim's
  // colour (frames, chapter titles, rules), the frame and the felt texture on/off. Unset = TCG
  // Haven's classic inside. Drawn through insideLook() by BadgeBook and the Studio's BookPlanner.
  insideStyle?: InsideStyle
  // The book's chapters, in order (e.g. "Overnumbers", "Alternative Arts"). Each chapter starts on
  // a fresh page with its own tab on the book's edge, and grows extra pages as it fills (6 pins a
  // page) without moving the chapters after it. A badge's `page` is the chapter it's in.
  chapters?: string[]
  // Which collection the book is in — the Badges shelf's dropdown (BadgeLibrary.tsx) shows one
  // collection at a time. Unset = HAVEN_COLLECTION, TCG Haven's own books. Later, creators' books
  // (e.g. "PewDiePie Badges") get their own collection name. Read through bookCollection().
  collection?: string
}

export interface InsideStyle extends PatternLook {
  // + a pattern over the felt (lib/pagePatterns.ts: pattern, its colours, Strength, Fade edges, sliders)
  page?: string      // the felt's colour (its middle; darker toward the edges). Default #2a221c
  trim?: string      // the gold trim's colour. Default #d6b168
  frame?: boolean    // the double frame + corner ornaments (default on)
  texture?: boolean  // the felt's grain (default on)
}
export const INSIDE_DEFAULTS = { page: '#2a221c', trim: '#d6b168' }
/** The CSS a book with an inside style puts on its root: a class turning the styled rules on, and
 *  the colours as variables (globals.css `.pinbook-styled`). Unset = nothing (the classic inside). */
export function insideLook(s: InsideStyle | undefined): { className: string; style: Record<string, string> } {
  if (!s) return { className: '', style: {} }
  const pattern = patternCss(s)
  return {
    className: ['pinbook-styled', pattern && 'pinbook-patterned', s.frame === false && 'pinbook-no-frame', s.texture === false && 'pinbook-no-texture'].filter(Boolean).join(' '),
    style: {
      '--page': s.page || INSIDE_DEFAULTS.page, '--trim': s.trim || INSIDE_DEFAULTS.trim,
      ...(pattern && { '--pattern': pattern }),
    },
  }
}

export interface CoverStyle {
  font?: string          // lib/coverFonts.ts COVER_FONTS id
  titleY?: number        // where the title sits, % down the cover (default 38)
  titleSize?: number     // × the usual size (0.6–1.8)
  titleColor?: string    // used when the finish is flat
  titleFinish?: string   // lib/coverFonts.ts TITLE_FINISHES id (metal foil); unset = flat colour
  titleShine?: boolean   // removed 2026-11-12 (ignored) — was a light streak across the foil
  titlePlate?: boolean   // the soft dark glow behind the title, like TCG Haven's covers
  showSubtitle?: boolean // the line above the title (default on)
  subtitleColor?: string // default gold — the cover's colours never change the text or emblem
  showEmblem?: boolean   // removed 2026-11-12 (ignored) — the cover's emblem is gone
  emblemColor?: string   // the stamp's ring and letters (default gold)
  showCount?: boolean    // "3 / 10 earned" (default on)
  countColor?: string    // its text (default gold)
  pageColor?: string     // the page edges showing at the side
  spine?: string         // components/badges/CoverSpine.tsx SPINES id; unset = the default brown stitched spine, 'none' = no spine
  spineColor?: string    // its main colour (any; default walnut)
  spineAccent?: string   // its second colour — thread, gold, stripes… (any; default per look)
  spineDetail?: string   // a third colour on looks that have one (pinlines, rivets, eyelets, moon)
  spineWidth?: number    // % of the cover's width it takes (8–24, default 13) — the picture gets the rest
  spineRound?: number    // how rounded its shading looks (0–1, default 0.8)
  spineParams?: Record<string, Record<string, number>> // per look: its own sliders (SpineDef.sliders)
}

/** The collection every TCG Haven-made book is in */
export const HAVEN_COLLECTION = 'Haven Badges'
export const bookCollection = (set: Pick<BadgeSet, 'collection'>) => set.collection?.trim() || HAVEN_COLLECTION
/** Every collection that has a book, Haven Badges first, then in book order */
export function badgeCollections(sets: BadgeSet[]): string[] {
  const names = new Set([HAVEN_COLLECTION])
  for (const s of sets) names.add(bookCollection(s))
  return Array.from(names)
}

export const DEFAULT_BADGE_SETS: BadgeSet[] = [
  { id: 'riftbound', name: 'Riftbound', subtitle: 'Haven Badges', monogram: 'R', game: 'riftbound', cover: { from: '#8a3220', to: '#2b0e08', accent: '#e8b35a' } },
  { id: 'pokemon', name: 'Pokémon', subtitle: 'Haven Badges', monogram: 'P', game: 'pokemon', cover: { from: '#a8341f', to: '#3a0d07', accent: '#f2c84b' } },
  { id: 'lorcana', name: 'Lorcana', subtitle: 'Haven Badges', monogram: 'L', game: 'lorcana', cover: { from: '#4b2f5e', to: '#170c22', accent: '#d9b56a' } },
  { id: 'onepiece', name: 'One Piece', subtitle: 'Haven Badges', monogram: 'OP', game: 'onepiece', cover: { from: '#2f4d5c', to: '#0c1a21', accent: '#e8c46a' } },
  { id: 'mtg', name: 'Magic', subtitle: 'Haven Badges', monogram: 'M', game: 'mtg', cover: { from: '#3d3a33', to: '#121110', accent: '#d8a657' } },
]

export interface BadgeDef {
  id: string
  set: string          // which BadgeSet's book it lives in
  page: string         // its chapter (BadgeSet.chapters), titled at the top of the chapter's pages
  name: string
  description: string  // how to earn it, shown on hover
  game: Game
  slotNoun: string     // "Legends" → "7 / 12 Legends"
  // Growing badge: staff add slots as new sets come out (e.g. Overnumbered Legends Mastery). Earning
  // it is still for good; holding every card it asks for *now* makes it Mastered — the pin glows.
  // Fixed badges (unset) never change, so once earned they're simply done (no glow).
  growing?: boolean
  slots: BadgeSlot[]
  art: string          // built-in pin art to draw when there's no imageUrl (components/badges/BadgePin.tsx)
  imageUrl?: string    // uploaded pin art (PNG with transparency) — shown in the book, and the 3D face
  model?: string       // a 3D model (.glb/.gltf URL) for the inspect view; without one it shows a
                       // stand-in built from the 2D art
  normalMapUrl?: string // optional normal map for the stand-in's face
  pinBack?: PinBackId   // the standard back put on a 3D model (components/badges/pinBacks.ts)
  reliefDepth?: number  // squash a 3D model's front into a bas-relief at most this tall (pin = 1 wide); unset = as modelled
  modelFrontPositiveZ?: boolean // the model's real front faces +z (Meshy's face −z — the default)
  depthMapUrl?: string  // optional depth map of the art (white = near) — gives the relief its real shape
  // Made in the Relief Studio (components/admin/ReliefStudio.tsx): the HavenRelief kit's files
  // (name → URL, so the Studio can reopen and re-tune) and the settings depthMapUrl was baked with
  // (the viewer also reads its depth and wall)
  reliefKit?: Record<string, string>
  relief?: ReliefSettings
  // Tiers: how far through the badge a collector is (have / total, %) decides which look their pin
  // has — [Grayscale, Full], each the % that unlocks it. Unset = DEFAULT_TIERS. Badges saved while
  // there was a middle look (Painted, removed 2026-11-03) hold [Grayscale, Painted, Full]: read
  // through tierPercents(), which skips the middle.
  tiers?: [number, number] | [number, number, number]
  displayScale?: number // how big its pin is drawn wherever pins show flat (book pages, shelf, lists), 1 = as is (0.1–5) — evens out art framed bigger or smaller than the rest; unset = 1
  tiersOff?: (1 | 2 | 3)[] // [1] = Grayscale switched off (the pin stays a hole until Full). Anything else is from the old three looks and ignored — read through looksOn(); unset = both on
  finishMapUrl?: string // the Relief Studio's per-pixel finishes (R = FINISHES id in lib/reliefStudio.ts); unset = all Auto
  detailMapUrl?: string // its details over them (R = slot, lib/reliefStudio.ts detailMap; the slots come from relief.details); unset = none
  // The relief's shape worked out by the Studio on save (pinRelief.ts bakeReliefBuild), so the 3D
  // view needn't — used only while reliefBuildKey still matches the art, finish map and hole settings
  reliefBuildUrl?: string
  reliefBuildKey?: string
}

// The standard pin backs every 3D pin gets (built in components/badges/pinBacks.ts)
export type PinBackId = 'classic' | 'double' | 'magnet'
export const PIN_BACKS: { id: PinBackId; label: string }[] = [
  { id: 'classic', label: 'Post & clutch' },
  { id: 'double', label: 'Two posts' },
  { id: 'magnet', label: 'Magnet' },
]

// The whole badge catalog — every book (set) and badge, in display order.
export interface BadgeCatalog {
  sets: BadgeSet[]
  badges: BadgeDef[]
}

// Origins Legends: [champion, Overnumbered catalog number]. The Signature printing of each is the
// same number with "-star" (ogn-304-star-298).
const ORIGINS_LEGENDS: [string, number][] = [
  ["Kai'Sa", 299], ['Volibear', 300], ['Jinx', 301], ['Darius', 302], ['Ahri', 303], ['Lee Sin', 304],
  ['Yasuo', 305], ['Leona', 306], ['Teemo', 307], ['Viktor', 308], ['Miss Fortune', 309], ['Sett', 310],
]

export const DEFAULT_BADGES: BadgeDef[] = [
  {
    id: 'origins-overnumbered',
    set: 'riftbound',
    page: 'Origins',
    name: 'Origins Overnumbered',
    description: 'Collect the Overnumbered or Signature Overnumbered printing of every Legend in Riftbound: Origins.',
    game: 'riftbound',
    slotNoun: 'Legends',
    slots: ORIGINS_LEGENDS.map(([label, n]) => ({ label, cardIds: [`ogn-${n}-298`, `ogn-${n}-star-298`] })),
    art: 'origins-overnumbered',
  },
]

/** A growing badge whose every current slot the collector fills right now (`have` from their
 *  progress, checked against the badge's slots today — a badge that grew since is not mastered). */
// The two looks a pin can have, unlocked by progress (each badge's tiers, set in the staff
// portal): 1 Grayscale — no colour, a little shine (polished grey), no finishes; 3 Full — the pin
// as designed. 0 = not unlocked yet (a hole in the book). (There's no 2: it was a middle Painted
// look, removed 2026-11-03 — the numbers are kept so badges saved before still read right.)
// Follows current progress: selling cards below a tier drops the pin back down. A badge can switch
// Grayscale off (tiersOff): the pin then stays a hole until Full.
export type BadgeTier = 0 | 1 | 3
export type BadgeLook = Exclude<BadgeTier, 0>
export const DEFAULT_TIERS: [number, number] = [75, 90]
/** A badge's [Grayscale, Full] percentages (an old three-look setting: its middle skipped). */
export function tierPercents(def: Pick<BadgeDef, 'tiers'>): [number, number] {
  const t = def.tiers
  if (!t) return DEFAULT_TIERS
  return t.length === 3 ? [t[0], t[2]] : [t[0], t[1]]
}
/** The looks switched on for a badge, lowest first. Only Grayscale can be off: Full is always on
 *  (an old setting switching Full or the middle look off is ignored). */
export function looksOn(def: Pick<BadgeDef, 'tiersOff'>): BadgeLook[] {
  return def.tiersOff?.includes(1) ? [3] : [1, 3]
}
/** The size to draw a badge's pin at, for a slot made for `size` (its Display size applied). */
export const pinSize = (def: Pick<BadgeDef, 'displayScale'>, size: number) => size * (def.displayScale ?? 1)
export const TIER_NAMES: Record<BadgeTier, string> = { 0: 'Locked', 1: 'Grayscale', 3: 'Full' }
export function badgeTier(def: BadgeDef, progress: [number, number] | undefined): BadgeTier {
  const [have, total] = progress ?? [0, def.slots.length]
  if (!total) return 0
  for (const k of [...looksOn(def)].reverse()) if (have >= tierNeed(def, k, total)) return k
  return 0
}
/** How many of `total` slots unlock look `k` (0 for none). The one rule every count, bar and fill
 *  uses: worked in whole cards, so a percentage that doesn't divide evenly (29% of 100 is
 *  28.999… in floating point) can't unlock a look at a different count than the one shown. */
export function tierNeed(def: Pick<BadgeDef, 'tiers'>, k: BadgeTier, total: number): number {
  return k ? Math.ceil((tierPercents(def)[k === 1 ? 0 : 1] * total) / 100 - 1e-9) : 0
}
/** The next look up that's switched on, or 0 at the top. */
export function nextTier(def: BadgeDef, progress: [number, number] | undefined): BadgeTier {
  const tier = badgeTier(def, progress)
  return looksOn(def).find((k) => k > tier) ?? 0
}
/** How many more of the badge's slots unlock the next look (0 at the top). */
export function toNextTier(def: BadgeDef, progress: [number, number] | undefined): number {
  const [have, total] = progress ?? [0, def.slots.length]
  const next = nextTier(def, progress)
  if (!next || !total) return 0
  return Math.max(0, tierNeed(def, next, total) - have)
}

/** How far the collector is from the current look to the next one switched on (0–1) — the ghost
 *  fill on a pin. Tiered, not the whole badge: with Grayscale at 50% of 10 cards, 3 cards shows
 *  60%; once Grayscale is reached it starts again at 0 toward Full. 0 at the top. */
export function tierFill(def: BadgeDef, progress: [number, number] | undefined): number {
  const [have, total] = progress ?? [0, def.slots.length]
  const tier = badgeTier(def, progress)
  const next = nextTier(def, progress)
  if (!next || !total) return 0
  const from = tierNeed(def, tier, total)
  const to = tierNeed(def, next, total)
  return to > from ? Math.max(0, Math.min(1, (have - from) / (to - from))) : 0
}

export function isMastered(def: BadgeDef, progress: [number, number] | undefined, earned: boolean): boolean {
  return !!def.growing && earned && def.slots.length > 0 && (progress?.[0] ?? 0) >= def.slots.length && (progress?.[1] ?? 0) === def.slots.length
}

export interface BadgeProgress {
  have: number
  total: number
  done: boolean
  filled: boolean[]   // per slot
}

export function badgeProgress(def: BadgeDef, ownedIds: Set<string>): BadgeProgress {
  const filled = def.slots.map((s) => s.cardIds.some((id) => ownedIds.has(id)))
  const have = filled.filter(Boolean).length
  // A badge with no slots yet (still being set up in the admin) can't be earned.
  return { have, total: def.slots.length, done: def.slots.length > 0 && have === def.slots.length, filled }
}

/** Catalog ids of every card this person owns (quantity > 0). */
export function ownedCatalogIds(cards: Pick<Card, 'apiId' | 'quantity'>[]): Set<string> {
  const ids = new Set<string>()
  for (const c of cards) if (c.apiId && (c.quantity ?? 1) > 0) ids.add(c.apiId)
  return ids
}

export const DEFAULT_BADGE_CATALOG: BadgeCatalog = { sets: DEFAULT_BADGE_SETS, badges: DEFAULT_BADGES }

export function badgesInSet(catalog: BadgeCatalog, setId: string): BadgeDef[] {
  return catalog.badges.filter((b) => b.set === setId)
}

/** A book's chapters in order: its own list, then any chapter a badge names that isn't listed. */
export function chaptersOf(catalog: BadgeCatalog, setId: string): string[] {
  const set = catalog.sets.find((s) => s.id === setId)
  const out = [...(set?.chapters ?? [])]
  for (const b of badgesInSet(catalog, setId)) if (!out.includes(b.page)) out.push(b.page)
  return out
}

/** A URL-safe id from a name ("Origins Overnumbered" → "origins-overnumbered"). */
export function badgeSlug(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'badge'
}
