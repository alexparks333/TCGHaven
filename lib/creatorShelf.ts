'use client'

// The creator books a collector can earn from (docs/creators.md "Earning creator badges"): one per
// community they've joined. Joining a community makes its creator's published badges theirs to earn —
// FriendsProvider adds them to the badges it checks the collection against, and the Badges shelf shows
// the books (ExtraBooksProvider, lib/badgeCatalog.ts). Leaving keeps what was earned (badges are trophies).

import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase/config'
import { useMyCommunities } from './communities'
import { isLive, type BadgeCatalog } from './badges'
import type { CreatorBook } from './creatorBooks'

/** The books (and their published badges) of the communities this collector has joined, live */
export function useJoinedCreatorBooks(uid: string | null | undefined): { catalog: BadgeCatalog; ready: boolean } {
  const { communities, ready } = useMyCommunities(uid)
  const ids = communities.map((c) => c.uid).sort().join(',')
  const [books, setBooks] = useState<Record<string, CreatorBook | null>>({})
  useEffect(() => {
    const list = ids ? ids.split(',') : []
    setBooks((b) => Object.fromEntries(Object.entries(b).filter(([k]) => list.includes(k))))
    const unsubs = list.map((id) => onSnapshot(doc(db, 'creator_books', id),
      (snap) => setBooks((b) => ({ ...b, [id]: snap.exists() ? ({ badges: [], ...snap.data() } as unknown as CreatorBook) : null })),
      () => setBooks((b) => ({ ...b, [id]: null }))))
    return () => unsubs.forEach((u) => u())
  }, [ids])
  const catalog = useMemo<BadgeCatalog>(() => {
    const sets: BadgeCatalog['sets'] = [], badges: BadgeCatalog['badges'] = []
    for (const id of ids ? ids.split(',') : []) {
      const b = books[id]
      if (!b) continue
      // Each creator's book is its own collection on the shelf
      sets.push({ ...b.book, collection: b.book.collection?.trim() || b.book.name })
      for (const d of b.badges) if (isLive(d)) badges.push({ ...d, set: b.book.id })
    }
    return { sets, badges }
  }, [ids, books])
  const loaded = ready && (ids ? ids.split(',').every((id) => id in books) : true)
  return { catalog, ready: loaded }
}

/** The community a creator book belongs to (its creator's uid), from the book's id */
export const communityOfSet = (setId: string) => (setId.startsWith('creator-') ? setId.slice('creator-'.length) : null)
