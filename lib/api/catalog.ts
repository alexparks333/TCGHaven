import {
  collection, doc, getDoc, getDocs, query, where, setDoc, writeBatch, Timestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import type { Game } from '../types'

/**
 * Shared catalog helpers for the three game modules. Firestore is the source of truth
 * (see firestore.rules — public read, admin-only write); this module is what keeps reads
 * cheap: the full catalog for a game is cached in memory for the lifetime of the server
 * process, populated once from a pre-sharded "snapshot" (a handful of documents, not one
 * per card) on cold start, then kept fresh with small incremental pulls of only what
 * changed since the last sync. No per-search Firestore reads. Safe to import from either
 * server or client code — the Firestore client SDK works in both.
 */

const CHUNK_SIZE = 1500          // cards per snapshot chunk doc, safely under Firestore's 1MiB limit
const STALE_MS = 2 * 60 * 1000   // how long a warm cache is trusted before checking for deltas

interface CacheEntry {
  cards: Map<string, Record<string, unknown>>
  lastSyncAt: Date
}

const _cache = new Map<Game, CacheEntry>()

async function loadFromSnapshot(game: Game): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>()
  try {
    const chunksSnap = await getDocs(collection(db, 'catalog_snapshot', game, 'chunks'))
    for (const chunkDoc of chunksSnap.docs) {
      const raw = chunkDoc.data().cards as string | undefined
      if (!raw) continue
      const cards = JSON.parse(raw) as Array<Record<string, unknown> & { id: string }>
      for (const c of cards) map.set(c.id, c)
    }
  } catch {
    // No snapshot yet (e.g. before the first sync has ever run) — start empty rather than throw.
  }
  return map
}

async function pullDeltas(game: Game, since: Date): Promise<Array<Record<string, unknown> & { id: string }>> {
  const sinceTs = Timestamp.fromDate(since)
  const q = query(collection(db, 'catalog', game, 'cards'), where('updatedAt', '>', sinceTs))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Loads the full catalog (including hidden cards) for one game, from the in-memory cache. */
export async function loadCatalog<T>(game: Game): Promise<T[]> {
  const now = new Date()
  let entry = _cache.get(game)

  if (!entry) {
    const cards = await loadFromSnapshot(game)
    entry = { cards, lastSyncAt: now }
    _cache.set(game, entry)
    return Array.from(entry.cards.values()) as T[]
  }

  if (now.getTime() - entry.lastSyncAt.getTime() > STALE_MS) {
    const deltas = await pullDeltas(game, entry.lastSyncAt)
    for (const card of deltas) entry.cards.set(card.id, card)
    entry.lastSyncAt = now
  }

  return Array.from(entry.cards.values()) as T[]
}

/** Clears the in-memory cache for a game (or every game) — forces the next read to refetch. */
export function invalidateCatalogCache(game?: Game) {
  if (game) _cache.delete(game)
  else _cache.clear()
}

/**
 * Same as loadCatalog(), but filters out cards hidden via the Admin Catalog page (`hidden:
 * true` on the card's own Firestore document). This is what every *real* consumer (search,
 * Cardex, Pack Analysis) should read through — hidden cards stay in Firestore (so the Admin
 * browse table can keep showing and un-hiding them) and are only ever filtered out here.
 */
export async function loadVisibleCatalog<T extends { hidden?: boolean }>(game: Game): Promise<T[]> {
  const all = await loadCatalog<T>(game)
  return all.filter((c) => !c.hidden)
}

/**
 * Rewrites catalog_snapshot/{game}/chunks/* from the current catalog/{game}/cards/* state.
 * Called after any write (Admin add/hide/edit/upload, or a bulk download sync) so a freshly
 * cold app instance picks up the change without waiting for the next full re-download.
 * Requires the caller to already be signed in as the admin (Firestore rules enforce this).
 */
export async function regenerateSnapshot(game: Game): Promise<void> {
  const cardsSnap = await getDocs(collection(db, 'catalog', game, 'cards'))
  const cards = cardsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

  const chunkCount = Math.max(1, Math.ceil(cards.length / CHUNK_SIZE))
  for (let i = 0; i < chunkCount; i++) {
    const slice = cards.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    await setDoc(doc(db, 'catalog_snapshot', game, 'chunks', String(i)), { cards: JSON.stringify(slice) })
  }
  // Remove any leftover chunk docs from a previous, larger snapshot (e.g. after hiding cards
  // shrinks the count enough to need fewer chunks than last time).
  const existingChunks = await getDocs(collection(db, 'catalog_snapshot', game, 'chunks'))
  const batch = writeBatch(db)
  let hasDeletes = false
  for (const chunkDoc of existingChunks.docs) {
    if (parseInt(chunkDoc.id, 10) >= chunkCount) { batch.delete(chunkDoc.ref); hasDeletes = true }
  }
  if (hasDeletes) await batch.commit()

  invalidateCatalogCache(game) // this instance's own cache should reflect the change immediately too
}

/** Reads catalog_meta/{game}.lastBulkSyncAt, or null if a bulk sync has never run. */
export async function getLastBulkSyncAt(game: Game): Promise<Date | null> {
  const snap = await getDoc(doc(db, 'catalog_meta', game))
  const ts = snap.data()?.lastBulkSyncAt as Timestamp | undefined
  return ts ? ts.toDate() : null
}

// Rarity sort weight shared by Cardex display and the Admin Catalog listing —
// keep both in sync with a single comparator rather than duplicating it.
export const CARDEX_RARITY_ORDER: Record<string, number> = {
  Common: 0, Uncommon: 1, Rare: 2, Super_rare: 3, Legendary: 4, Enchanted: 5, Epic: 6, Iconic: 7, Promo: 8,
  Showcase: 90, Star: 91,
}

/** Sorts catalog cards by collector number, then rarity, matching Cardex's display order. */
export function sortCatalogCards<T extends { number: string; rarity?: string }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const aNum = parseInt(a.number, 10)
    const bNum = parseInt(b.number, 10)
    const aIsR = isNaN(aNum)
    const bIsR = isNaN(bNum)
    if (!aIsR && !bIsR) {
      const numDiff = aNum - bNum
      if (numDiff !== 0) return numDiff
      return (CARDEX_RARITY_ORDER[a.rarity ?? ''] ?? 50) - (CARDEX_RARITY_ORDER[b.rarity ?? ''] ?? 50)
    }
    if (aIsR && bIsR) return a.number.localeCompare(b.number)
    return aIsR ? 1 : -1 // R-format (Rune) cards sort after numeric cards
  })
}

/**
 * Splits a raw search string into a name portion and an optional collector-number
 * filter. Any token that is purely digits (e.g. "138", "088") is treated as a
 * number filter; everything else is the name query.
 *
 * "Rayquaza 138"  → { nameQuery: "Rayquaza", numberFilter: "138" }
 * "Mickey Mouse"  → { nameQuery: "Mickey Mouse", numberFilter: null }
 */
export function parseSearchQuery(raw: string): { nameQuery: string; numberFilter: string | null } {
  const words = raw.trim().split(/\s+/)
  const nums: string[] = []
  const names: string[] = []
  for (const w of words) {
    if (/^\d+$/.test(w)) nums.push(w)
    else names.push(w)
  }
  return {
    nameQuery: names.join(' '),
    numberFilter: nums.length > 0 ? nums[0] : null,
  }
}

/** Normalise a collector number for comparison — strips leading zeros so "088" === "88". */
export function normNum(n: string) { return String(parseInt(n, 10)) }

/**
 * Relevance score for a card name against a search query (higher = better),
 * or -1 if any query word doesn't match the START of a name token (or tag).
 * No mid-word substring matching — "cr" will NOT match "incredible",
 * only names with a token starting with "cr" (e.g. "cratchit").
 *
 * Scoring: exact token match = 30, token prefix = 15, tag match = 20,
 * first-word-starts-name bonus = 10.
 */
export function scoreMatch(name: string, query: string, tags?: string[]): number {
  const tokens = name.toLowerCase().split(/[\s\-·,']+/).filter(Boolean)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  let score = 0
  for (const w of words) {
    if (tokens.some((t) => t === w)) score += 30
    else if (tokens.some((t) => t.startsWith(w))) score += 15
    else if (tags?.some((tag) => {
      const t = tag.toLowerCase()
      return t === w || t.startsWith(w)
    })) score += 20 // tag hit (e.g. "ahri" finds LeBlanc's "Deceiver" tagged ["Ahri"])
    else return -1
  }
  const first = words[0]
  if (tokens[0] === first || tokens[0]?.startsWith(first)) score += 10
  return score
}
