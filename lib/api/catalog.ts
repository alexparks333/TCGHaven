import {
  collection, doc, getDoc, getDocs, query, where, setDoc, writeBatch, Timestamp, type Firestore,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import type { CatalogKey } from '../types'
import { readCompressedSnapshot, writeCompressedSnapshot } from '@/scripts/lib/snapshot-codec.mjs'

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
  refreshing?: Promise<void>   // a background delta pull in flight
}

const _cache = new Map<CatalogKey, CacheEntry>()
// One cold load per game at a time: concurrent requests on a cold instance (Add Card fires the
// set list and a search together) share it instead of each downloading the whole snapshot.
const _loading = new Map<CatalogKey, Promise<CacheEntry>>()
// Bumped by invalidateCatalogCache() so a load that started before an invalidation can't put its
// now-outdated result back into the cache.
const _generation = new Map<CatalogKey, number>()

async function loadFromSnapshot(game: CatalogKey): Promise<CacheEntry> {
  const map = new Map<string, Record<string, unknown>>()
  // The compressed snapshot (scripts/lib/snapshot-codec.mjs) — ~1MB instead of ~9MB for Pokémon.
  // Then pull only the cards changed since it was taken, so a snapshot that's behind still
  // yields the current catalog.
  try {
    const compressed = await readCompressedSnapshot(db, game)
    if (compressed) {
      for (const c of compressed.cards) map.set(c.id, c)
      const syncedAt = new Date()
      try {
        for (const card of await pullDeltas(game, compressed.asOf)) map.set(card.id, card)
        return { cards: map, lastSyncAt: syncedAt }
      } catch (err) {
        // Keep the snapshot and fetch what changed since it on the next refresh — never throw the
        // whole catalog away over the small follow-up read
        console.warn(`Catalog deltas for ${game} failed, using the snapshot for now:`, (err as Error).message)
        return { cards: map, lastSyncAt: compressed.asOf }
      }
    }
  } catch (err) {
    console.warn(`Compressed snapshot for ${game} unreadable, using the original format:`, (err as Error).message)
    map.clear()
  }
  // The original format. A failed read throws (loadCatalog doesn't keep it, so the next request
  // tries again) — it used to be swallowed into an empty catalog that a server then kept for its
  // whole life: on 2026-11-13 some servers had no English Pokémon and the scanner missed clearly
  // read cards (Jigglypuff, Dark Vileplume) depending on which server answered
  const chunksSnap = await getDocs(collection(db, 'catalog_snapshot', game, 'chunks'))
  for (const chunkDoc of chunksSnap.docs) {
    const raw = chunkDoc.data().cards as string | undefined
    if (!raw) continue
    const cards = JSON.parse(raw) as Array<Record<string, unknown> & { id: string }>
    for (const c of cards) map.set(c.id, c)
  }
  return { cards: map, lastSyncAt: new Date() }
}

async function pullDeltas(game: CatalogKey, since: Date): Promise<Array<Record<string, unknown> & { id: string }>> {
  const sinceTs = Timestamp.fromDate(since)
  const q = query(collection(db, 'catalog', game, 'cards'), where('updatedAt', '>', sinceTs))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Loads the full catalog (including hidden cards) for one game, from the in-memory cache.
 *
 * Cold: one shared snapshot load. Warm: answered from memory immediately — when the cache is
 * more than STALE_MS old, the changed cards are pulled in the background (stale-while-
 * revalidate) instead of making this request wait on a Firestore query.
 */
export async function loadCatalog<T>(game: CatalogKey): Promise<T[]> {
  let entry = _cache.get(game)

  if (!entry) {
    let loading = _loading.get(game)
    if (!loading) {
      const gen = _generation.get(game) ?? 0
      loading = loadFromSnapshot(game).then((loaded) => {
        // An empty catalog is never kept (a game with no cards yet just loads again next time)
        if ((_generation.get(game) ?? 0) === gen && loaded.cards.size > 0) _cache.set(game, loaded)
        return loaded
      }, (err) => {
        // Not kept either: this request goes without, the next one loads again
        console.warn(`Catalog load for ${game} failed:`, (err as Error).message)
        return { cards: new Map(), lastSyncAt: new Date() } as CacheEntry
      }).finally(() => _loading.delete(game))
      _loading.set(game, loading)
    }
    entry = await loading
    return Array.from(entry.cards.values()) as T[]
  }

  if (!entry.refreshing && Date.now() - entry.lastSyncAt.getTime() > STALE_MS) {
    const target = entry
    const startedAt = new Date()
    target.refreshing = pullDeltas(game, target.lastSyncAt)
      .then((deltas) => {
        for (const card of deltas) target.cards.set(card.id, card)
        target.lastSyncAt = startedAt
      })
      .catch((err) => console.warn(`Catalog refresh for ${game} failed:`, (err as Error).message))
      .finally(() => { target.refreshing = undefined })
  }

  return Array.from(entry.cards.values()) as T[]
}

/** Clears the in-memory cache for a game (or every game) — forces the next read to refetch. */
export function invalidateCatalogCache(game?: CatalogKey) {
  const games = game ? [game] : Array.from(new Set(Array.from(_cache.keys()).concat(Array.from(_loading.keys()))))
  for (const g of games) {
    _cache.delete(g)
    _loading.delete(g)
    _generation.set(g, (_generation.get(g) ?? 0) + 1)
  }
}

/**
 * Same as loadCatalog(), but filters out cards hidden via the Admin Catalog page (`hidden:
 * true` on the card's own Firestore document). This is what every *real* consumer (search,
 * Cardex, Pack Analysis) should read through — hidden cards stay in Firestore (so the Admin
 * browse table can keep showing and un-hiding them) and are only ever filtered out here.
 */
export async function loadVisibleCatalog<T extends { hidden?: boolean }>(game: CatalogKey): Promise<T[]> {
  const all = await loadCatalog<T>(game)
  return all.filter((c) => !c.hidden)
}

/**
 * Rewrites catalog_snapshot/{game}/chunks/* from the current catalog/{game}/cards/* state.
 * Called after any write (Admin add/hide/edit/upload, or a bulk download sync) so a freshly
 * cold app instance picks up the change without waiting for the next full re-download.
 * Requires the caller to already be signed in as staff (Firestore rules enforce this) — the staff
 * portal passes its own Firestore instance (lib/firebase/staff.ts's staffDb) so the writes run as
 * the staff member's session rather than the collector app's.
 */
export async function regenerateSnapshot(game: CatalogKey, firestore: Firestore = db): Promise<void> {
  const readAt = new Date()
  const cardsSnap = await getDocs(collection(firestore, 'catalog', game, 'cards'))
  const cards = cardsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))

  const chunkCount = Math.max(1, Math.ceil(cards.length / CHUNK_SIZE))
  for (let i = 0; i < chunkCount; i++) {
    const slice = cards.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    await setDoc(doc(firestore, 'catalog_snapshot', game, 'chunks', String(i)), { cards: JSON.stringify(slice) })
  }
  // Remove any leftover chunk docs from a previous, larger snapshot (e.g. after hiding cards
  // shrinks the count enough to need fewer chunks than last time).
  const existingChunks = await getDocs(collection(firestore, 'catalog_snapshot', game, 'chunks'))
  const batch = writeBatch(firestore)
  let hasDeletes = false
  for (const chunkDoc of existingChunks.docs) {
    if (parseInt(chunkDoc.id, 10) >= chunkCount) { batch.delete(chunkDoc.ref); hasDeletes = true }
  }
  if (hasDeletes) await batch.commit()
  // The compressed copy cold server instances actually load (the plain chunks above stay for any
  // older deployment) — see scripts/lib/snapshot-codec.mjs.
  await writeCompressedSnapshot(firestore, game, cards, readAt)

  invalidateCatalogCache(game) // this instance's own cache should reflect the change immediately too

  // regenerateSnapshot() is only ever called from Admin Catalog's client-side code, i.e. a
  // separate browser copy of this module from the one the Next.js server process reads through
  // for every real request. The invalidateCatalogCache() call above only clears that unused
  // browser-side copy, so tell the actual server process to drop its cache too.
  if (typeof window !== 'undefined') {
    const { adminFetch } = await import('@/lib/firebase/authFetch')
    await adminFetch('/api/admin/catalog/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game }),
    }).catch(() => {})
  }
}

/**
 * After an Admin Catalog edit, hide or add — a write that stamps `updatedAt` — make every server
 * see it, WITHOUT rebuilding the snapshot: regenerateSnapshot() reads the whole collection
 * (~100k docs for MTG, ~20k Pokémon) on every click. Cold loads read the snapshot and then pull
 * `updatedAt > asOf`, warm caches pull the same deltas within STALE_MS, and this server's cache
 * is dropped now. The next sync rewrites the snapshot. Deletes still need regenerateSnapshot()
 * (a deleted doc has no `updatedAt` to pull, so an old snapshot would bring it back).
 */
export async function refreshCatalogCaches(game: CatalogKey): Promise<void> {
  invalidateCatalogCache(game)
  if (typeof window !== 'undefined') {
    const { adminFetch } = await import('@/lib/firebase/authFetch')
    await adminFetch('/api/admin/catalog/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game }),
    }).catch(() => {})
  }
}

/** Reads catalog_meta/{game}.lastBulkSyncAt, or null if a bulk sync has never run. */
export async function getLastBulkSyncAt(game: CatalogKey): Promise<Date | null> {
  const snap = await getDoc(doc(db, 'catalog_meta', game))
  const ts = snap.data()?.lastBulkSyncAt as Timestamp | undefined
  return ts ? ts.toDate() : null
}

// Rarity sort weight shared by Cardex display and the Admin Catalog listing —
// keep both in sync with a single comparator rather than duplicating it.
export const CARDEX_RARITY_ORDER: Record<string, number> = {
  Common: 0, Uncommon: 1, Rare: 2, Super_rare: 3, Legendary: 4, Enchanted: 5, Epic: 6, Iconic: 7, Promo: 8,
  // Pokemon — all 44 rarity values the official pokemontcg.io API has ever returned, verified
  // against api.pokemontcg.io/v2/rarities and the full 176-set GitHub dataset (1999–2026) during
  // research for the Cardex's per-game rarity toggle. Ordered by first real-world appearance
  // (an objective, reproducible criterion — there's no single universal "value" ranking across
  // 25+ years of wildly different rarity systems) rather than a subjective rarity/value guess.
  // Common/Uncommon/Rare/Promo above are already shared with Lorcana's own same-named tiers.
  // A rarity not in this map (a new one from a future set) still shows up — sortCatalogCards'
  // `?? 50` fallback and the Cardex's dynamic-toggle-list computation both treat "unknown" as
  // "exists, sorts last" rather than silently disappearing — see quirk about the Riftbound
  // rarity-filter leak this same design fixed.
  'Rare Holo': 10, 'Rare Secret': 11, 'Rare Shining': 12, 'Rare Holo EX': 13, 'Rare Holo Star': 14,
  'Rare Holo LV.X': 15, LEGEND: 16, 'Rare Prime': 17, 'Rare Ultra': 18, 'Rare ACE': 19,
  'Rare BREAK': 20, 'Rare Holo GX': 21, 'Rare Rainbow': 22, 'Rare Prism Star': 23, 'Rare Shiny': 24,
  'Rare Shiny GX': 25, 'Rare Holo V': 26, 'Rare Holo VMAX': 27, 'Amazing Rare': 28, 'Classic Collection': 29,
  'Rare Holo VSTAR': 30, 'Trainer Gallery Rare Holo': 31, 'Radiant Rare': 32, 'Double Rare': 33, 'Hyper Rare': 34,
  'Illustration Rare': 35, 'Special Illustration Rare': 36, 'Ultra Rare': 37, 'Shiny Rare': 38, 'Shiny Ultra Rare': 39,
  'ACE SPEC Rare': 40, 'Black White Rare': 41, 'Mega Hyper Rare': 42, MEGA_ATTACK_RARE: 43, 'Futuristic Rare': 44,
  'Holo Rare V': 45, 'Holo Rare VMAX': 46, 'Holo Rare VSTAR': 47, 'Pikachu Rare': 48, 'Rare Holo ex': 49,
  // Not one of the 44 pokemontcg.io API values above — an app-local correction for a real
  // upstream data gap. The 30th Celebration set's 3 "RGB Mew" cards (me55-R/G/B, outside the
  // set's official /103 numbering) are unofficial, unacknowledged secret pulls trading for
  // $1,800-$3,700+ that the official API defaults to "Common" (it has no real classification for
  // them at all yet — Pokémon hasn't formally acknowledged these cards exist). Corrected via
  // Admin Catalog edit (admin-edit-wins-over-resync protection keeps a future Pokémon sync from
  // reverting it back to "Common") rather than in the sync script itself, since this is a
  // one-off exception for 3 specific cards, not a systematic mapping rule. Sorts above every
  // real API-provided tier, matching its real-world status as the set's actual chase cards.
  'Secret Anniversary Rare': 50,
  // Riftbound: 'Alt Art' (same-number foil-only print) and 'Overnumbered' (collector number
  // exceeds the set's card count) — both formerly flattened to a single 'Showcase' rarity
  // value; that key is kept as a fallback for any doc a resync hasn't touched yet.
  'Alt Art': 90, Overnumbered: 90, Showcase: 90, Star: 91,
  // Riftbound promos built straight from TCGplayer for products Riot's gallery never lists
  // (Worlds bundles etc. — catalog-sync.mjs's fetchTcgplayerOnlyRiftboundSets()).
  'Event Promo': 92, Metal: 93,
  // One Piece: L(eader), C(ommon), UC(ommon), R(are), S(uper) R(are), SEC(ret rare) — "SP CARD"
  // is a further-out special/promo print tier, sorted last like Riftbound's Star. TR (Treasure
  // Rare — a genuine premium chase tier, ~1 per booster box, introduced OP-06 onward, English/
  // Chinese/French exclusive) sits between SR and SEC per real-world pull-rate research, verified
  // against live catalog data rather than just CLAUDE.md's older documented list, which predates
  // it. P/PR are both promotional-card rarity codes (apitcg and tcgcsv-synthesized promo groups
  // tag them differently — see catalog-sync.mjs's downloadOnePiece() Phase 3 — not a meaningful
  // collector-value distinction), sorted alongside the other promo/special tiers.
  L: 0, C: 1, UC: 2, R: 3, SR: 4, TR: 5, SEC: 90, 'SP CARD': 91, P: 92, PR: 93,
  // MTG: Scryfall's `rarity` field is always lowercase, distinct keys from every other game's
  // capitalized ones (no collision risk). `bonus` (Power 9 reprints, e.g. Vintage Masters) is a
  // real Scryfall value but will never actually appear in this app's synced catalog — those are
  // MTGO-only digital cards, already excluded by downloadMTG()'s `games.includes('paper')` filter
  // (verified live against api.scryfall.com — only 9 `bonus` cards exist and all are digital-only
  // as of this writing) — kept here anyway in case Scryfall ever prints a paper one.
  common: 0, uncommon: 1, rare: 2, mythic: 3, special: 4, bonus: 5,
  // Yu-Gi-Oh! (from TCGplayer's rarities, 2026-11-10) — roughly by how rare each is to pull.
  // Common / Rare are shared with the entries above.
  // ('Ultra Rare' is shared with Pokémon's entry above)
  'Super Rare': 120, 'Secret Rare': 122, 'Ultimate Rare': 123, 'Ghost Rare': 124,
  'Gold Rare': 125, 'Premium Gold Rare': 126, 'Gold Secret Rare': 127, 'Ghost/Gold Rare': 128, 'Platinum Rare': 129,
  'Platinum Secret Rare': 130, 'Prismatic Secret Rare': 131, "Prismatic Collector's Rare": 132, 'Prismatic Ultimate Rare': 133,
  "Collector's Rare": 134, 'Starlight Rare': 135, 'Quarter Century Secret Rare': 136, 'Starfoil Rare': 137,
  'Shatterfoil Rare': 138, 'Mosaic Rare': 139, 'Parallel Rare': 140, 'Duel Terminal Normal Parallel Rare': 141,
  'Duel Terminal Rare Parallel Rare': 142, 'Duel Terminal Super Parallel Rare': 143, 'Duel Terminal Ultra Parallel Rare': 144,
  'Duel Terminal Technology Common': 145, 'Duel Terminal Technology Ultra Rare': 146, 'Emblazoned Ultra Rare': 147,
  'Emblazoned Secret Rare': 148, 'Ultra Pharaoh’s Rare': 149, 'Secret Pharaoh’s Rare': 150, 'Grand Master Rare': 151,
  '10000 Secret Rare': 152,
  // The TCGplayer-sourced games (2026-11-10), roughly by how rare each is to pull. Names shared
  // with the games above (Common, Rare, Legendary, Promo, Super Rare, Secret Rare, C/R/SR…) keep
  // their place there.
  // Star Wars: Unlimited
  Special: 160,
  // Gundam: a "+" is that rarity's parallel
  'C+': 170, 'C++': 171, 'U+': 172, 'R+': 173, 'Legend Rare': 174, 'LR+': 175, 'LR++': 176,
  // Flesh and Blood
  Token: 180, Basic: 181, Majestic: 182, Marvel: 183, Fabled: 184, Gold: 185, 'Pirate Booty': 186,
  // Digimon
  'Special Rare': 190,
  // Palworld
  U: 200, RR: 201, OSR: 202, TSR: 203, SP: 204, TSP: 205, SSP: 206, SSS: 207, TD: 208, TDR: 209,
  // Cyberpunk (C / UC / R shared with One Piece above): New Rare, Epic, Legend, Secret and their
  // "I" (alternate-art) versions
  NR: 210, E: 211, IO: 212, IL: 213, S: 214, IS: 215,
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
    // Codes like Yu-Gi-Oh!'s "MAMS-EN001" (and Riftbound's R-format): in number order, then by rarity
    if (aIsR && bIsR) return a.number.localeCompare(b.number, undefined, { numeric: true })
      || (CARDEX_RARITY_ORDER[a.rarity ?? ''] ?? 50) - (CARDEX_RARITY_ORDER[b.rarity ?? ''] ?? 50)
    return aIsR ? 1 : -1 // R-format (Rune) cards sort after numeric cards
  })
}

/** Normalise a collector number for comparison — strips leading zeros so "088" === "88". */
export function normNum(n: string) { return String(parseInt(n, 10)) }
