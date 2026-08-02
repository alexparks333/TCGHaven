import {
  collection, doc, updateDoc, deleteDoc,
  getDocs, setDoc, arrayUnion,
} from 'firebase/firestore'
import { db } from './config'
import type { Card, PriceHistory, SoldCard } from '../types'

// ── Cards ──────────────────────────────────────────────────────────────────

export async function loadCards(userId: string): Promise<Card[]> {
  const snap = await getDocs(collection(db, 'users', userId, 'cards'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Card))
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


export async function saveCard(userId: string, cardId: string, card: Omit<Card, 'id'>): Promise<void> {
  await setDoc(doc(db, 'users', userId, 'cards', cardId), clean(card) as Record<string, unknown>)
}

export async function editCard(userId: string, cardId: string, updates: Partial<Card>): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'cards', cardId), clean(updates) as Record<string, unknown>)
}

export async function removeCard(userId: string, cardId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', userId, 'cards', cardId))
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

export async function addPricePoint(
  userId: string,
  cardId: string,
  price: number,
  date: string,
): Promise<void> {
  await setDoc(
    doc(db, 'users', userId, 'priceHistory', cardId),
    { cardId, points: arrayUnion({ date, price }) },
    { merge: true }
  )
}
