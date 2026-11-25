'use client'

import { useCallback, useEffect, useState } from 'react'
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'
import { CARDEX_RARITY_ORDER } from './api/catalog'

// A set's rarity bubbles in the order staff chose (2026-11-24) — Admin Catalog → Rarity groups → ↑ / ↓.
// One small doc per game, catalog_meta/{game}_rarities { order: { [setName]: rarity[] } } (catalog_meta:
// anyone reads, staff write — firestore.rules). The Cardex's rarity bubbles and Admin Catalog's follow it;
// a set with no saved order (or a rarity not in it) falls back to CARDEX_RARITY_ORDER.

export type RarityOrder = Record<string, string[]>

const orderDoc = (fs: Firestore, game: string) => doc(fs, 'catalog_meta', `${game}_rarities`)
const loaded = new Map<string, Promise<RarityOrder>>()

export function loadRarityOrder(fs: Firestore, game: string, fresh = false): Promise<RarityOrder> {
  if (!fresh && loaded.has(game)) return loaded.get(game)!
  const p = getDoc(orderDoc(fs, game))
    .then((d) => (d.data()?.order ?? {}) as RarityOrder)
    .catch(() => ({}) as RarityOrder)
  loaded.set(game, p)
  return p
}

/** Staff: save one set's order (the other sets' are left as they are) */
export async function saveSetRarityOrder(fs: Firestore, game: string, setName: string, list: string[]): Promise<void> {
  await setDoc(orderDoc(fs, game), { order: { [setName]: list }, updatedAt: serverTimestamp() }, { merge: true })
  loaded.delete(game)
}

/** Rarities in the set's saved order; anything it doesn't list after, by the shared order, then A–Z */
export function sortRarities(list: string[], setOrder?: string[]): string[] {
  const at = new Map((setOrder ?? []).map((r, i) => [r, i]))
  return [...list].sort((a, b) => {
    const ia = at.has(a) ? at.get(a)! : Infinity
    const ib = at.has(b) ? at.get(b)! : Infinity
    if (ia !== ib) return ia - ib
    const pa = CARDEX_RARITY_ORDER[a] ?? 9999
    const pb = CARDEX_RARITY_ORDER[b] ?? 9999
    return pa !== pb ? pa - pb : a.localeCompare(b)
  })
}

/** Every set's saved order for a game; `reload` re-reads it (after staff save one) */
export function useRarityOrder(fs: Firestore, game: string): { order: RarityOrder; reload: () => void } {
  const [order, setOrder] = useState<RarityOrder>({})
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    loadRarityOrder(fs, game, tick > 0).then((o) => { if (live) setOrder(o) })
    return () => { live = false }
  }, [fs, game, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { order, reload }
}
