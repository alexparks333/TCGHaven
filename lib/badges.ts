import type { Card, Game } from './types'

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
  // The book's chapters, in order (e.g. "Overnumbers", "Alternative Arts"). Each chapter starts on
  // a fresh page with its own tab on the book's edge, and grows extra pages as it fills (6 pins a
  // page) without moving the chapters after it. A badge's `page` is the chapter it's in.
  chapters?: string[]
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
