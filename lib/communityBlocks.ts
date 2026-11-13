// A community page is built from blocks (docs/creators.md "Community page blocks"): every tab — Home and
// the creator's own pages — is an ordered list of them, added with "+" in the Studio and edited in its
// side panel. They live in the community's doc (communities/{uid}.page — Home in `home`, a tab's in
// `tabs[i].blocks`), so the page and its blocks load and save together.

import type { BadgeSlot } from './badges'
import type { BlockStyle } from './blockStyle'
import type { Community, CommunityTab } from './creatorBooks'

export type BlockType = 'about' | 'badges' | 'wall' | 'announcements' | 'cards' | 'text' | 'picture' | 'board'

export interface WallPost { id: string; text: string; image?: string; at: number }
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
