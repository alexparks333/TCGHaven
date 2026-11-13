// Reactions on a Creator Wall's posts (docs/creators.md "Creator Wall"): members (and the creator) tap a
// reaction under a post; everyone sees the counts.
//   wall_reactions/{community}_{post}_{member}_{reaction}  { community, post, member, reaction, at }
// One doc per member per reaction per post (tap again to take it back). Read by anyone signed in, written
// only by that member while they're in the community (firestore.rules). Counts are added up in the browser
// from one live query per wall.
//
// The reactions: start with three; the creator's own art goes in `art` (a picture in /public/reactions/),
// else the built-in drawing is used. A new reaction only needs adding here — the rules accept any id.

import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, deleteDoc, doc, limit, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from './firebase/config'

export interface ReactionDef { id: string; name: string; art?: string }
export const REACTIONS: ReactionDef[] = [
  { id: 'heart', name: 'Love' },
  { id: 'thumbs', name: 'Thumbs up' },
  { id: 'card', name: 'Trading card' },
]

export const DEV_REACT_EVENT = 'tcghaven-dev-react' // Dev panel → Community: fake reactions on every wall post, this device only
export const sendDevReactions = () => window.dispatchEvent(new Event(DEV_REACT_EVENT))

type Counts = Record<string, Record<string, number>> // post → reaction → count

/** A wall's reactions, live: counts per post, which ones are mine, and tap-to-toggle (shown at once) */
export function useWallReactions(community: string, me: string | null, posts: string[]) {
  const postsRef = useRef(posts)
  postsRef.current = posts
  const [counts, setCounts] = useState<Counts>({})
  const [mine, setMine] = useState<Set<string>>(new Set()) // `${post}|${reaction}`
  const [dev, setDev] = useState<Counts>({})
  useEffect(() => {
    if (!me) return // signed out: nothing to read
    return onSnapshot(query(collection(db, 'wall_reactions'), where('community', '==', community), limit(5000)), (snap) => {
      const c: Counts = {}, m = new Set<string>()
      snap.docs.forEach((d) => {
        const r = d.data() as { post: string; member: string; reaction: string }
        ;(c[r.post] ??= {})[r.reaction] = (c[r.post][r.reaction] ?? 0) + 1
        if (r.member === me) m.add(`${r.post}|${r.reaction}`)
      })
      setCounts(c); setMine(m)
    }, () => { /* rules not deployed yet, or offline: no counts */ })
  }, [community, me])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const add = (e: Event) => {
      void e
      setDev((d) => {
        const n = { ...d }
        postsRef.current.forEach((p) => { n[p] = { ...(n[p] ?? {}) }; REACTIONS.forEach((r) => { if (Math.random() < 0.7) n[p][r.id] = (n[p][r.id] ?? 0) + 1 + Math.floor(Math.random() * 6) }) })
        return n
      })
    }
    window.addEventListener(DEV_REACT_EVENT, add)
    return () => window.removeEventListener(DEV_REACT_EVENT, add)
  }, [])

  const toggle = useCallback(async (post: string, reaction: string) => {
    if (!me) return
    const key = `${post}|${reaction}`, on = !mine.has(key)
    // shown at once; the live query settles it (and puts it back if the write is refused)
    setMine((s) => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n })
    setCounts((c) => ({ ...c, [post]: { ...(c[post] ?? {}), [reaction]: Math.max(0, (c[post]?.[reaction] ?? 0) + (on ? 1 : -1)) } }))
    const ref = doc(db, 'wall_reactions', `${community}_${post}_${me}_${reaction}`)
    try {
      if (on) await setDoc(ref, { community, post, member: me, reaction, at: serverTimestamp() })
      else await deleteDoc(ref)
    } catch {
      setMine((s) => { const n = new Set(s); if (on) n.delete(key); else n.add(key); return n })
      setCounts((c) => ({ ...c, [post]: { ...(c[post] ?? {}), [reaction]: Math.max(0, (c[post]?.[reaction] ?? 0) + (on ? -1 : 1)) } }))
    }
  }, [community, me, mine])

  const count = (post: string, reaction: string) => (counts[post]?.[reaction] ?? 0) + (dev[post]?.[reaction] ?? 0)
  return { count, mine: (post: string, reaction: string) => mine.has(`${post}|${reaction}`), toggle }
}
