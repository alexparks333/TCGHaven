'use client'

import { useSyncExternalStore } from 'react'
import { doc, onSnapshot, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { rebaseList } from '@/lib/rebase'

// Text Keys — words in a card's name that the collector app draws in their own colour / weight,
// e.g. "(Nexus Promo)" in purple, slightly italic. Edited by staff from the Admin Catalog's Text
// Key button; stored in Firestore `registry/textKeys` (public read, staff write — the registry
// rules), read live by every open app. Rendered by components/CardName.tsx.

export interface TextKey {
  id: string
  text: string // matched anywhere in a card's name, ignoring case
  show?: string // what's shown in its place ('' / missing = the matched text itself)
  color: string // '#rrggbb', '' = the name's own colour
  bold: boolean
  italic: boolean // slightly — a small skew, not the font's full italic
}

// Until staff first save the list
export const DEFAULT_TEXT_KEYS: TextKey[] = [
  { id: 'nexus-promo', text: '(Nexus Promo)', color: '#7a3fc4', bold: false, italic: true },
]

const STORAGE_KEY = 'tcghaven-text-keys'
let current: TextKey[] = DEFAULT_TEXT_KEYS
let started = false
const listeners = new Set<() => void>()

function publish(keys: TextKey[]) {
  current = keys
  listeners.forEach((l) => l())
}

// One listener per app session, started by the first card name drawn. The last list is kept in
// localStorage so names are styled right away on the next visit.
function start() {
  if (started || typeof window === 'undefined') return
  started = true
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (Array.isArray(stored)) publish(stored)
  } catch { /* blocked or corrupt — the defaults stand */ }
  onSnapshot(doc(db, 'registry', 'textKeys'), (snap) => {
    const keys = snap.exists() && Array.isArray(snap.data().keys) ? (snap.data().keys as TextKey[]) : DEFAULT_TEXT_KEYS
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keys)) } catch { /* full or blocked — fine */ }
    publish(keys)
  }, (err) => console.error('Text keys listener failed:', err))
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useTextKeys(): TextKey[] {
  return useSyncExternalStore(subscribe, () => current, () => DEFAULT_TEXT_KEYS)
}

const cleanKeys = (keys: TextKey[]) => keys
  .map((k) => ({ id: k.id, text: k.text.trim(), show: k.show?.trim() ?? '', color: k.color || '', bold: !!k.bold, italic: !!k.italic }))
  .filter((k) => k.text)

/** Staff portal: save an edit of the list (pass the staff session's Firestore). `base` = the list
 *  the editor opened with: only the keys changed since then (added, edited, deleted, reordered)
 *  are replayed onto the latest saved list, in a transaction — another staff member's save in
 *  between survives. */
export async function saveTextKeys(firestore: Firestore, base: TextKey[], keys: TextKey[]): Promise<void> {
  const ref = doc(firestore, 'registry', 'textKeys')
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref)
    const latest = snap.exists() && Array.isArray(snap.data().keys) ? (snap.data().keys as TextKey[]) : DEFAULT_TEXT_KEYS
    const merged = rebaseList(cleanKeys(base), cleanKeys(keys), cleanKeys(latest), (k) => k.id)
    tx.set(ref, { keys: merged, updatedAt: serverTimestamp() })
  })
}

export function textKeyStyle(k: TextKey): React.CSSProperties {
  return {
    ...(k.color ? { color: k.color } : {}),
    ...(k.bold ? { fontWeight: 800 } : {}),
    ...(k.italic ? { display: 'inline-block', transform: 'skewX(-7deg)' } : {}),
  }
}
