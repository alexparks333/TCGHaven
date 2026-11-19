import { NextResponse } from 'next/server'
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'
import { gradedPrice, gradingOf, type CatalogPriceFields, type PrintingChoice } from '../pricing'
import { gradedPriceKey, gradedVariantKey } from '@/scripts/lib/pricecharting.mjs'
import { catalogKeyFor, type CatalogKey, type Condition, type Edition, type Finish, type Game, type Language } from '../types'

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
  v?: Record<string, { p: Record<string, number>; u?: string }>  // other versions ("[Foil]", "[1st Edition]" …)
}

export const gradedPricesEnabled = () => process.env.GRADED_PRICES === 'on'

// The data changes once a day, and a game's chunks are megabytes (Firestore bills data leaving
// Google per GB). So every TTL only the tiny meta doc is read; the chunks are downloaded again only
// when its asOf shows the daily job has written a new set — about once per server per day.
const TTL_MS = 30 * 60 * 1000
const FAILED_TTL_MS = 2 * 60 * 1000    // a failed read retries soon, pricing raw meanwhile

const _cache = new Map<CatalogKey, { at: number; ttl: number; asOf: number; byId: Map<string, GradedEntry> }>()
const _loading = new Map<CatalogKey, Promise<Map<string, GradedEntry>>>()

async function read(key: CatalogKey, have?: { asOf: number; byId: Map<string, GradedEntry> }): Promise<{ asOf: number; byId: Map<string, GradedEntry> }> {
  const meta = await getDoc(doc(db, 'graded_prices', key))
  const asOf = Number(meta.exists() ? meta.data().asOf?.toMillis?.() : 0) || 0
  if (have && asOf && have.asOf === asOf) return have // unchanged since the last download
  const byId = new Map<string, GradedEntry>()
  const count = Number(meta.exists() ? meta.data().chunkCount : 0) || 0
  if (!count) return { asOf, byId }
  // The latest write's chunks: slot "a" or "b" (a0, a1 …; pricecharting-sync.mjs writes the other
  // slot, then points the meta at it), or plain 0, 1 … from before slots. Only 0..count-1 count.
  const slot = meta.exists() ? String(meta.data().slot ?? '') : ''
  const chunksRef = collection(db, 'graded_prices', key, 'chunks')
  const snap = await getDocs(slot
    ? query(chunksRef, where(documentId(), '>=', `${slot}0`), where(documentId(), '<=', `${slot}~`))
    : chunksRef)
  for (const d of snap.docs) {
    const n = Number(slot ? d.id.slice(slot.length) : d.id)
    if (!Number.isInteger(n) || n >= count) continue
    const raw = d.data().cards as string | undefined
    if (!raw) continue
    for (const e of JSON.parse(raw) as GradedEntry[]) byId.set(e.id, e)
  }
  return { asOf, byId }
}

/** Catalog card id → its graded entry. Empty when switched off, not synced yet, or unreadable —
 *  graded cards are then priced raw, never wrongly. */
export async function loadGradedPrices(key: CatalogKey): Promise<Map<string, GradedEntry>> {
  if (!gradedPricesEnabled()) return new Map()
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.byId
  const inFlight = _loading.get(key)
  if (inFlight) return inFlight
  const p = read(key, hit)
    .then(({ asOf, byId }) => { _cache.set(key, { at: Date.now(), ttl: TTL_MS, asOf, byId }); return byId })
    .catch((err) => {
      console.warn(`Graded prices for ${key} unreadable, pricing graded cards raw:`, (err as Error).message)
      const byId = hit?.byId ?? new Map<string, GradedEntry>()
      _cache.set(key, { at: Date.now(), ttl: FAILED_TTL_MS, asOf: hit?.asOf ?? 0, byId })
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
  condition?: Condition   // a raw copy's condition (its price is discounted from Near Mint)
}

/** Which of these items are valued at PriceCharting's graded price today (the same test the price
 *  routes use) — their history is then the graded history (lib/api/priceHistory.ts). */
export async function gradedPricedKeys(
  items: (GradingInput & { key: string; game: Game; apiId: string; language?: Language; isFoil?: boolean; edition?: Edition; finish?: Finish })[],
): Promise<Set<string>> {
  const out = new Set<string>()
  const slabs = items.filter((i) => i.gradingCompany)
  if (!slabs.length || !gradedPricesEnabled()) return out
  const byCatalog = new Map<CatalogKey, typeof slabs>()
  for (const it of slabs) {
    const key = catalogKeyFor(it.game, it.language)
    byCatalog.set(key, [...(byCatalog.get(key) ?? []), it])
  }
  await Promise.all(Array.from(byCatalog.entries()).map(async ([key, list]) => {
    const graded = await loadGradedPrices(key)
    for (const it of list) {
      const e = graded.get(it.apiId)
      if (e && gradedPrice(it.game, { graded: e.p, gradedVariants: e.v }, { isFoil: it.isFoil, edition: it.edition, finish: it.finish, grading: gradingOf(it) }) > 0) out.add(it.key)
    }
  }))
  return out
}

/** Loads the graded prices only when one of these cards is graded (most requests have none) */
export async function gradedFor(key: CatalogKey, cards: GradingInput[]): Promise<Map<string, GradedEntry> | null> {
  return cards.some((c) => c.gradingCompany) ? loadGradedPrices(key) : null
}

/** Where a slab's price came from — the app shows it as "PSA 10 sales · PriceCharting ↗", the
 *  citation the licence asks for. key = the graded column (psa10, g9 …), url = the card's page. */
export interface GradedSource { key: string; url: string }

/** Records the source when this card was priced from PriceCharting (call after copyPrice) */
export function noteGradedSource(
  sources: Record<string, GradedSource>, cardId: string, game: Game,
  cat: CatalogPriceFields & { id: string }, choice: PrintingChoice, graded: Map<string, GradedEntry> | null,
): void {
  const entry = graded?.get(cat.id)
  const g = choice.grading
  if (!entry || !g?.company || gradedPrice(game, cat, choice) <= 0) return
  const key = gradedPriceKey(g.company, g.grade, g.tier)
  // The page of the version this copy is priced from ("[1st Edition]" …), else the card's own
  const variant = gradedVariantKey(choice, entry.v)
  if (key) sources[cardId] = { key, url: (variant && entry.v?.[variant]?.u) || entry.u }
}

/** A price route's answer. Callers that ask `withSources` (PriceAutoUpdater) get
 *  { prices, graded, gradedOn }; everyone else the plain { cardId: price } map, as always. */
export function priceReply(body: { withSources?: boolean } | null, prices: Record<string, number>, sources: Record<string, GradedSource>) {
  return NextResponse.json(body?.withSources ? { prices, graded: sources, gradedOn: gradedPricesEnabled() } : prices)
}

/** The catalog card with its graded prices laid on, for copyPrice() */
export function withGraded<T extends { id: string }>(cat: T, graded: Map<string, GradedEntry> | null): T & Pick<CatalogPriceFields, 'graded' | 'gradedVariants'> {
  const e = graded?.get(cat.id)
  return e ? { ...cat, graded: e.p, ...(e.v && { gradedVariants: e.v }) } : cat
}
