// A community page is built from blocks (docs/creators.md "Community page blocks"): every tab — Home and
// the creator's own pages — is an ordered list of them, added with "+" in the Studio and edited in its
// side panel. They live in the community's doc (communities/{uid}.page — Home in `home`, a tab's in
// `tabs[i].blocks`), so the page and its blocks load and save together.

import type { BadgeSlot } from './badges'
import type { BlockStyle } from './blockStyle'
import type { Community, CommunityTab } from './creatorBooks'

export type BlockType = 'about' | 'badges' | 'wall' | 'announcements' | 'cards' | 'text' | 'picture' | 'board'

export interface WallPost { id: string; text: string; image?: string; at: number; note?: string /* NOTE_COLOURS id */; look?: NoteLook; place?: NotePlace }
/** Where the owner pinned a note on the board (components/community/WallBoard.tsx): its centre in board units
 *  (the board is BOARD_W units wide, scaled to fit the page), its turn in degrees, its size (1 = normal) and
 *  its stacking order. Unset = laid out on its own until the owner places it. */
export interface NotePlace { x: number; y: number; r: number; s: number; z: number }
/** How one Creator Wall note is laid out — set by the owner in the note editor (components/community/WallNote.tsx).
 *  Every part is optional: unset = a picture on top at full width with a white photo border, the page's
 *  body font at medium size, held the way the board says (Style → Board → Held by). */
export interface NoteLook {
  kind?: 'note' | 'polaroid'                // a paper note, or a polaroid (the picture over a written strip)
  square?: boolean                          // a polaroid's photo squared off (cropped to fill) instead of whole
  pic?: 'top' | 'bottom' | 'left' | 'right' // where the picture sits around the words
  picSize?: 's' | 'm' | 'l'                 // how much of the note it takes
  frame?: 'photo' | 'line' | 'none'         // a white photo border, a thin line, or nothing
  font?: 'print' | 'hand' | 'type' | 'serif'
  size?: 's' | 'm' | 'l'
  align?: 'left' | 'center'
  holder?: 'pin' | 'tape' | 'none'          // unset = the board's choice
  pinColor?: string
}
/** The papers a Creator Wall note can be — ink turns cream on the dark ones */
export const NOTE_COLOURS = [
  { id: 'paper', name: 'Paper', color: '#f6eedb' },
  { id: 'yellow', name: 'Yellow', color: '#f1e2a4' },
  { id: 'rose', name: 'Rose', color: '#efcfc6' },
  { id: 'sky', name: 'Sky', color: '#cfdde6' },
  { id: 'sage', name: 'Sage', color: '#d6e0c4' },
  { id: 'white', name: 'White', color: '#fbf8f1' },
  { id: 'kraft', name: 'Kraft', color: '#d2b48a' },
  { id: 'lilac', name: 'Lilac', color: '#ddd2e8' },
  { id: 'mint', name: 'Mint', color: '#cde6da' },
  { id: 'peach', name: 'Peach', color: '#f5d3b0' },
  { id: 'chalk', name: 'Chalkboard', color: '#2f3a33' },
  { id: 'ink', name: 'Ink', color: '#22202a' },
]
export interface Announcement { id: string; title: string; body: string; at: number; pinned?: boolean }

/** Every block also carries its look (lib/blockStyle.ts) — only what the creator changed */
export type Block = { style?: BlockStyle } & (
  | { id: string; type: 'about' }                                     // the community's About (Page details)
  | { id: string; type: 'badges'; title?: string }                    // Badge Achievements: newest earners
  | { id: string; type: 'wall'; title?: string; posts: WallPost[] }   // Creator Wall: the creator's posts, newest first
  | { id: string; type: 'announcements'; title?: string; items: Announcement[] }
  | { id: string; type: 'cards'; title?: string; note?: string; cards: BadgeSlot[] } // Highlighted Cards
  | { id: string; type: 'text'; title: string; body: string }
  | { id: string; type: 'picture'; image?: string; caption?: string }
  | { id: string; type: 'board'; title?: string }                     // Community Board (coming)
)

/** The blocks a creator can add, in the "+" menu's order */
export const BLOCK_TYPES: Array<{ type: BlockType; name: string; hint: string; ready: boolean }> = [
  { type: 'about', name: 'About', hint: 'Your community’s description', ready: true },
  { type: 'badges', name: 'Badge Achievements', hint: 'The newest members to earn your badges', ready: true },
  { type: 'wall', name: 'Creator Wall', hint: 'Your posts — text and pictures, newest first', ready: true },
  { type: 'announcements', name: 'Announcements', hint: 'News for members, the important one pinned', ready: true },
  { type: 'cards', name: 'Highlighted Cards', hint: 'Cards you want to show off', ready: true },
  { type: 'text', name: 'Text', hint: 'A heading and some words', ready: true },
  { type: 'picture', name: 'Picture', hint: 'A big picture with a caption', ready: true },
  { type: 'board', name: 'Community Board', hint: 'Members post and upvote, like a forum', ready: false },
]
export const blockName = (t: BlockType) => BLOCK_TYPES.find((b) => b.type === t)?.name ?? t

export const MAX_BLOCKS = 20
export const MAX_POSTS = 100
const id = () => 'b' + Math.random().toString(36).slice(2, 9)
export const newId = id

export function newBlock(type: BlockType): Block {
  switch (type) {
    case 'about': return { id: id(), type }
    case 'badges': return { id: id(), type }
    case 'wall': return { id: id(), type, posts: [] }
    case 'announcements': return { id: id(), type, items: [] }
    case 'cards': return { id: id(), type, cards: [] }
    case 'text': return { id: id(), type, title: 'A heading', body: '' }
    case 'picture': return { id: id(), type }
    case 'board': return { id: id(), type }
  }
}

/** Home's blocks — what the creator built, or (before blocks) what the page showed: About and the badge board */
export function homeBlocks(c: Pick<Community, 'page'>): Block[] {
  if (c.page?.home) return c.page.home
  const on = (k: 'about' | 'badgeBoard') => c.page?.sections?.[k] ?? true
  return [
    ...(on('about') ? [{ id: 'about', type: 'about' } as Block] : []),
    ...(on('badgeBoard') ? [{ id: 'badges', type: 'badges' } as Block] : []),
  ]
}

/** A tab's blocks — what the creator built, or (before blocks) its picture and text */
export function tabBlocks(t: CommunityTab): Block[] {
  if (t.blocks) return t.blocks
  return [
    ...(t.image ? [{ id: t.id + '-pic', type: 'picture', image: t.image } as Block] : []),
    { id: t.id + '-text', type: 'text', title: t.title, body: t.body ?? '' },
  ]
}
