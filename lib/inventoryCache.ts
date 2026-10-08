import type { Card } from './types'

// The device's own copy of a user's inventory, so opening the app doesn't re-read every card
// from Firestore. AuthProvider loads it, asks Firestore only for what changed since `cursor`
// (lib/firebase/db.ts loadCardChanges), and keeps it updated as cards change.
//
// Plain IndexedDB (no dependency). Every call fails soft — private browsing, blocked storage,
// a quota error — and just returns null / does nothing, which falls back to a full load.

export interface InventoryCacheEntry {
  format: number
  cards: Card[]
  cursor: number      // newest server timestamp (ms) already reflected in `cards`
  fullSyncAt: number  // when the cache was last rebuilt from a full read
}

// Bump when Card's stored shape changes in a way old cached copies can't be trusted for —
// every device then does one fresh full load.
export const INVENTORY_CACHE_FORMAT = 1
// Rebuild from a full read at least this often, as a safety net against any drift.
export const INVENTORY_FULL_SYNC_EVERY_MS = 7 * 24 * 60 * 60 * 1000

const DB_NAME = 'tcghaven'
const STORE = 'inventory'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      tx.oncomplete = () => db.close()
      tx.onabort = () => { db.close(); resolve(null) }
    } catch {
      db.close()
      resolve(null)
    }
  })
}

export async function readInventoryCache(uid: string): Promise<InventoryCacheEntry | null> {
  const entry = (await run('readonly', (s) => s.get(uid))) as InventoryCacheEntry | undefined | null
  if (!entry || entry.format !== INVENTORY_CACHE_FORMAT || !Array.isArray(entry.cards)) return null
  return entry
}

export async function writeInventoryCache(uid: string, entry: Omit<InventoryCacheEntry, 'format'>): Promise<void> {
  await run('readwrite', (s) => s.put({ ...entry, format: INVENTORY_CACHE_FORMAT }, uid))
}

// On sign-out: don't leave anyone's collection sitting on a shared device.
export async function clearInventoryCache(): Promise<void> {
  await run('readwrite', (s) => s.clear())
}
