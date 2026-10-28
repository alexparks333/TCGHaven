import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './config'
import { badgeProgress, ownedCatalogIds, type BadgeCatalog } from '../badges'
import type { Card } from '../types'

// shared_badges/{uid} = { earned: { badgeId: earnedAtMillis }, progress: { badgeId: [have, total] } }
// Written by the owner's own app (FriendsProvider keeps it in step with their inventory); readable
// by them, and by their friends while their profile's privacy.badges is on (firestore.rules).
// Earned badges are never removed — a badge is a trophy, kept even if the cards are sold later.

export interface SharedBadges {
  earned: Record<string, number>
  progress: Record<string, [number, number]>
}

const EMPTY: SharedBadges = { earned: {}, progress: {} }

/** Someone's badges, or 'private' when you can't see them (not friends, or they don't share). */
export async function loadBadges(uid: string): Promise<SharedBadges | 'private'> {
  try {
    const snap = await getDoc(doc(db, 'shared_badges', uid))
    if (!snap.exists()) return EMPTY
    const d = snap.data()
    return { earned: d.earned ?? {}, progress: d.progress ?? {} }
  } catch {
    return 'private'
  }
}

/** This collection's badges: everything earned before, plus anything earned now, and progress. */
export function computeBadges(cards: Card[], previous: SharedBadges, catalog: BadgeCatalog): SharedBadges {
  const owned = ownedCatalogIds(cards)
  const earned = { ...previous.earned }
  const progress: SharedBadges['progress'] = {}
  for (const def of catalog.badges) {
    const p = badgeProgress(def, owned)
    progress[def.id] = [p.have, p.total]
    if (p.done && !earned[def.id]) earned[def.id] = Date.now()
  }
  return { earned, progress }
}

export async function saveBadges(uid: string, badges: SharedBadges): Promise<void> {
  await setDoc(doc(db, 'shared_badges', uid), { ...badges, updatedAt: serverTimestamp() })
}

export function sameBadges(a: SharedBadges, b: SharedBadges): boolean {
  const key = (x: SharedBadges) => JSON.stringify([
    Object.keys(x.earned).sort().map((k) => [k, x.earned[k]]),
    Object.keys(x.progress).sort().map((k) => [k, x.progress[k]]),
  ])
  return key(a) === key(b)
}
