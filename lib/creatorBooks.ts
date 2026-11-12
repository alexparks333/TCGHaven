// Creator Books — the one pin book each Creator makes for their community (docs/creators.md).
// A creator book is a real Haven Badges book (the same BadgeSet + BadgeDef shapes, drawn by the same
// BookCover / BadgeBook), but it lives in its own doc, written by its creator — not in the staff's
// badge_catalog/main.
//
//   creator_books/{uid}  { owner, book: BadgeSet, badges: BadgeDef[], createdAt, updatedAt }
//   communities/{uid}    { name, tagline, about, color, updatedAt } — the community profile (barebones)
//
// One doc per creator = one book per creator (the plan: one to begin with). Any signed-in collector
// can read them; only the creator (a Creator in good standing, or staff) writes their own
// (firestore.rules). Show a creator's work only while its maker is still a Creator (isCreator) —
// suspended / former creators' books are hidden and come back unchanged.
// Uploaded art and covers: Storage creators/{uid}/… (storage.rules).

import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase/config'
import type { BadgeDef, BadgeSet } from './badges'
import type { Game } from './types'

export interface CreatorBook {
  owner: string
  book: BadgeSet
  badges: BadgeDef[]
}

export interface Community {
  name: string        // the community's name, e.g. "PewDiePie's Bros"
  tagline: string
  about: string
  color: string       // its banner colour
  games?: Game[]       // the games it collects (set up when the community is created)
  page?: CommunityLook // how its page looks (the Studio's Community tab) — unset = the plain page
}

/** A community page's sections a creator switches on and off (CommunityPage) */
export type CommunitySection = 'about' | 'members' | 'badgeBoard' | 'discussion'
export const COMMUNITY_SECTIONS: Array<{ id: CommunitySection; name: string; hint: string; ready: boolean }> = [
  { id: 'about', name: 'About', hint: 'Who you are and what members get', ready: true },
  { id: 'members', name: 'Newest members', hint: 'The latest collectors to join', ready: true },
  { id: 'badgeBoard', name: 'Achievement Badge Board', hint: 'The newest members to earn one of your badges', ready: false },
  { id: 'discussion', name: 'Community Discussion Board', hint: 'Posts members upvote, like a forum', ready: false },
]
/** Whether a section shows: what the creator chose, else on for the ready ones */
export const sectionOn = (c: Pick<Community, 'page'>, id: CommunitySection) =>
  (COMMUNITY_SECTIONS.find((s) => s.id === id)?.ready ?? false) && (c.page?.sections?.[id] ?? true)

export interface CommunityLook {
  header?: string                                         // the header picture (Storage URL)
  headerFit?: { x: number; y: number; scale: number; ar?: number } // where it's placed (PicturePlacer); unset = fills it
  headerShade?: number                                    // 0–1: darkens it toward the bottom so the text reads (default 0.35)
  sections?: Partial<Record<CommunitySection, boolean>>   // sections switched on / off
}
/** The header's shape — fixed, so a placed picture looks the same on every screen */
export const HEADER_ASPECT = 4

/** Leather and foil a creator picks for their cover (CoverDesigner) */
export const LEATHERS: Array<{ name: string; from: string; to: string }> = [
  { name: 'Crimson', from: '#a8341f', to: '#3a0d07' },
  { name: 'Oxblood', from: '#7a1f2b', to: '#2a070c' },
  { name: 'Royal', from: '#4b2f8e', to: '#160c33' },
  { name: 'Midnight', from: '#24365e', to: '#0a1022' },
  { name: 'Ocean', from: '#1f6a7a', to: '#08232a' },
  { name: 'Forest', from: '#2f5c3a', to: '#0b1f10' },
  { name: 'Saddle', from: '#8a5a2b', to: '#2e1a08' },
  { name: 'Rose', from: '#b0476e', to: '#3d0f22' },
  { name: 'Sunset', from: '#c4622a', to: '#4a1606' },
  { name: 'Onyx', from: '#3d3a33', to: '#121110' },
  { name: 'Ivory', from: '#cdbb94', to: '#6e5c3b' },
  { name: 'Mint', from: '#3f9a85', to: '#0f3b31' },
]
export const FOILS: Array<{ name: string; color: string }> = [
  { name: 'Gold', color: '#e8b35a' },
  { name: 'Pale gold', color: '#f2d38a' },
  { name: 'Silver', color: '#d9dde3' },
  { name: 'Rose gold', color: '#e8a48e' },
  { name: 'Copper', color: '#d07a45' },
  { name: 'Emerald', color: '#6fd3a2' },
  { name: 'Sapphire', color: '#8fb6ff' },
  { name: 'Amethyst', color: '#c79bff' },
]

export function creatorBookId(uid: string) {
  return `creator-${uid}`
}

/** "PewDiePie Cuties" → "PC" */
export function monogramOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [name.trim().slice(0, 2)]).join('').toUpperCase() || '★'
}

export function newCreatorBook(uid: string, name: string, creatorName: string): CreatorBook {
  const leather = LEATHERS[Math.floor(Math.random() * 6)]
  return {
    owner: uid,
    book: {
      id: creatorBookId(uid),
      name: name.trim(),
      subtitle: `${creatorName} · Creator Book`,
      monogram: monogramOf(name),
      game: 'pokemon',
      cover: { from: leather.from, to: leather.to, accent: FOILS[0].color },
      chapters: ['Chapter One'],
      collection: name.trim(),
      coverStyle: {},
    },
    badges: [],
  }
}

/** A new badge's id: unique across every book (earned badges are keyed by id) */
export function newBadgeId(uid: string, name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'badge'
  return `c-${uid.slice(0, 8)}-${slug}-${Math.random().toString(36).slice(2, 6)}`
}

// Firestore rejects undefined anywhere in a document (CLAUDE.md rule 2)
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export function useCreatorBook(uid: string | null | undefined): { book: CreatorBook | null; loaded: boolean } {
  const [state, setState] = useState<{ uid: string | null; book: CreatorBook | null }>({ uid: null, book: null })
  useEffect(() => {
    if (!uid) return
    return onSnapshot(
      doc(db, 'creator_books', uid),
      (snap) => setState({ uid, book: snap.exists() ? ({ badges: [], ...snap.data() } as unknown as CreatorBook) : null }),
      () => setState({ uid, book: null }),
    )
  }, [uid])
  return uid && state.uid === uid ? { book: state.book, loaded: true } : { book: null, loaded: !uid }
}

export async function saveCreatorBook(uid: string, book: CreatorBook, created = false) {
  await setDoc(doc(db, 'creator_books', uid), {
    ...clean({ owner: uid, book: book.book, badges: book.badges }),
    ...(created && { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
    // mergeFields, not merge: these fields are replaced whole, so a setting switched off (no spine,
    // Haven Style off — stored as a missing key) really goes; any other field on the doc is kept
  }, { mergeFields: ['owner', 'book', 'badges', 'updatedAt', ...(created ? ['createdAt'] : [])] })
}

export function useCommunity(uid: string | null | undefined): { community: Community | null; loaded: boolean } {
  const [state, setState] = useState<{ uid: string | null; community: Community | null }>({ uid: null, community: null })
  useEffect(() => {
    if (!uid) return
    return onSnapshot(
      doc(db, 'communities', uid),
      (snap) => setState({ uid, community: snap.exists() ? (snap.data() as Community) : null }),
      () => setState({ uid, community: null }),
    )
  }, [uid])
  return uid && state.uid === uid ? { community: state.community, loaded: true } : { community: null, loaded: !uid }
}

export async function saveCommunity(uid: string, c: Community) {
  // nameLower: for searching by name (lib/communities.ts searchCommunities)
  // mergeFields: these fields are replaced whole, so something removed from the page's look (a header
  // picture, a section) really goes; anything else on the doc is kept
  await setDoc(doc(db, 'communities', uid), { ...clean(c), nameLower: c.name.trim().toLowerCase(), updatedAt: serverTimestamp() },
    { mergeFields: ['name', 'nameLower', 'tagline', 'about', 'color', 'games', 'updatedAt', ...(c.page ? ['page'] : [])] })
}
