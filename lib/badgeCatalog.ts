'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp, type Firestore } from 'firebase/firestore'
import { db } from './firebase/config'
import { DEFAULT_BADGE_CATALOG, type BadgeCatalog } from './badges'

// The badge catalog (every pin book and badge), edited in the staff portal (/admin/badges) and
// stored as one small doc: badge_catalog/main = { sets, badges }. Read live — an admin change shows
// up for everyone right away. Until the doc exists, the built-in DEFAULT_BADGE_CATALOG is used.
// One shared listener for the whole page, however many components ask.

let current: BadgeCatalog = DEFAULT_BADGE_CATALOG
let loaded = false
let unsubscribe: (() => void) | null = null
const listeners = new Set<(c: BadgeCatalog) => void>()

function start() {
  if (unsubscribe) return
  unsubscribe = onSnapshot(doc(db, 'badge_catalog', 'main'), (snap) => {
    const d = snap.data() as Partial<BadgeCatalog> | undefined
    current = d?.sets && d?.badges ? { sets: d.sets, badges: d.badges } : DEFAULT_BADGE_CATALOG
    loaded = true
    listeners.forEach((l) => l(current))
  }, (err) => console.error('Badge catalog listener failed:', err))
}

export function useBadgeCatalog(): { catalog: BadgeCatalog; loaded: boolean } {
  const [state, setState] = useState({ catalog: current, loaded })
  useEffect(() => {
    start()
    const l = (c: BadgeCatalog) => setState({ catalog: c, loaded: true })
    listeners.add(l)
    if (loaded) setState({ catalog: current, loaded: true })
    return () => { listeners.delete(l) }
  }, [])
  return state
}

/** Staff portal: save the whole catalog (pass the staff session's Firestore). */
export async function saveBadgeCatalog(firestore: Firestore, catalog: BadgeCatalog): Promise<void> {
  // Firestore rejects undefined values — drop optional fields that aren't set.
  const clean = JSON.parse(JSON.stringify(catalog)) as BadgeCatalog
  await setDoc(doc(firestore, 'badge_catalog', 'main'), { ...clean, updatedAt: serverTimestamp() })
}
