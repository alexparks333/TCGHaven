'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore'
import { db } from './firebase/config'
import { DEFAULT_BADGE_CATALOG, type BadgeCatalog } from './badges'
import { rebaseList } from './rebase'

// The badge catalog (every pin book and badge), edited in the staff portal (/admin/badges) and
// stored as one doc: badge_catalog/main = { sets, badges }. Until the doc exists, the built-in
// DEFAULT_BADGE_CATALOG is used. One shared listener for the whole page, however many components ask.
//
// main is a few hundred KB, so it isn't listened to directly: every save also stamps the tiny
// badge_catalog/version = { v }, the app listens to that, and downloads main only when v differs
// from the copy kept on this device (localStorage). An admin change still shows up for everyone
// right away. Before the first save that writes version, main is listened to as it always was.

const STORAGE_KEY = 'tcghaven-badge-catalog'

let current: BadgeCatalog = DEFAULT_BADGE_CATALOG
let currentV: number | null = null
let loaded = false
let unsubscribe: (() => void) | null = null
let unsubscribeMain: (() => void) | null = null
const listeners = new Set<(c: BadgeCatalog) => void>()

function fromDoc(d: Partial<BadgeCatalog> | undefined): BadgeCatalog {
  return d?.sets && d?.badges ? { sets: d.sets, badges: d.badges } : DEFAULT_BADGE_CATALOG
}

function publish(catalog: BadgeCatalog) {
  current = catalog
  loaded = true
  listeners.forEach((l) => l(current))
}

function readStored(): { v: number; catalog: BadgeCatalog } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function store(v: number, catalog: BadgeCatalog) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ v, catalog })) } catch { /* full or blocked — fine */ }
}

function start() {
  if (unsubscribe) return
  const stored = readStored()
  if (stored?.catalog) { currentV = stored.v; publish(stored.catalog) }

  unsubscribe = onSnapshot(doc(db, 'badge_catalog', 'version'), (snap) => {
    const v = snap.data()?.v as number | undefined
    if (typeof v !== 'number') {
      // No version stamp yet: listen to main itself.
      if (!unsubscribeMain) {
        unsubscribeMain = onSnapshot(doc(db, 'badge_catalog', 'main'), (s) => publish(fromDoc(s.data() as Partial<BadgeCatalog> | undefined)),
          (err) => console.error('Badge catalog listener failed:', err))
      }
      return
    }
    unsubscribeMain?.(); unsubscribeMain = null
    if (v === currentV && loaded) return
    getDoc(doc(db, 'badge_catalog', 'main')).then((s) => {
      const catalog = fromDoc(s.data() as Partial<BadgeCatalog> | undefined)
      currentV = v
      store(v, catalog)
      publish(catalog)
    }).catch((err) => console.error('Badge catalog load failed:', err))
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

/** Staff portal: save an edit (pass the staff session's Firestore). `base` is the catalog the edit
 *  was made from, `next` the result. Several staff can work at once: only what this edit changed
 *  (base → next: badges and books added, changed, deleted or reordered) is replayed onto the
 *  latest saved catalog, in a transaction — so another person's save in between is never undone. */
export async function saveBadgeCatalog(firestore: Firestore, base: BadgeCatalog, next: BadgeCatalog): Promise<void> {
  const mainRef = doc(firestore, 'badge_catalog', 'main')
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(mainRef)
    const latest = snap.exists() ? fromDoc(snap.data() as Partial<BadgeCatalog>) : base
    const merged: BadgeCatalog = {
      sets: rebaseList(base.sets, next.sets, latest.sets, (s) => s.id),
      badges: rebaseList(base.badges, next.badges, latest.badges, (b) => b.id),
    }
    // Firestore rejects undefined values — drop optional fields that aren't set.
    const clean = JSON.parse(JSON.stringify(merged)) as BadgeCatalog
    // Both together: the version stamp is what tells every open app to fetch main again.
    tx.set(mainRef, { ...clean, updatedAt: serverTimestamp() })
    tx.set(doc(firestore, 'badge_catalog', 'version'), { v: Date.now(), updatedAt: serverTimestamp() })
  })
}
