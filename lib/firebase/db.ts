import {
  collection, doc, updateDoc, deleteDoc, getDocs, setDoc, writeBatch, query, where,
  serverTimestamp, Timestamp, type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore'
import { db } from './config'
import type { Card, PriceHistory, SoldCard } from '../types'

// ── Cards ──────────────────────────────────────────────────────────────────
//
// Every write to a user's card stamps `updatedAt` with the SERVER's time, and every delete leaves
// a small tombstone at users/{uid}/deletedCards/{cardId} (also server-timestamped). That's what
// lets a device keep its own cached copy of the inventory (lib/inventoryCache.ts) and, on the
// next open, fetch only what changed since — loadCardChanges() — instead of re-reading every
// card. ALL card writes must go through the functions below so nothing skips the stamp; a card
// changed some other way would never reach other devices' caches (until their weekly full reload).

// Card docs carry Firestore-only bookkeeping (`updatedAt`); keep it out of the app's Card objects
// and report it separately as plain milliseconds.
function toCard(d: QueryDocumentSnapshot<DocumentData>): { card: Card; updatedMs: number } {
  const { updatedAt, ...data } = d.data()
  const updatedMs = updatedAt instanceof Timestamp ? updatedAt.toMillis() : 0
  return { card: { id: d.id, ...data } as Card, updatedMs }
}

// Full read of every card — first load on a device, or the periodic refresh of its cache.
// `cursor` is the newest server timestamp seen, for the next loadCardChanges().
export async function loadCards(userId: string): Promise<{ cards: Card[]; cursor: number }> {
  const snap = await getDocs(collection(db, 'users', userId, 'cards'))
  let cursor = 0
  const cards = snap.docs.map((d) => {
    const { card, updatedMs } = toCard(d)
    if (updatedMs > cursor) cursor = updatedMs
    return card
  })
  return { cards, cursor }
}

// Only what changed since `sinceMs`: cards added/edited (updatedAt > since) and cards deleted
// (tombstone deletedAt > since). Two small queries; a quiet day costs ~2 reads instead of
// thousands. Cards that predate the updatedAt stamp simply never appear here — they're already
// in the cache from the full load and haven't changed.
export async function loadCardChanges(userId: string, sinceMs: number): Promise<{ changed: Card[]; deletedIds: string[]; cursor: number }> {
  const since = Timestamp.fromMillis(sinceMs)
  const [changedSnap, deletedSnap] = await Promise.all([
    getDocs(query(collection(db, 'users', userId, 'cards'), where('updatedAt', '>', since))),
    getDocs(query(collection(db, 'users', userId, 'deletedCards'), where('deletedAt', '>', since))),
  ])
  let cursor = sinceMs
  const changed = changedSnap.docs.map((d) => {
    const { card, updatedMs } = toCard(d)
    if (updatedMs > cursor) cursor = updatedMs
    return card
  })
  const deletedIds = deletedSnap.docs.map((d) => {
    const at = d.data().deletedAt
    const ms = at instanceof Timestamp ? at.toMillis() : 0
    if (ms > cursor) cursor = ms
    return d.id
  })
  return { changed, deletedIds, cursor }
}

// Generate a Firestore doc ID client-side — zero network cost
export function newCardRef(userId: string) {
  return doc(collection(db, 'users', userId, 'cards'))
}

// Strip undefined and NaN — Firestore rejects both
function clean(obj: object): object {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, (typeof v === 'number' && isNaN(v)) ? 0 : v])
  )
}

const cardRef = (userId: string, cardId: string) => doc(db, 'users', userId, 'cards', cardId)
const tombstoneRef = (userId: string, cardId: string) => doc(db, 'users', userId, 'deletedCards', cardId)

export async function saveCard(userId: string, cardId: string, card: Omit<Card, 'id'>): Promise<void> {
  const batch = writeBatch(db)
  batch.set(cardRef(userId, cardId), { ...clean(card), updatedAt: serverTimestamp() })
  // Restoring a sold card reuses its id — clear any tombstone so devices don't drop it again.
  batch.delete(tombstoneRef(userId, cardId))
  await batch.commit()
}

export async function editCard(userId: string, cardId: string, updates: Partial<Card>): Promise<void> {
  await updateDoc(cardRef(userId, cardId), { ...clean(updates), updatedAt: serverTimestamp() })
}

export async function removeCard(userId: string, cardId: string): Promise<void> {
  await removeCards(userId, [cardId])
}

// Deletes cards and leaves a tombstone for each (two writes per card), in one batch per chunk —
// e.g. every lot in a grouped Inventory row at once. Chunked under Firestore's 500-writes limit.
export async function removeCards(userId: string, cardIds: string[]): Promise<void> {
  const CHUNK = 240
  for (let i = 0; i < cardIds.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const id of cardIds.slice(i, i + CHUNK)) {
      batch.delete(cardRef(userId, id))
      batch.set(tombstoneRef(userId, id), { deletedAt: serverTimestamp() })
    }
    await batch.commit()
  }
}

// ── Sold Cards ────────────────────────────────────────────────────────────

export async function loadSoldCards(userId: string): Promise<SoldCard[]> {
  const snap = await getDocs(collection(db, 'users', userId, 'soldCards'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SoldCard))
}

export async function saveSoldCard(userId: string, cardId: string, card: Omit<SoldCard, 'id'>): Promise<void> {
  await setDoc(doc(db, 'users', userId, 'soldCards', cardId), clean(card) as Record<string, unknown>)
}

export async function deleteSoldCard(userId: string, cardId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', userId, 'soldCards', cardId))
}

// ── Price History ──────────────────────────────────────────────────────────

export async function loadPriceHistory(userId: string): Promise<PriceHistory[]> {
  const snap = await getDocs(collection(db, 'users', userId, 'priceHistory'))
  return snap.docs.map((d) => ({ cardId: d.id, ...d.data() } as PriceHistory))
}
