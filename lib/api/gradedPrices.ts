import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'
import type { CatalogKey } from '../types'

/**
 * PriceCharting graded prices for the price routes — docs/PriceCharting.md. Written once a day by
 * scripts/pricecharting-sync.mjs into graded_prices/{key} (meta: chunkCount, asOf) and
 * graded_prices/{key}/chunks/{0..chunkCount-1} (JSON list of { id, pc, u, p }), kept apart from the
 * catalog cards so the graded job never touches a card's updatedAt (the catalog sync would read
 * that as a staff edit and skip the card).
 *
 * Off unless the server env GRADED_PRICES=on: the licence requires a PriceCharting citation beside
 * every graded price shown, so the app only uses them once that UI is in place.
 */

export interface GradedEntry {
  id: string                    // catalog card id
  pc: string                    // PriceCharting product id
  u: string                     // the card's PriceCharting page — the required citation link
  p: Record<string, number>     // graded key (psa10, g9 …) → USD
}

export const gradedPricesEnabled = () => process.env.GRADED_PRICES === 'on'

const TTL_MS = 30 * 60 * 1000          // the data changes once a day
const FAILED_TTL_MS = 2 * 60 * 1000    // a failed read retries soon, pricing raw meanwhile

const _cache = new Map<CatalogKey, { at: number; ttl: number; byId: Map<string, GradedEntry> }>()
const _loading = new Map<CatalogKey, Promise<Map<string, GradedEntry>>>()

async function read(key: CatalogKey): Promise<Map<string, GradedEntry>> {
  const meta = await getDoc(doc(db, 'graded_prices', key))
  const byId = new Map<string, GradedEntry>()
  const count = Number(meta.exists() ? meta.data().chunkCount : 0) || 0
  if (!count) return byId
  // Only chunks 0..count-1 belong to the latest write; higher-numbered leftovers are ignored.
  const snap = await getDocs(collection(db, 'graded_prices', key, 'chunks'))
  for (const d of snap.docs) {
    const n = Number(d.id)
    if (!Number.isInteger(n) || n >= count) continue
    const raw = d.data().cards as string | undefined
    if (!raw) continue
    for (const e of JSON.parse(raw) as GradedEntry[]) byId.set(e.id, e)
  }
  return byId
}

/** Catalog card id → its graded entry. Empty when switched off, not synced yet, or unreadable —
 *  graded cards are then priced raw, never wrongly. */
export async function loadGradedPrices(key: CatalogKey): Promise<Map<string, GradedEntry>> {
  if (!gradedPricesEnabled()) return new Map()
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.byId
  const inFlight = _loading.get(key)
  if (inFlight) return inFlight
  const p = read(key)
    .then((byId) => { _cache.set(key, { at: Date.now(), ttl: TTL_MS, byId }); return byId })
    .catch((err) => {
      console.warn(`Graded prices for ${key} unreadable, pricing graded cards raw:`, (err as Error).message)
      const byId = hit?.byId ?? new Map<string, GradedEntry>()
      _cache.set(key, { at: Date.now(), ttl: FAILED_TTL_MS, byId })
      return byId
    })
    .finally(() => _loading.delete(key))
  _loading.set(key, p)
  return p
}

/** The slab fields a price route receives with each card (PriceAutoUpdater sends them) */
export interface GradingInput {
  gradingCompany?: string
  grade?: string
  gradeTier?: 'pristine' | 'black'
}

/** Loads the graded prices only when one of these cards is graded (most requests have none) */
export async function gradedFor(key: CatalogKey, cards: GradingInput[]): Promise<Map<string, GradedEntry> | null> {
  return cards.some((c) => c.gradingCompany) ? loadGradedPrices(key) : null
}

/** The catalog card with its graded prices laid on, for catalogPrice() */
export function withGraded<T extends { id: string }>(cat: T, graded: Map<string, GradedEntry> | null): T & { graded?: Record<string, number> } {
  const p = graded?.get(cat.id)?.p
  return p ? { ...cat, graded: p } : cat
}
