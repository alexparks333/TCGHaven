import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import type { Game } from '@/lib/types'

/**
 * Durable "did the last sync actually work" record, one doc per game at
 * sync_status/{game} — separate from catalog_meta/{game}.lastBulkSyncAt (which only ever
 * records a *successful* run) so a FAILED run is visible too. Nothing about this app's sync
 * pipeline previously surfaced a failure anywhere except an admin happening to be watching the
 * Admin Catalog page's network tab at the exact moment they clicked "Sync" — a cron-triggered
 * failure at 3am was otherwise invisible until someone noticed the catalog looked stale days
 * later. Written by every sync route (success or failure) and the MTG new-set check; read by
 * Admin Catalog's Sync panel.
 */
export interface SyncStatus {
  ok: boolean
  at: string          // ISO timestamp of this attempt
  setCount?: number
  newSets?: string[]
  error?: string
}

// `id` is normally a Game, but also accepts a distinct key like "mtg-new-set-check" for a
// lightweight check that isn't a real sync and must never clobber that game's real sync_status
// doc (different shape, different meaning — see checkForNewMtgSets() in lib/api/mtg.ts).
export async function recordSyncStatus(id: Game | string, status: SyncStatus): Promise<void> {
  try {
    await setDoc(doc(db, 'sync_status', id), status)
  } catch {
    // Never let a status-recording failure mask the sync's own real result — the route's
    // response body (and thrown error, if any) is still the source of truth for the caller.
  }
}

export async function getSyncStatus(id: Game | string): Promise<SyncStatus | null> {
  const snap = await getDoc(doc(db, 'sync_status', id))
  return snap.exists() ? (snap.data() as SyncStatus) : null
}

export async function getAllSyncStatuses(): Promise<Partial<Record<Game, SyncStatus>>> {
  const snap = await getDocs(collection(db, 'sync_status'))
  const out: Partial<Record<Game, SyncStatus>> = {}
  for (const d of snap.docs) out[d.id as Game] = d.data() as SyncStatus
  return out
}
