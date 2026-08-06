import { collection, doc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from './config'
import type { Game } from '../types'

// Personalized Collections — user-curated "sets" in the Cardex (e.g. "Fury Runes" across
// every Riftbound set) that aren't tied to any real TCG set. Lives under
// users/{uid}/collections/{id}, already covered by the existing users/{uid}/** Firestore rule
// — no rules changes needed, same as every other per-user subcollection.

export interface PersonalCollectionCard {
  id: string          // catalog card id (apiId) — how ownership is matched, same as inventory
  name: string
  number: string
  setName: string
  rarity?: string
  imageUrl: string
  marketPrice?: number
}

export interface PersonalCollection {
  id: string
  game: Extract<Game, 'lorcana' | 'riftbound'>
  name: string
  cards: PersonalCollectionCard[]
  createdAt: string
}

export async function loadCollections(userId: string): Promise<PersonalCollection[]> {
  const snap = await getDocs(collection(db, 'users', userId, 'collections'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PersonalCollection))
}

export function newCollectionRef(userId: string) {
  return doc(collection(db, 'users', userId, 'collections'))
}

export async function createCollection(
  userId: string,
  id: string,
  game: PersonalCollection['game'],
  name: string,
): Promise<void> {
  await setDoc(doc(db, 'users', userId, 'collections', id), {
    game, name, cards: [], createdAt: new Date().toISOString(),
  })
}

export async function renameCollection(userId: string, id: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'collections', id), { name })
}

export async function deleteCollection(userId: string, id: string): Promise<void> {
  await deleteDoc(doc(db, 'users', userId, 'collections', id))
}

// Cards are stored as a full array (not arrayUnion/arrayRemove) — those require an exact
// object match to dedupe/remove correctly, which is fragile once a card's cached price drifts
// from what was stored at add-time. Simpler and more robust to just write the whole array.
export async function setCollectionCards(
  userId: string,
  id: string,
  cards: PersonalCollectionCard[],
): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'collections', id), { cards })
}
