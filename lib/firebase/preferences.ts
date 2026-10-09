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

// ── Filters (the header's Filters panel) ─────────────────────────────────────────────────────
// Stored on the same doc so a filter set on one device is the filter on every device, until
// either one changes it. lib/preferencesSync.ts keeps the store and this doc in step live.

export type TimeFrame = 'entry' | '1d' | '7d' | '30d' | '365d'
const VALID_TIME_FRAMES: TimeFrame[] = ['entry', '1d', '7d', '30d', '365d']

export interface FilterPrefs {
  calcFloor: number
  activeGames: Game[]
  timeFrame: TimeFrame
  hiddenGroups: string[]
}

// Anything malformed in the stored doc is dropped field-by-field rather than trusted.
export function parseFilterPrefs(raw: unknown): Partial<FilterPrefs> | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: Partial<FilterPrefs> = {}
  if (typeof r.calcFloor === 'number' && r.calcFloor >= 0) out.calcFloor = r.calcFloor
  if (Array.isArray(r.activeGames)) out.activeGames = r.activeGames.filter((g): g is Game => VALID_GAMES.includes(g))
  if (VALID_TIME_FRAMES.includes(r.timeFrame as TimeFrame)) out.timeFrame = r.timeFrame as TimeFrame
  if (Array.isArray(r.hiddenGroups)) out.hiddenGroups = r.hiddenGroups.filter((g): g is string => typeof g === 'string')
  return Object.keys(out).length > 0 ? out : null
}

export function preferencesDoc(userId: string) {
  return prefsRef(userId)
}

export async function saveFilterPrefs(userId: string, filters: FilterPrefs): Promise<void> {
  await setDoc(prefsRef(userId), { filters }, { merge: true })
}
