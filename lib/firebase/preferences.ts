import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from './config'
import type { Game } from '../types'

// Per-user display preferences that should follow the account across devices (unlike the
// localStorage-only filter prefs in lib/store.ts). One small doc, covered by the existing
// users/{uid}/** rule in firestore.rules.
function prefsRef(userId: string) {
  return doc(db, 'users', userId, 'settings', 'preferences')
}

const VALID_GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg']

// null = never saved — the caller falls back to DEFAULT_TRACKED_GAMES (Riftbound only).
export async function loadTrackedGames(userId: string): Promise<Game[] | null> {
  const snap = await getDoc(prefsRef(userId))
  const raw = snap.data()?.trackedGames
  if (!Array.isArray(raw)) return null
  const games = raw.filter((g): g is Game => VALID_GAMES.includes(g))
  return games.length > 0 ? games : null
}

export async function saveTrackedGames(userId: string, games: Game[]): Promise<void> {
  await setDoc(prefsRef(userId), { trackedGames: games }, { merge: true })
}
