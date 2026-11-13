// What a community's owner puts up on their page (docs/creators.md "Posting on the page"): Creator Wall
// posts and announcements. Written by the owner right on their community page — never in the Creator
// Studio, which is only the page's layout and look. Highlighted Cards are posts too (kind 'card', one card each) (communities/{uid}.page). Kept in their own collection
// so a Studio save of the layout can never overwrite a post.
//   community_posts/{id}  { community, block, kind: 'wall' | 'announcement' | 'card', text, title?, image?, note?, look? (a wall note's layout), pinned?, slot?, at }
// Anyone signed in reads; only the community's owner (community == their uid) writes (firestore.rules).
// Older posts kept inside the block (block.posts / block.items, before this) still show, merged in.

import { useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, deleteField, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase/config'
import type { BadgeSlot } from './badges'
import type { NoteLook } from './communityBlocks'

export interface CommunityPost {
  id: string; community: string; block: string; kind: 'wall' | 'announcement' | 'card'
  text: string; title?: string; image?: string; note?: string; look?: NoteLook; pinned?: boolean; slot?: BadgeSlot; at: number
}

/** A block's posts, live, newest first */
export function useBlockPosts(community: string, block: string) {
  const [posts, setPosts] = useState<CommunityPost[]>([])
  useEffect(() => {
    return onSnapshot(query(collection(db, 'community_posts'), where('community', '==', community), where('block', '==', block)), (snap) => {
      setPosts(snap.docs.map((d) => {
        const r = d.data() as Omit<CommunityPost, 'id' | 'at'> & { at?: { toMillis?: () => number } }
        return { ...r, id: d.id, at: r.at?.toMillis?.() ?? Date.now() }
      }).sort((a, b) => b.at - a.at))
    }, () => setPosts([]))
  }, [community, block])
  return posts
}

export async function addPost(p: Omit<CommunityPost, 'id' | 'at'>) {
  // Firestore refuses undefined anywhere — a JSON round trip drops it (a picked card's details can have gaps)
  const clean = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''))))
  await addDoc(collection(db, 'community_posts'), { text: '', ...clean, at: serverTimestamp() })
}
export const removePost = (id: string) => deleteDoc(doc(db, 'community_posts', id))

/** Pin one announcement to the top (and unpin the rest of that block's) — or unpin it */
export async function pinPost(posts: CommunityPost[], id: string, on: boolean) {
  const b = writeBatch(db)
  posts.forEach((p) => { if (p.id === id) b.update(doc(db, 'community_posts', p.id), { pinned: on }); else if (on && p.pinned) b.update(doc(db, 'community_posts', p.id), { pinned: false }) })
  await b.commit()
}
/** Change a post. `image: null` takes its picture off; the rest is JSON-cleaned (Firestore refuses undefined). */
export function editPost(id: string, patch: Partial<Pick<CommunityPost, 'text' | 'title' | 'note' | 'look'>> & { image?: string | null }) {
  const { image, ...rest } = patch
  const clean = JSON.parse(JSON.stringify(rest))
  return updateDoc(doc(db, 'community_posts', id), { ...clean, ...(image === null ? { image: deleteField() } : image ? { image } : {}) })
}
