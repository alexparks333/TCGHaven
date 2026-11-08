/**
 * Shared catalog-scraping + Firestore-sync core, extracted from what used to be the whole of
 * scripts/download-card-catalog.mjs so both the CLI script (`npm run download-cards`) AND the
 * Next.js sync API routes (app/api/sync/[game]/route.ts — the Admin Catalog "Sync Card Data"
 * feature) can call the exact same per-game logic. Deliberately plain ESM (no TypeScript) so a
 * bare `node` process can still run it directly (no build step) — this is also why it does its
 * own Firebase init/sign-in rather than importing lib/firebase/config.ts, mirroring the same
 * "duplicated across the runtime boundary on purpose" pattern already used by
 * app/api/admin/catalog/lookup/route.ts for its CSV parser. When called from a Next.js route in
 * the same process, `initializeApp()`'s getApps().length guard means this reuses the app (and
 * therefore the same signed-in auth state) the route's own lib/firebase/config.ts already set up
 * — see lib/firebase/adminAuth.ts's comment for the same reasoning from the other side.
 *
 * Sync behavior: never deletes a card. New cards are created; existing cards are only
 * overwritten if something actually changed AND no admin edit has happened to them since the
 * last bulk sync (an edit made from /admin always wins over a fresh re-scrape). `hidden` is
 * never touched by this module — only the Admin Catalog page's Hide/Unhide toggle changes it.
 */

import zlib from 'node:zlib'
import readline from 'node:readline'
import { Readable } from 'node:stream'
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, serverTimestamp, Bytes, runTransaction,
} from 'firebase/firestore'
import {
  PRICE_HISTORY_COLLECTION, DAYS_COLLECTION, FIRSTS_COLLECTION, buildDailyEntries, buildDayPrices,
  dayDocId, encodePriceMap, decodePriceChunks, mergeFirsts,
} from './price-history.mjs'
import { fillPokemonPriceGaps } from './price-fallback.mjs'
import { buildPokemonCatalog, productsFromRows, resolveIdCollisions, collidingIds } from './pokemon-tcgplayer.mjs'
import { buildOnePieceCatalog, productsFromRows as opProductsFromRows } from './onepiece-tcgplayer.mjs'
import { writeCompressedSnapshot } from './snapshot-codec.mjs'
import { JP_CATEGORY, JP_CATALOG, isSingleRow, jpCard, jpSetMeta, placeholderDates } from './pokemon-jp.mjs'

// Every upstream read here must be live. Run inside a Next.js route (the Sync buttons, the cron),
// a plain fetch() can be answered from Next's data cache — kept for a year — so a sync could see
// last year's set lists and prices. Plain Node (npm run download-cards) ignores the option.
const fetch = (url, options = {}) => globalThis.fetch(url, { cache: 'no-store', ...options })

const firebaseApp = getApps().length === 0
  ? initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    })
  : getApps()[0]
const auth = getAuth(firebaseApp)
const db = getFirestore(firebaseApp)

export async function ensureSignedIn() {
  if (auth.currentUser) return
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set (in .env.local locally, or as Vercel project ' +
      'env vars in production) to sync the catalog to Firestore (this is what lets this run ' +
      'under the same rules as a real admin browser session).'
    )
  }
  await signInWithEmailAndPassword(auth, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
}

const SNAPSHOT_CHUNK_SIZE = 1500 // cards per catalog_snapshot chunk doc — see lib/api/catalog.ts

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Rewrites catalog_snapshot/{game}/chunks/* from a final in-memory card list. */
async function writeSnapshot(game, finalCards) {
  const chunkCount = Math.max(1, Math.ceil(finalCards.length / SNAPSHOT_CHUNK_SIZE))
  for (let i = 0; i < chunkCount; i++) {
    const slice = finalCards.slice(i * SNAPSHOT_CHUNK_SIZE, (i + 1) * SNAPSHOT_CHUNK_SIZE)
    await setDoc(doc(db, 'catalog_snapshot', game, 'chunks', String(i)), { cards: JSON.stringify(slice) })
  }
  // Clean up leftover higher-numbered chunks from a previous, larger snapshot.
  const existingChunks = await getDocs(collection(db, 'catalog_snapshot', game, 'chunks'))
  const toDelete = existingChunks.docs.filter((d) => parseInt(d.id, 10) >= chunkCount)
  if (toDelete.length > 0) {
    const batch = writeBatch(db)
    for (const d of toDelete) batch.delete(d.ref)
    await batch.commit()
  }
}

/**
 * Syncs a freshly-scraped card array into Firestore for one game. Returns the distinct set
 * names present in the final (post-sync) catalog plus the final card list itself — callers
 * that need to backfill registry fields (e.g. a new Riftbound set's cardCount/setCode) can use
 * the card list directly instead of issuing a second Firestore read.
 */
// HEAD-checks a list of {id, imageUrl} pairs and returns { broken, suspicious }. A broken
// imageUrl looks completely valid as a string (it's a real, well-formed CDN URL) but 403s/404s
// because the upstream source hasn't uploaded that specific product photo yet. This is the exact
// failure mode that first surfaced the need for this check: Vendetta's Alt Rune cards synced with
// a real-looking tcgplayer-cdn.tcgplayer.com URL that 403'd (an XML "access denied" body, not an
// image) until TCGPlayer got around to uploading the photo — nothing in the synced data itself
// looks wrong, so only an actual HTTP check catches it. HEAD (not GET) keeps this cheap — no image
// bytes downloaded, just a status + content-type check.
//
// Shipped a real bug the first time this ran against MTG's ~100k-card catalog: every single
// request failed, reporting the entire catalog as broken (confirmed false: the sample included
// cards like Forest/Swamp/Birds of Paradise, whose images definitely work) — which then blew past
// Firestore's 1MiB document size limit trying to store it, crashing the run entirely. Originally
// misdiagnosed as CDN rate-limiting under concurrency and "fixed" with a retry-after-delay — that
// fix didn't actually work (a second, unchanged full run still failed 100370/100370, retries
// included) because the real cause was different: Node's built-in `fetch()` sends no `User-Agent`
// header by default, and cards.scryfall.io's edge (unlike every other game's image CDN this check
// already worked against) 400s any request with no User-Agent at all — confirmed by reproducing
// outside this script: a plain `curl` HEAD succeeds every time (curl always sends its own UA), a
// bare Node `fetch()` HEAD 400s every time even at concurrency 1, and adding literally any
// non-empty `User-Agent` string (no `Accept` override needed) makes it 200 every time. This is a
// separate requirement from `SCRYFALL_HEADERS` below (that one's for api.scryfall.com's JSON API,
// `Accept: application/json` included) — an image HEAD check has no JSON body to accept, just
// needs a UA. The retry-after-delay and `suspicious`-rate guard below are still worth keeping as a
// backstop against a genuine transient outage/rate-limit on any CDN, just weren't what actually
// caused this one — callers must still check `suspicious` and skip trusting/persisting the result
// if it's true, exactly as before.
const IMAGE_CHECK_HEADERS = { 'User-Agent': 'TCGHaven/1.0' }

export async function findBrokenImageUrls(candidates, { concurrency = 20, timeoutMs = 6000, retryDelayMs = 500, suspiciousRate = 0.25 } = {}) {
  const broken = []
  async function checkOnce(imageUrl) {
    const res = await fetch(imageUrl, { method: 'HEAD', headers: IMAGE_CHECK_HEADERS, signal: AbortSignal.timeout(timeoutMs) })
    const contentType = res.headers.get('content-type') || ''
    if (!res.ok || !contentType.startsWith('image/')) throw new Error(`bad response: ${res.status} ${contentType}`)
  }
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency)
    await Promise.all(batch.map(async ({ id, imageUrl }) => {
      if (!imageUrl) { broken.push(id); return }
      try {
        await checkOnce(imageUrl)
      } catch {
        await new Promise((r) => setTimeout(r, retryDelayMs))
        try {
          await checkOnce(imageUrl)
        } catch {
          broken.push(id) // failed twice — genuinely broken, or a sustained outage either way
        }
      }
    }))
  }
  const suspicious = candidates.length >= 20 && broken.length / candidates.length > suspiciousRate
  return { broken, suspicious }
}

// `fieldDefaults`: fields only some fresh cards carry (e.g. Pokémon's priceSource, set only on
// backup-priced cards). A fresh card without one is compared as having the default, so a field
// set by an earlier sync gets reset when it no longer applies — while cards that never had it
// (undefined in Firestore) aren't rewritten just to add the default.
// JSON with object keys sorted — Firestore hands map fields back in its own key order, so a plain
// JSON.stringify comparison of a map (variantPrices) would see a "change" on every sync and
// rewrite thousands of unchanged cards each run.
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object' && !(typeof v.toMillis === 'function')) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

async function syncToFirestore(game, freshCards, { hideIds = [], unhideIds = [], fieldDefaults = {}, checkImages = true } = {}) {
  const metaRef = doc(db, 'catalog_meta', game)
  const metaSnap = await getDoc(metaRef)
  const meta = metaSnap.exists() ? metaSnap.data() : {}
  const lastBulkSyncAt = meta.lastBulkSyncAt ?? null
  // Cards already known to have a broken image as of the last sync — re-checked every run (see
  // below) regardless of whether this run's scrape touched them, so a fix that shows up purely
  // upstream (TCGPlayer finally uploads the photo, nothing in *our* data changes) still gets
  // noticed rather than staying flagged forever.
  const previouslyBrokenImageIds = Array.isArray(meta.brokenImageIds) ? meta.brokenImageIds : []

  const existingSnap = await getDocs(collection(db, 'catalog', game, 'cards'))
  const existingMap = new Map(existingSnap.docs.map((d) => [d.id, d.data()]))
  // Pre-sync distinct set names — lets callers with no registry to diff against (Pokemon, MTG;
  // Lorcana/Riftbound/One Piece already do their own registry-based new-set diffing) still know
  // "N sets are new to the catalog this run" for free, no extra Firestore read needed.
  const existingSetNames = new Set([...existingMap.values()].map((c) => c.setName).filter(Boolean))

  const finalMap = new Map(existingMap) // start from current Firestore state — never drop a card
  const writes = []
  const newCardIds = []

  for (const card of freshCards) {
    const existing = existingMap.get(card.id)

    if (!existing) {
      finalMap.set(card.id, { ...card, hidden: false })
      writes.push({ id: card.id, data: { ...card, hidden: false, updatedAt: serverTimestamp() }, create: true })
      newCardIds.push(card.id)
      continue
    }

    const editedSinceLastSync =
      lastBulkSyncAt && existing.updatedAt && existing.updatedAt.toMillis() > lastBulkSyncAt.toMillis()
    if (editedSinceLastSync) continue // an admin correction happened since — never clobber it

    const changed = {}
    for (const key of Object.keys(card)) {
      if (stableStringify(existing[key]) !== stableStringify(card[key])) changed[key] = card[key]
    }
    for (const [key, def] of Object.entries(fieldDefaults)) {
      if (key in card || existing[key] === undefined || existing[key] === def) continue
      changed[key] = def
    }
    if (Object.keys(changed).length === 0) continue // nothing real changed — no write, no timestamp churn

    finalMap.set(card.id, { ...existing, ...changed })
    writes.push({ id: card.id, data: { ...changed, updatedAt: serverTimestamp() } })
  }

  // Explicit hide list — currently only Riftbound's supersededStubIds (a TCGCSV-synthesized
  // Signature stub the gallery has since provided a real, differently-id'd card for — see
  // downloadRiftbound()'s comment). `hidden` is otherwise never touched by this module (only
  // Admin Catalog's Hide/Unhide toggle changes it) — this is a narrow, deliberate exception for
  // a specific, provable "this exact card is a stale duplicate of a real one" condition, not a
  // general "sync can hide things" policy. Still respects the same admin-edit-wins protection as
  // everything else, so an admin who's already dealt with one of these manually isn't overridden.
  for (const id of hideIds) {
    const existing = existingMap.get(id)
    if (!existing || existing.hidden) continue
    const editedSinceLastSync =
      lastBulkSyncAt && existing.updatedAt && existing.updatedAt.toMillis() > lastBulkSyncAt.toMillis()
    if (editedSinceLastSync) continue
    finalMap.set(id, { ...existing, hidden: true })
    writes.push({ id, data: { hidden: true, updatedAt: serverTimestamp() } })
  }

  // Cards staff hid themselves by choosing "Ignore" on Needs Review — back now that a sync has
  // offered them again (see discoverRiftboundProducts). Their hide was a staff edit, so the
  // admin-edit-wins check above would otherwise keep them hidden one extra sync.
  for (const id of unhideIds) {
    const existing = existingMap.get(id)
    if (!existing?.hidden) continue
    finalMap.set(id, { ...finalMap.get(id), hidden: false })
    writes.push({ id, data: { hidden: false, updatedAt: serverTimestamp() } })
  }

  if (writes.length > 0) {
    for (const batchOps of chunk(writes, 450)) { // headroom under Firestore's 500-op batch cap
      const batch = writeBatch(db)
      // Existing docs get update(), not set({ merge: true }): merge would deep-merge map fields
      // (variantPrices), so a printing TCGplayer stopped pricing would linger in Firestore while
      // the snapshot (built from finalMap) dropped it. update() replaces each written field whole.
      for (const { id, data, create } of batchOps) {
        const ref = doc(db, 'catalog', game, 'cards', id)
        if (create) batch.set(ref, data, { merge: true })
        else batch.update(ref, data)
      }
      await batch.commit()
    }
    console.log(`   Firestore sync (${game}): ${writes.length} card(s) created/updated`)
  } else {
    console.log(`   Firestore sync (${game}): no changes`)
  }

  const finalCards = [...finalMap.values()]

  // Image health: re-check every previously-flagged card (small, bounded list) plus every card
  // that's brand-new this run (also bounded — never the whole catalog) rather than re-validating
  // every image on every sync, which would be thousands of needless HEAD requests for images that
  // already work fine and essentially never stop working once they do.
  const toCheckIds = new Set([...previouslyBrokenImageIds.filter((id) => finalMap.has(id)), ...newCardIds])
  const checkCandidates = [...toCheckIds].map((id) => ({ id, imageUrl: finalMap.get(id)?.imageUrl }))
  let brokenImageIds = previouslyBrokenImageIds.filter((id) => finalMap.has(id)) // default: unchanged
  let newlyBrokenImages = []
  let newlyFixedImages = []
  if (checkImages && checkCandidates.length > 0) {
    const { broken, suspicious } = await findBrokenImageUrls(checkCandidates)
    if (suspicious) {
      // Don't trust this run's result — an implausibly high failure rate means something
      // upstream/systemic happened (rate limiting, an outage), not that this many cards are
      // genuinely broken. Keep whatever was already recorded; next sync gets another chance.
      console.warn(`   ⚠️  Image check (${game}): ${broken.length}/${checkCandidates.length} failed — suspiciously high, likely a rate limit or outage, not trusting this result`)
    } else {
      const previouslyBrokenSet = new Set(previouslyBrokenImageIds)
      const brokenSet = new Set(broken)
      newlyBrokenImages = broken.filter((id) => !previouslyBrokenSet.has(id))
      newlyFixedImages = previouslyBrokenImageIds.filter((id) => finalMap.has(id) && !brokenSet.has(id))
      brokenImageIds = broken
      console.log(`   Image check (${game}): ${checkCandidates.length} checked, ${broken.length} broken (${newlyBrokenImages.length} new, ${newlyFixedImages.length} fixed)`)
    }
  }
  // Hard backstop regardless of the above — Firestore's 1MiB/doc limit means an unbounded array
  // here is a real crash risk (this is exactly how the MTG bug above wrote invalid data in the
  // first place), not just a cosmetic concern. 3000 ids is comfortably under that ceiling even
  // for long ids, and losing visibility into anything past the first 3000 broken images in one
  // game is an acceptable tradeoff for "never crash the sync."
  const MAX_TRACKED_BROKEN = 3000
  if (brokenImageIds.length > MAX_TRACKED_BROKEN) {
    console.warn(`   ⚠️  Image check (${game}): ${brokenImageIds.length} broken exceeds the ${MAX_TRACKED_BROKEN} tracking cap — truncating`)
    brokenImageIds = brokenImageIds.slice(0, MAX_TRACKED_BROKEN)
  }

  const newSetNames = [...new Set(finalCards.map((c) => c.setName).filter(Boolean))].filter((n) => !existingSetNames.has(n))

  await writeSnapshot(game, finalCards)
  // The compressed copy the app's cold loads read (snapshot-codec.mjs). As of now: every write
  // above is committed, and anything changed after this the app pulls as a delta.
  await writeCompressedSnapshot(db, game, finalCards, new Date())
  await setDoc(metaRef, { lastBulkSyncAt: serverTimestamp(), brokenImageIds }, { merge: true })
  // The same moment on the small sync_status doc: what every open app checks every 15 minutes
  // (lib/api/priceStatus.ts) and what the server's history cache keys off (lib/api/priceHistory.ts)
  // — catalog_meta also carries the set list and broken-image ids (~180KB for Pokémon).
  await setDoc(doc(db, 'sync_status', game), { lastGoodAt: serverTimestamp() }, { merge: true })
  // Today's prices into the shared price history (see price-history.mjs). Non-fatal: a failure
  // here (e.g. firestore.rules not yet deployed for price_history) must never fail the sync
  // itself — the catalog is already fully updated by this point.
  try {
    const written = await writeDailyPriceHistory(game, finalCards)
    console.log(`   Price history (${game}): ${written} set-month doc(s) updated`)
  } catch (err) {
    console.warn(`   ⚠️  Price history (${game}) not written: ${err.message}`)
  }
  try {
    const { chunks, newFirsts } = await writeDailyPriceSnapshot(game, finalCards)
    console.log(`   Daily prices (${game}): ${chunks} chunk(s)${newFirsts ? ', first prices updated' : ''}`)
  } catch (err) {
    console.warn(`   ⚠️  Daily prices (${game}) not written: ${err.message}`)
  }

  return {
    setNames: [...new Set(finalCards.map((c) => c.setName).filter(Boolean))],
    cards: finalCards,
    newSetNames,
    totalBrokenImages: brokenImageIds.length,
    newlyBrokenImages: newlyBrokenImages.length,
    newlyFixedImages: newlyFixedImages.length,
  }
}

// Writes this sync's prices into price_history/{game}/months/* — one merged field write per set
// (days.{DD}), batched. Returns how many set-month docs were written.
async function writeDailyPriceHistory(game, cards) {
  const entries = buildDailyEntries(cards)
  const docs = [...entries.entries()]
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db)
    for (const [docId, { setKey, month, day, value }] of docs.slice(i, i + 400)) {
      batch.set(
        doc(db, PRICE_HISTORY_COLLECTION, game, 'months', docId),
        { game, setKey, month, days: { [day]: value } },
        { merge: true },
      )
    }
    await batch.commit()
  }
  return docs.length
}

// Today's whole-game price file and the first-price map (see price-history.mjs "Daily closes").
// Exported for scripts/backfill-daily-prices.mjs.
export async function writeDailyPriceSnapshot(game, cards, when = new Date()) {
  const { day, t, prices } = buildDayPrices(cards, when)
  const chunks = await writePriceChunks(game, DAYS_COLLECTION, (n) => dayDocId(day, n), { day, t }, prices)
  const existing = await readPriceChunks(game, FIRSTS_COLLECTION)
  const firsts = existing?.prices ?? {}
  const newFirsts = mergeFirsts(firsts, prices)
  if (newFirsts) await writePriceChunks(game, FIRSTS_COLLECTION, String, { t }, firsts)
  return { chunks, newFirsts }
}

/** Writes a price map as chunk docs in one atomic batch, clearing up to 2 leftover chunks. */
export async function writePriceChunks(game, collectionName, idOf, fields, prices) {
  const chunks = await encodePriceMap(prices)
  const batch = writeBatch(db)
  chunks.forEach((gz, n) => {
    batch.set(doc(db, PRICE_HISTORY_COLLECTION, game, collectionName, idOf(n)), {
      ...fields, chunk: n, of: chunks.length, gz: Bytes.fromUint8Array(gz),
    })
  })
  for (let n = chunks.length; n < chunks.length + 2; n++) batch.delete(doc(db, PRICE_HISTORY_COLLECTION, game, collectionName, idOf(n)))
  await batch.commit()
  return chunks.length
}

/** Reads a whole chunked price map collection (firsts), or null if there's no complete one. */
export async function readPriceChunks(game, collectionName) {
  const snap = await getDocs(collection(db, PRICE_HISTORY_COLLECTION, game, collectionName))
  return decodePriceChunks(snap.docs.map((d) => d.data()))
}

// The set registry (formerly data/set-registry.json, now Firestore's registry/main doc — see
// lib/api/registry.ts for the cached TS-side reader/writer real routes should prefer). This
// module only reads it for Riftbound's tcgcsvGroupId bootstrap-merge below, always live
// (uncached) since a route may have just updated it earlier in the same request.
export async function loadRegistry() {
  try {
    const snap = await getDoc(doc(db, 'registry', 'main'))
    return snap.exists() ? snap.data() : null
  } catch {
    return null
  }
}

// Games whose Needs Review lives in its own `registry/{doc}` instead of `registry/main.{game}`:
// Pokémon has thousands of TCGplayer promo products, and registry/main is one Firestore document
// (1 MiB cap — it was 184 KB with Lorcana's 356 + Riftbound's 172 placements at ~311 bytes each).
// Same shape as a registry side ({ placements, completedReviews }) plus `baseline`: the promo
// products the first run found, recorded as accepted by id only (6.5k placements would be ~2 MB).
// Keep in sync with REVIEW_DOCS in lib/api/review.ts.
export const REVIEW_DOCS = { pokemon: 'pokemon-review', onepiece: 'onepiece-review' }

// Saves what a sync found for Needs Review onto the LATEST registry, in a transaction. The sync
// read the registry when it started — minutes ago — and staff may have decided cards, moved sets
// or edited categories since; writing its old copy back would silently undo all of that. So
// only this run's own additions are applied to the fresh doc:
//   added      — placements new this run (skipped if one with that productId exists by now)
//   reoffered  — ignored placements offered again: applied only if still ignored
//   newSets    — sets new this run (skipped if a set by that name / TCGplayer group exists by now)
//   completed  — a review to file as completed (the first run's)
//   baseline   — (own-doc games) product ids recorded as accepted by the first run
export async function savePlacementsOnLatest(game, { added = [], reoffered = [], newSets = [], completed = null, baseline = null }) {
  const own = REVIEW_DOCS[game]
  const ref = doc(db, 'registry', own ?? 'main')
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const side = (own ? snap.data() : snap.data()?.[game]) ?? {}
    const placements = [...(side.placements ?? [])]
    const index = new Map(placements.map((p, i) => [String(p.productId), i]))
    for (const r of reoffered) {
      const i = index.get(String(r.productId))
      if (i !== undefined && placements[i].ignored) placements[i] = r
    }
    for (const p of added) if (!index.has(String(p.productId))) placements.push(p)
    if (own) {
      const next = { placements, completedReviews: [...(side.completedReviews ?? []), ...(completed ? [completed] : [])], updatedAt: serverTimestamp() }
      if (baseline) next.baseline = [...new Set([...(side.baseline ?? []), ...baseline])]
      tx.set(ref, next, { merge: true })
      return
    }
    const update = { [`${game}.placements`]: placements }
    if (newSets.length) {
      const sets = [...(side.sets ?? [])]
      for (const s of newSets) {
        if (!sets.some((x) => x.setName === s.setName || (s.tcgcsvGroupId != null && x.tcgcsvGroupId === s.tcgcsvGroupId))) sets.push(s)
      }
      update[`${game}.sets`] = sets
    }
    if (completed) update[`${game}.completedReviews`] = [...(side.completedReviews ?? []), completed]
    tx.update(ref, update)
  })
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url, headers = {}) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

// api.github.com's unauthenticated REST API is rate-limited to 60 requests/hour *per source IP*
// — fine for a single sync run in isolation, but Vercel functions commonly share a handful of
// outbound NAT IPs across many unrelated customers' traffic, so that budget can already be
// partly (or fully) consumed by requests this app never made. Pokemon and One Piece each make
// exactly one such call per sync (listing cards/en/), but a 429 here fails the WHOLE sync (no
// per-file fallback exists for a directory listing the way there is for individual card files
// below). An optional GITHUB_TOKEN env var (a GitHub personal access token with no special
// scopes needed — this only ever reads public repos) raises that ceiling to 5,000/hour, entirely
// separate from whatever else is sharing the egress IP. Safe to leave unset; every call here
// still works unauthenticated, just at the lower shared limit.
function githubApiHeaders(extra = {}) {
  return process.env.GITHUB_TOKEN
    ? { ...extra, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : extra
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.text()
}

// Parse a tcgcsv CSV text into row objects keyed by the header row. Every tcgcsv CSV read in this
// file goes through parseCSVText (defined below, hoisted): quoted fields can contain escaped `""`
// and line breaks (multi-line rules text), and splitting the file on '\n' first shifted every
// later column — that silently dropped ~40% of TCGplayer's Pokémon prices (e.g. most of Crown
// Zenith and its Galarian Gallery) and affected the other games' card-text rows too.
function parseCsv(text) {
  const lines = parseCSVText(text)
  if (lines.length < 2) return []
  const headers = lines[0]
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]
    const row = {}
    for (let j = 0; j < headers.length; j++) row[headers[j]] = (cols[j] ?? '').trim()
    rows.push(row)
  }
  return rows
}

// ── Pokemon ───────────────────────────────────────────────────────────────────
// Primary:   tcgcsv.com category 3 (TCGplayer) — which cards exist, and every price
// Secondary: github.com/PokemonTCG/pokemon-tcg-data — names / images / rarities for the cards it
//            has (and their ids), and the check TCGplayer is compared against.
// How the two are put together: scripts/lib/pokemon-tcgplayer.mjs.

// GitHub (pokemon-tcg-data): every set, and every card as a catalog card with $0 prices.
// `unavailableSetIds` = sets whose card file failed to download this run (see buildPokemonCatalog).
async function fetchGithubPokemon() {
  const sets = await fetchJSON('https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json')
  if (!Array.isArray(sets) || sets.length < 100) throw new Error(`GitHub returned ${sets?.length ?? 0} Pokémon sets — not syncing against a partial set list`)
  const setNameById = Object.fromEntries(sets.map((s) => [s.id, s.name]))
  const files = await fetchJSON(
    'https://api.github.com/repos/PokemonTCG/pokemon-tcg-data/contents/cards/en',
    githubApiHeaders({ Accept: 'application/vnd.github.v3+json' })
  )
  const cards = []
  const unavailableSetIds = new Set(sets.map((s) => s.id)) // until its file downloads
  await Promise.all(files.map(async (file) => {
    const setId = file.name.replace('.json', '')
    let list = null
    for (let attempt = 0; attempt < 3 && list === null; attempt++) {
      try { list = await fetchJSON(file.download_url) } catch (err) {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        else console.warn(`   ⚠️  Skipped ${file.name}: ${err.message}`)
      }
    }
    if (!Array.isArray(list)) return
    unavailableSetIds.delete(setId)
    for (const c of list) {
      if (!c?.name || !c?.images?.small) continue
      cards.push({
        id: `${setId}-${c.number}`,
        _ghId: c.id, // GitHub's own id — only used when two cards would share one (resolveIdCollisions)
        name: c.name,
        set: setId,
        setName: setNameById[setId] ?? setId,
        number: String(c.number ?? ''),
        // '' rather than omitted (mostly Basic Energy has none), so it can't vanish on a resync
        rarity: c.rarity ?? '',
        imageUrl: c.images.large ?? c.images.small,
        marketPrice: 0,
        marketPriceFoil: 0,
        lowPriceNM: 0,
        lowPriceNMFoil: 0,
        // Always present (even empty) so a printing TCGplayer stops pricing is cleared next sync
        variantPrices: {},
      })
    }
  }))
  // A set listed in sets/en.json with no card file at all yet isn't "unavailable" — it's empty
  const fileIds = new Set(files.map((f) => f.name.replace('.json', '')))
  for (const id of [...unavailableSetIds]) if (!fileIds.has(id)) unavailableSetIds.delete(id)
  return { sets, cards, unavailableSetIds }
}

const POKEMON_TCGCSV_HEADERS = {
  // tcgcsv blocks disguised browser User-Agents ("Please identify your application") — name the app.
  'User-Agent': 'TCGHaven/1.0 (+https://tcghaven.org)',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'application/json,text/csv,*/*',
}

// TCGplayer (tcgcsv category 3): every group and its products. Retries each CSV; a sync with more
// than 10% of groups failing is aborted rather than run on a partial catalog.
async function fetchTcgplayerPokemon() {
  const groups = (await fetchJSON('https://tcgcsv.com/tcgplayer/3/groups', POKEMON_TCGCSV_HEADERS)).results ?? []
  if (groups.length < 150) throw new Error(`TCGplayer returned ${groups.length} Pokémon groups — not syncing against a partial list`)
  const productsByGroup = new Map()
  const failedGroupIds = new Set()
  for (let i = 0; i < groups.length; i += 20) {
    await Promise.all(groups.slice(i, i + 20).map(async (g) => {
      let csv = null
      for (let attempt = 0; attempt < 3 && csv === null; attempt++) {
        try { csv = await fetchText(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/ProductsAndPrices.csv`, POKEMON_TCGCSV_HEADERS) } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
      if (csv === null) { failedGroupIds.add(g.groupId); return }
      productsByGroup.set(g.groupId, productsFromRows(parseCsv(csv)))
    }))
    process.stdout.write(`   TCGplayer: ${Math.min(i + 20, groups.length)}/${groups.length} groups...\r`)
  }
  if (failedGroupIds.size > groups.length * 0.1) {
    throw new Error(`${failedGroupIds.size}/${groups.length} TCGplayer Pokémon groups failed to download — not syncing a partial catalog`)
  }
  return { groups, productsByGroup, failedGroupIds }
}

/**
 * What a Pokémon sync would write, without writing anything: both sources fetched and built into
 * one catalog (pokemon-tcgplayer.mjs). downloadPokemon() writes it; scripts/pokemon-source-report.mjs
 * only reports it — so the report shows exactly what a sync does.
 */
export async function planPokemonCatalog() {
  const [gh, tcg, meta] = await Promise.all([
    fetchGithubPokemon(),
    fetchTcgplayerPokemon(),
    getDoc(doc(db, 'catalog_meta', 'pokemon')),
  ])
  console.log(`   GitHub: ${gh.sets.length} sets, ${gh.cards.length} cards${gh.unavailableSetIds.size ? ` (${gh.unavailableSetIds.size} set files failed)` : ''}`)
  // Cards that would share one catalog id keep it by what the catalog shows now
  const shared = collidingIds(gh.cards)
  const existingNameById = new Map()
  for (const id of shared) {
    const snap = await getDoc(doc(db, 'catalog', 'pokemon', 'cards', id))
    if (snap.exists()) existingNameById.set(id, snap.data().name)
  }
  const idMoves = resolveIdCollisions(gh.cards, existingNameById)
  const previousSets = meta.data()?.sets ?? []
  const built = buildPokemonCatalog({
    ghSets: gh.sets, ghCards: gh.cards, groups: tcg.groups, productsByGroup: tcg.productsByGroup,
    previousSets, unavailableSetIds: gh.unavailableSetIds, failedGroupIds: tcg.failedGroupIds,
  })
  const r = built.report
  r.idMoves = idMoves
  console.log(`   TCGplayer: ${tcg.groups.length} groups${tcg.failedGroupIds.size ? ` (${tcg.failedGroupIds.size} failed)` : ''} · ${r.linked} linked to GitHub cards · ${r.variants.length} variants GitHub lacks · ${r.newSets.length} new set(s) · ${built.placements.length} card(s) for review`)
  return { ...built, gh, tcg, previousSets }
}

export async function downloadPokemon() {
  console.log('\n🎴 Pokemon TCG...')
  const plan = await planPokemonCatalog()
  const all = plan.cards

  // Backup prices, only for cards TCGplayer's feed left unpriced — see price-fallback.mjs. It looks
  // cards up on GitHub's API by id, so only GitHub's own cards. Non-fatal.
  const backupRef = doc(db, 'catalog_meta', 'pokemon-price-backup')
  try {
    await ensureSignedIn()
    await fillPokemonPriceGaps(all.filter((c) => !c.id.startsWith('tcg-')), {
      loadCache: async () => { const snap = await getDoc(backupRef); return snap.exists() ? snap.data() : null },
      saveCache: (data) => setDoc(backupRef, { ...data, updatedAt: serverTimestamp() }),
    })
  } catch (err) {
    console.warn(`   ⚠️  Backup prices skipped: ${err.message}`)
  }

  // Cards that can't be placed by number go through Needs Review (accept / ignore / deny / move)
  const promoById = new Map()
  for (const card of all) {
    if (!card._review) continue
    delete card._review
    promoById.set(card.id, card)
  }
  const placementOf = new Map(plan.placements.map((x) => [`tcg-${x.product.productId}`, x]))
  for (const card of promoById.values()) {
    const x = placementOf.get(card.id)
    card._groupId = x?.product.groupId
  }
  const groupNames = plan.tcg.groups.map((g) => ({ groupId: g.groupId, setName: g.name }))
  const review = await reviewTcgplayerPromos('pokemon', promoById, groupNames, { setIdByName: new Map(plan.sets.map((x) => [x.name, x.id])) })
  // `fromReview`: the Admin Catalog edits these through their review record (isReviewCard())
  const reviewed = new Map(review.cards.map((c) => [c.id, { ...c, fromReview: true }]))
  const cards = all.filter((c) => !promoById.has(c.id) || reviewed.has(c.id)).map((c) => reviewed.get(c.id) ?? c)

  cards.sort((a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number, undefined, { numeric: true }))
  const result = await syncToFirestore('pokemon', cards, { fieldDefaults: { priceSource: '' }, hideIds: review.hideIds, unhideIds: review.unhideIds })
  // The set list, saved so the app reads one Firestore doc instead of api.pokemontcg.io (which
  // fails often enough that a cold "Loading sets…" took ~9s). Oldest first, like the API's orderBy.
  // TCGplayer-built sets carry `tcgplayerGroupId` — that's what keeps them claimed next sync.
  await setDoc(doc(db, 'catalog_meta', 'pokemon'), { sets: plan.sets }, { merge: true })
  return { ...result, newPlacements: review.newPlacements, sourceReport: summarizeSourceReport(plan.report) }
}

// The secondary check's findings, small enough for a status doc (counts + a few examples each)
export function summarizeSourceReport(r) {
  const few = (list, n = 10) => list.slice(0, n)
  return {
    at: new Date().toISOString(),
    linked: r.linked,
    variants: r.variants.length,
    newSets: r.newSets.map((s) => ({ name: s.name, cards: s.cards })),
    oddGroups: r.oddGroups.length,
    githubOnly: r.githubOnly.length,
    differences: r.differences.length,
    differenceExamples: few(r.differences),
    claimedCaughtUp: r.claimedCaughtUp,
    contentMatched: r.contentMatched,
    skippedGroups: r.skippedGroups,
    stalePriceSets: r.stalePriceSets,
  }
}

// ── Pokémon (Japanese) ────────────────────────────────────────────────────────
// Its own catalog (catalog/pokemon-jp), built entirely from TCGplayer's Japanese category — see
// pokemon-jp.mjs. ~460 small CSVs, one per set. The set list (release dates, eras for the Cardex)
// is written to catalog_meta/pokemon-jp.sets alongside the cards.
export async function downloadPokemonJapanese() {
  console.log('\n🎴 Pokemon (Japanese)...')
  const headers = {
    'User-Agent': 'TCGHaven/1.0 (+https://tcghaven.org)',
    'Referer': 'https://tcgcsv.com/',
    'Accept': 'application/json,text/csv,*/*',
  }
  const groups = (await fetchJSON(`https://tcgcsv.com/tcgplayer/${JP_CATEGORY}/groups`, headers)).results ?? []
  if (!groups.length) throw new Error('TCGplayer returned no Japanese Pokémon sets')
  const placeholders = placeholderDates(groups)

  const all = []
  const sets = []
  const failedGroups = []
  const sealedIds = new Set() // sealed product: never a card (two old listings get hidden below)
  for (let i = 0; i < groups.length; i += 20) {
    await Promise.all(groups.slice(i, i + 20).map(async (g) => {
      let csv = null
      for (let attempt = 0; attempt < 3 && csv === null; attempt++) {
        try {
          csv = await fetchText(`https://tcgcsv.com/tcgplayer/${JP_CATEGORY}/${g.groupId}/ProductsAndPrices.csv`, headers)
        } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
      if (csv === null) { failedGroups.push(g); return }
      const byProduct = new Map()
      for (const row of parseCsv(csv)) {
        if (!row.productId) continue
        if (!isSingleRow(row)) { sealedIds.add(`jp-${row.productId}`); continue }
        if (!byProduct.has(row.productId)) byProduct.set(row.productId, [])
        byProduct.get(row.productId).push(row)
      }
      const cards = [...byProduct.values()].map((rows) => jpCard(g, rows))
      all.push(...cards)
      if (cards.length) sets.push(jpSetMeta(g, cards.length, placeholders))
    }))
    process.stdout.write(`   Japanese sets: ${Math.min(i + 20, groups.length)}/${groups.length}...\r`)
  }
  console.log(`   ${all.length} Japanese cards in ${sets.length} sets${failedGroups.length ? ` (${failedGroups.length} sets failed to download)` : ''}`)
  // A handful of failed downloads is fine (syncToFirestore never deletes, and those sets keep their
  // existing cards and set-list entry); a large share means TCGplayer/tcgcsv is having a bad day.
  if (failedGroups.length > groups.length * 0.1) {
    throw new Error(`${failedGroups.length}/${groups.length} Japanese sets failed to download — not syncing a partial catalog`)
  }

  all.sort((a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number, undefined, { numeric: true }))
  // No per-sync image HEAD checks: a first sync would HEAD ~30k images. TCGplayer's own
  // imageCount column already says which products have no photo (those get no imageUrl).
  // A product an earlier sync took for a card that the sealed-product filter now recognises
  // ("Glory of Team Rocket Gang Briefcase", "Pikachu's New Friends Collection") is hidden
  const result = await syncToFirestore(JP_CATALOG, all, { checkImages: false, hideIds: [...sealedIds] })

  const metaRef = doc(db, 'catalog_meta', JP_CATALOG)
  const previous = (await getDoc(metaRef)).data()?.sets ?? []
  const fresh = new Set(sets.map((s) => s.code))
  const kept = previous.filter((s) => !fresh.has(s.code) && failedGroups.some((g) => `jp-${g.groupId}` === s.code))
  const allSets = [...sets, ...kept].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name))
  await setDoc(metaRef, { sets: allSets }, { merge: true })
  return { ...result, sets: allSets }
}

// ── Lorcana ───────────────────────────────────────────────────────────────────
// Source: api.lorcast.com
// Strategy:
//   1. Vowel-based text searches — catches all regular cards (every name has a vowel)
//   2. Rarity-based searches (enchanted, epic, mythic, special) — these high-value
//      variants DO NOT appear in text searches, only in rarity-filtered queries
//
// Epic/Enchanted cards are collector numbers 200+ and have prices $5–$1000+.
// Without the rarity queries, they are completely missing from the catalog.

const TCGCSV_HEADERS = {
  // tcgcsv blocks disguised browser User-Agents ("Please identify your application") — name the app.
  'User-Agent': 'TCGHaven/1.0 (+https://tcghaven.org)',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
}

// A whole CSV file → rows of fields, honoring escaped `""` and quoted fields that span lines.
// Never split a tcgcsv file on '\n' first: card text often contains line breaks.
function parseCSVText(text) {
  const rows = []
  let row = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else cur += ch
  }
  row.push(cur)
  if (row.some((v) => v !== '')) rows.push(row)
  return rows
}

export async function downloadLorcana() {
  console.log('\n✨ Lorcana...')

  const seen = new Map() // id → card

  async function fetchAndStore(url, label) {
    try {
      const data = await fetchJSON(url)
      const results = data.results ?? data ?? []
      let added = 0
      for (const c of results) {
        if (!c?.id || !c?.name) continue
        if (!seen.has(c.id)) {
          seen.set(c.id, {
            id: c.id,
            name: c.version ? `${c.name} - ${c.version}` : c.name,
            set: c.set?.code ?? '',
            setName: c.set?.name ?? '',
            number: String(c.collector_number ?? ''),
            rarity: c.rarity ?? '',
            // "large" (~50KB avif) over "normal" (~36KB) over "small" (~7KB, visibly pixelated
            // once shown bigger than a tiny thumbnail, e.g. the Admin Catalog hover preview).
            imageUrl: c.image_uris?.digital?.large ?? c.image_uris?.digital?.normal ?? c.image_uris?.digital?.small ?? '',
            // lorcast returns prices as numbers or strings; parseFloat handles both
            marketPrice: parseFloat(c.prices?.usd) || 0,
            marketPriceFoil: parseFloat(c.prices?.usd_foil) || 0,
          })
          added++
        }
      }
      process.stdout.write(`   ${label}: +${added} new (${seen.size} total)\n`)
      return results.length
    } catch (err) {
      console.warn(`   ⚠️  ${label} failed: ${err.message}`)
      return 0
    }
  }

  // Phase 1: text searches (catches all regular/foil cards)
  const textQueries = ['a', 'e', 'i', 'o', 'u', 'y', 'th']
  for (const q of textQueries) {
    await fetchAndStore(
      `https://api.lorcast.com/v0/cards/search?q=${encodeURIComponent(q)}&page_size=500`,
      `text:"${q}"`
    )
  }

  // Phase 2: rarity-based searches — Epic, Enchanted, and Iconic cards ONLY appear here.
  // These are the most valuable cards in each set and are missed by text search.
  const rarityQueries = ['enchanted', 'epic', 'iconic', 'mythic', 'special']
  for (const rarity of rarityQueries) {
    await fetchAndStore(
      `https://api.lorcast.com/v0/cards/search?q=rarity:${rarity}&page_size=500`,
      `rarity:${rarity}`
    )
  }

  // Phase 3: TCGPlayer-only groups — D23, Disney promos, Illumineer's Quest, Hyperia City, etc.
  // lorcast doesn't include these; we pull from tcgcsv (category 71, same CSV format as
  // Riftbound). This used to be a hardcoded { groupId, setName } list that needed a code change
  // + deploy every time TCGPlayer added a new promo-only group (that's literally how "Hyperia
  // City" got added last time) — the same class of "a real drop needs a human to notice and edit
  // source" risk that bit Pokemon's 30th Celebration set. Instead, auto-discover: fetch every
  // group tcgcsv lists under Lorcana's category, and for each one, keep it only if it's mostly
  // cards lorcast has never heard of (a genuine promo-only group). A REAL numbered set (Wilds
  // Unknown, Whispers in the Well, ...) also has its own tcgcsv group in this same listing, but
  // its cards are already in `seen` from Phase 1/2 — verified empirically that TCGPlayer's
  // product `name` column matches lorcast's own "Name - Version" format closely enough that
  // per-card dedup below correctly recognizes nearly all of them. The MOSTLY-UNMATCHED threshold
  // (not "any unmatched card counts") exists as a safety margin against the rare name-format
  // mismatch on a real set's group producing a stray near-duplicate catalog entry — a group
  // that's mostly-already-known is treated as "nothing to add here" rather than trusting a
  // handful of straggler rows.
  const UNMATCHED_RATIO_THRESHOLD = 0.5

  // Dedup by name+setName to avoid re-adding lorcast cards that also appear in TCGPlayer promo groups
  const seenByNameSet = new Set([...seen.values()].map(c => `${c.name}|${c.setName}`))

  const promoByProductId = new Map() // productId → card (merges Normal + Foil rows)

  let tcgcsvGroups = []
  try {
    const groupData = await fetchJSON('https://tcgcsv.com/tcgplayer/71/groups', TCGCSV_HEADERS)
    tcgcsvGroups = (groupData.results ?? []).map((g) => ({ groupId: g.groupId, setName: g.name }))
    console.log(`   Found ${tcgcsvGroups.length} TCGPlayer groups (auto-discovered, incl. real numbered sets — those just contribute 0 new cards below)`)
  } catch (err) {
    console.warn(`   ⚠️  Could not list TCGPlayer groups: ${err.message} — promo-only cards (D23, Illumineer's Quest, etc.) will be missing this sync`)
  }

  await Promise.all(tcgcsvGroups.map(async ({ groupId, setName }) => {
    try {
      const res = await fetch(
        `https://tcgcsv.com/tcgplayer/71/${groupId}/ProductsAndPrices.csv`,
        { headers: TCGCSV_HEADERS }
      )
      if (!res.ok) { console.warn(`   ⚠️  ${setName}: ${res.status}`); return }
      const lines = parseCSVText(await res.text())
      if (lines.length === 0) return
      // TCGPlayer's CSV column layout is NOT fixed across groups — a group containing only
      // sealed product (booster boxes, cases, troves — no actual cards, e.g. "Hyperia City")
      // has no extRarity/extNumber columns at all, since those are per-card fields. Reading by
      // fixed index there would silently grab price columns instead (that's exactly how price
      // values like "199.62" ended up in the `rarity` field). Look columns up by header name
      // instead: real card groups resolve every name below; sealed-goods-only groups resolve
      // extRarity/extNumber to -1, so every row in them is skipped by the guard further down.
      const header = lines[0].map((h) => h.trim())
      const col = (name) => header.indexOf(name)
      const idx = {
        productId: col('productId'), name: col('name'), imageUrl: col('imageUrl'), imageCount: col('imageCount'),
        extRarity: col('extRarity'), extNumber: col('extNumber'),
        marketPrice: col('marketPrice'), midPrice: col('midPrice'), subTypeName: col('subTypeName'),
      }
      // Buffer candidate rows first — whether this group's unmatched cards actually get kept
      // depends on the group-wide ratio computed after this loop, not decided per-row.
      const candidates = []
      for (let i = 1; i < lines.length; i++) {
        const f = lines[i]
        const get = (i) => (i >= 0 ? f[i]?.trim() ?? '' : '')
        const productId   = get(idx.productId)
        const name        = get(idx.name)
        // Full-size photo, or '' when TCGplayer hasn't photographed it (that URL 403s forever)
        const imageUrl    = tcgPhoto({ imageUrl: get(idx.imageUrl), imageCount: get(idx.imageCount) })
        const extRarity   = get(idx.extRarity) || 'Promo'
        const extNumber   = get(idx.extNumber)
        // marketPrice can be empty for low-volume promos; fall back to midPrice
        const marketPrice = parseFloat(get(idx.marketPrice)) || parseFloat(get(idx.midPrice)) || 0
        const subTypeName = get(idx.subTypeName)
        if (!productId || !name || !extNumber) continue // sealed product row — no per-card fields
        candidates.push({ productId, name, imageUrl, extRarity, extNumber, marketPrice, subTypeName })
      }
      if (candidates.length === 0) return // sealed-goods-only group (e.g. a pure booster-box listing)

      const unmatched = candidates.filter((c) => !seenByNameSet.has(`${c.name}|${setName}`))
      if (unmatched.length / candidates.length < UNMATCHED_RATIO_THRESHOLD) {
        console.log(`   TCGPlayer ${setName}: already covered by lorcast (${candidates.length - unmatched.length}/${candidates.length} matched) — skipped`)
        return
      }

      let added = 0
      for (const { productId, name, imageUrl, extRarity, extNumber, marketPrice, subTypeName } of unmatched) {
        const id = `tcg-${productId}`
        if (!promoByProductId.has(id)) {
          promoByProductId.set(id, {
            id,
            name,
            set: String(groupId),
            setName,
            number: String(parseInt(extNumber, 10) || extNumber),
            rarity: extRarity || 'Promo',
            imageUrl,
            marketPrice: 0,
            marketPriceFoil: 0,
            _groupId: groupId, // for Needs Review (reviewTcgplayerPromos) — stripped before saving
          })
          added++
        }
        // Merge Normal vs Foil prices for the same product
        const card = promoByProductId.get(id)
        const isFoil = subTypeName.toLowerCase().includes('foil')
        if (isFoil) card.marketPriceFoil = Math.max(card.marketPriceFoil, marketPrice)
        else card.marketPrice = Math.max(card.marketPrice, marketPrice)
      }
      console.log(`   TCGPlayer ${setName}: +${added} cards`)
    } catch (err) {
      console.warn(`   ⚠️  ${setName} error: ${err.message}`)
    }
  }))

  // Promo cards go through Needs Review (accept / ignore / deny / move / rename) before they're
  // merged into the main seen map.
  const review = await reviewTcgplayerPromos('lorcana', promoByProductId, tcgcsvGroups)
  for (const card of review.cards) seen.set(card.id, card)

  const merged = [...seen.values()]
  merged.sort((a, b) =>
    a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number, undefined, { numeric: true })
  )
  const result = await syncToFirestore('lorcana', merged, { hideIds: review.hideIds, unhideIds: review.unhideIds })
  return { ...result, newPlacements: review.newPlacements }
}

// ── Needs Review for a game's TCGplayer-only promo cards (Lorcana) ─────────────
// Same review as Riftbound's placements (see discoverRiftboundProducts): every promo product a
// sync builds straight from TCGplayer gets a `placements` entry in the registry for its game —
// new ones land in that sync's review node on Needs Review (addedAt = this sync), placed in the
// set the sync named (the TCGplayer group). Staff decide each one there:
//   accepted → kept in its set (staff may have moved / renamed it, or chosen no picture)
//   ignored  → hidden for now, and offered again (in the next sync's node) the next time it's seen
//   denied   → hidden, and never offered again (stays in placements)
// The first run records every promo already in the catalog as accepted, in one review that's
// filed as completed, so switching this on doesn't drop hundreds of known cards on staff.
// `setIdByName` (Pokémon): a card's `set` is its set's id, so a card staff moved follows to that id.
async function reviewTcgplayerPromos(game, promoById, groups, { setIdByName = null } = {}) {
  const strip = (card) => { delete card._groupId; return card }
  const own = REVIEW_DOCS[game]
  let side
  if (own) {
    const snap = await getDoc(doc(db, 'registry', own))
    side = snap.exists() ? snap.data() : {}
  } else {
    side = (await loadRegistry())?.[game]
  }
  if (!side) return { cards: [...promoById.values()].map(strip), hideIds: [], unhideIds: [], newPlacements: 0 }

  const firstRun = !Array.isArray(side.placements)
  const placements = side.placements ?? []
  // Own-doc games: the first run's products are recorded as accepted by id (see REVIEW_DOCS)
  const baseline = new Set((side.baseline ?? []).map(String))
  const newBaseline = []
  const byProduct = new Map(placements.map((p) => [String(p.productId), p]))
  const groupName = new Map(groups.map((g) => [g.groupId, g.setName]))
  const nowIso = new Date().toISOString()
  const cards = []
  const hideIds = []
  const unhideIds = []
  let changed = false
  let newPlacements = 0
  const added = []
  const reoffered = []

  for (const card of promoById.values()) {
    const productId = card.id.replace(/^tcg-/, '')
    let p = byProduct.get(productId)
    if (!p && own && (firstRun || baseline.has(productId))) {
      // Accepted as found (first run's backlog) — kept where the sync placed it
      if (firstRun) { newBaseline.push(Number(productId)); changed = true }
      cards.push(strip(card))
      continue
    }
    if (!p) {
      p = {
        productId: Number(productId), groupId: card._groupId, groupName: groupName.get(card._groupId) ?? card.setName,
        name: card.name, number: card.number, setName: card.setName,
        auto: true, reviewed: firstRun, addedAt: nowIso,
        ...(firstRun ? { decidedAt: nowIso } : {}),
      }
      placements.push(p)
      added.push(p)
      byProduct.set(productId, p)
      changed = true
      if (!firstRun) newPlacements++
    } else if (p.ignored) {
      // "Ignore" = ask again next sync — this is it
      Object.assign(p, { ignored: false, reviewed: false, auto: true, addedAt: nowIso })
      delete p.decidedAt
      reoffered.push(p)
      unhideIds.push(card.id)
      changed = true
      newPlacements++
    }
    strip(card)
    if (!p.setName || p.denied) { hideIds.push(card.id); continue }
    card.setName = p.setName
    if (setIdByName?.has(p.setName)) card.set = setIdByName.get(p.setName)
    if (p.displayName) card.name = p.displayName
    if (p.image === 'none') card.imageUrl = ''
    cards.push(card)
  }
  // Ignored ones not seen this run stay hidden until they are
  for (const p of placements) if (p.ignored) hideIds.push(`tcg-${p.productId}`)

  if (changed) {
    try {
      await savePlacementsOnLatest(game, {
        added, reoffered,
        completed: firstRun && !own ? { at: nowIso, completedAt: nowIso } : null,
        baseline: own && firstRun ? newBaseline : null,
      })
    } catch (err) {
      console.warn(`   ⚠️  Couldn't save ${game} promo review to the registry: ${err.message}`)
    }
  }
  if (firstRun) console.log(`   Promo review: recorded ${own ? newBaseline.length : placements.length} existing promo cards as accepted (first run)`)
  else if (newPlacements) console.log(`   🆕 ${newPlacements} promo card(s) waiting on Needs Review`)
  return { cards, hideIds, unhideIds, newPlacements }
}

// ── Riftbound ─────────────────────────────────────────────────────────────────
// Source: playriftbound.com/en-us/card-gallery/ (official Riot Games site)
// Contains all sets including Unleashed, plus Showcase/overnumber alt-arts.
// Images hosted on Riot's CDN (cmsassets.rgpub.io).
//
// Prices: tcgcsv.com (TCGPlayer data, category 89)
// Groups: OGN=24344, SFD=24519, UNL=24560, OGS=24439, + promo sets

const SET_ORDER = { OGN: 0, SFD: 1, UNL: 2, OGS: 3, VEN: 4, RAD: 5 }

// TCGCSV group IDs for each set code. This bootstrap list is merged with (and
// overridden by) any tcgcsvGroupId values the sync feature has since discovered
// and written into the registry (Firestore registry/main) — see getTcgcsvGroups() below.
const TCGCSV_GROUPS = [
  { groupId: 24344, setCode: 'OGN' },
  { groupId: 24519, setCode: 'SFD' },
  { groupId: 24560, setCode: 'UNL' },
  { groupId: 24439, setCode: 'OGS' },
]

async function getTcgcsvGroups() {
  const registry = await loadRegistry()
  if (!registry?.riftbound?.sets) return TCGCSV_GROUPS
  const merged = new Map(TCGCSV_GROUPS.map((g) => [g.setCode, g.groupId]))
  for (const s of registry.riftbound.sets) {
    // TCGplayer-only sets build their own cards (fetchTcgplayerOnlyRiftboundSets below) — their
    // rows don't follow the main sets' numbering, so they stay out of the gallery price merge.
    if (s.tcgplayerOnly) continue
    if (s.setCode && typeof s.tcgcsvGroupId === 'number') merged.set(s.setCode, s.tcgcsvGroupId)
  }
  return [...merged.entries()].map(([setCode, groupId]) => ({ groupId, setCode }))
}

// ── TCGplayer-only promo sets ────────────────────────────────────────────────
// Some real Riftbound products never appear on Riot's card gallery — e.g. the T1 2025 Worlds
// Champion bundles and the Worlds Bundle 2025 promos — so the gallery scrape can't create them.
// A registry set marked `tcgplayerOnly: true` (with its tcgcsvGroupId) is instead built straight
// from that TCGplayer group, one catalog card per TCGplayer product, and repriced every sync like
// everything else. Sealed products (no extNumber) and oversized display cards are skipped. Ids use
// TCGplayer's productId, which is stable and tells apart products that share a collector number
// (a bundle's regular and serial-numbered copies, say).
export const TCGPLAYER_ONLY_RARITY = 'Event Promo'

function tcgplayerOnlyCard(set, row) {
  const parens = [...row.name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim())
  const baseName = row.name.replace(/\s*\([^)]*\)/g, '').trim()
  // "(T1 Worlds Champion Signature Edition Bundle) (Serial Numbered)" → "Signature Edition
  // Bundle, Serial Numbered": drop the leading words every product in the set repeats (they're
  // the set's own name), keep what tells the versions apart.
  const setWords = new Set(set.setName.toLowerCase().split(/\s+/))
  const variant = parens
    .filter((p) => !p.split(/\s+/).every((w) => setWords.has(w.toLowerCase())))
    .map((p) => {
      const words = p.split(/\s+/)
      while (words.length > 1 && setWords.has(words[0].toLowerCase())) words.shift()
      return words.join(' ')
    })
    .filter(Boolean)
    .join(', ')
  const num = row.extNumber.match(/(\d+)([a-z*]?)\s*\/\s*\d+/i)
  return {
    id: `${set.setCode.toLowerCase()}-${row.productId}`,
    name: variant ? `${baseName} (${variant})` : baseName,
    number: num ? `${parseInt(num[1], 10)}${num[2]}` : row.extNumber,
    // Bundle codes like "T1S 001/005" already carry their own prefix; plain ones ("263a/298")
    // get the set code, matching the gallery's "OGN-263a/298" shape.
    publicCode: /^[A-Z]/i.test(row.extNumber) ? row.extNumber.replace(/\s+/, '-') : `${set.setCode}-${row.extNumber}`,
    setCode: set.setCode,
    setName: set.setName,
    rarity: set.tcgplayerRarity || TCGPLAYER_ONLY_RARITY,
    cardType: row.extCardType || '',
    tags: [baseName.split(',')[0].trim()].filter(Boolean),
    imageUrl: tcgPhoto(row),
    // One TCGplayer product = one price: its market price (what copies actually sold for). No
    // fallback to the lowest listing — for a one-off like a serial-numbered card that's just
    // someone's asking price (thousands over any real sale), so no sales means no price yet.
    marketPrice: row.marketPrice,
    marketPriceFoil: 0,
    lowPriceNM: row.lowPrice,
    lowPriceNMFoil: 0,
  }
}

// TCGplayer hasn't photographed every product — the T1 serial-numbered copies 403 at every size.
// Such a card is the same art as its sibling sharing its collector code (the regular Signature
// Edition copy), so borrow that sibling's photo rather than showing a blank tile.
async function borrowMissingPhotos(setCards) {
  const ok = await Promise.all(setCards.map(async (c) => {
    if (c.keepImage) return true // staff chose this card's picture — no borrowing
    if (!c.imageUrl) return false
    try {
      const res = await fetch(c.imageUrl, { method: 'HEAD', headers: { 'User-Agent': 'TCGHaven/1.0' } })
      return res.ok
    } catch {
      return true // a network blip isn't a missing photo
    }
  }))
  setCards.forEach((card, i) => {
    if (ok[i]) return
    const sibling = setCards.find((c, j) => ok[j] && c.publicCode === card.publicCode)
    if (sibling) card.imageUrl = sibling.imageUrl
    else card.needsGalleryArt = true // see useGalleryArtForPhotoless() in downloadRiftbound
  })
}

// Last resort for a TCGplayer-only card with no photo at all (no sibling has one either — most
// Metal cards): its collector code is the ORIGINAL card's ("247/298" = Origins #247 for Kai'Sa's
// Metal), so show that card's gallery art. Not the metal finish, but the right card instead of a
// blank tile. Runs once the gallery scrape is in, since that's where the art comes from.
function useGalleryArtForPhotoless(tcgplayerOnlyCards, galleryCards) {
  const byCode = new Map()
  for (const c of galleryCards) {
    const code = (c.publicCode ?? '').split('-').slice(1).join('-') // "OGN-247/298" → "247/298"
    if (code && !byCode.has(code)) byCode.set(code, c.imageUrl)
  }
  for (const card of tcgplayerOnlyCards) {
    const fallbackName = card.artFallbackName
    delete card.artFallbackName
    delete card.keepImage
    if (!card.needsGalleryArt) continue
    delete card.needsGalleryArt
    const code = card.publicCode.split('-').slice(1).join('-')
    let art = byCode.get(code)
    // A placed extra (a Nexus Night Rune) has a code no other card shares — use its set's own
    // copy of the same card instead, preferring the alt-art "a" version ("Fury Rune" R01a).
    if (!art && fallbackName) {
      const same = galleryCards.filter((c) => c.setCode === card.setCode && c.name === fallbackName && c.imageUrl)
      art = (same.find((c) => /a$/i.test(String(c.number))) ?? same[0])?.imageUrl
    }
    if (art) card.imageUrl = art
  }
}

// A TCGplayer row's product photo, full size — or '' when TCGplayer hasn't photographed the
// product yet. The CSV still links a thumbnail URL for those (imageCount 0), but it 403s forever,
// so saving it put a broken image on the card; '' lets a fallback (or the app's "No Image") show.
function tcgPhoto(row) {
  if (!row.imageUrl || !(parseInt(row.imageCount, 10) > 0)) return ''
  return row.imageUrl.replace(/_200w\.jpg$/, '_in_1000x1000.jpg')
}

// The CSV has a row per printing (Normal / Foil) of each product — one card per product, priced
// from whichever printing actually sells.
function oneRowPerProduct(rows) {
  const best = new Map()
  for (const row of rows) {
    const prev = best.get(row.productId)
    if (!prev || row.marketPrice > prev.marketPrice) best.set(row.productId, row)
  }
  return [...best.values()]
}

// One TCGplayer group's CSV as row objects, fields read by header name. Parsed as a whole, not line
// by line — some rows' descriptions contain line breaks inside quotes (the Metal cards' "only
// available as foil" disclaimers) — and column order differs between groups (some add
// extFlavorText). Sealed products (no extNumber) and "(Oversized)" display cards are dropped.
async function fetchTcgplayerGroupRows(groupId) {
  const res = await fetch(`https://tcgcsv.com/tcgplayer/89/${groupId}/ProductsAndPrices.csv`, { headers: TCGCSV_HEADERS })
  if (!res.ok) throw new Error(`group ${groupId}: ${res.status}`)
  const [header, ...records] = parseCSVText(await res.text())
  const col = (name) => header.indexOf(name)
  const at = (f, name) => (col(name) >= 0 ? f[col(name)] ?? '' : '')
  return records
    .map((f) => ({
      productId: at(f, 'productId'), name: at(f, 'name'), imageUrl: at(f, 'imageUrl'), imageCount: at(f, 'imageCount'),
      extNumber: at(f, 'extNumber').trim(), extCardType: at(f, 'extCardType'),
      marketPrice: parseFloat(at(f, 'marketPrice')) || 0, lowPrice: parseFloat(at(f, 'lowPrice')) || 0,
    }))
    .filter((row) => row.productId && row.name && row.extNumber && !/\(oversized\)/i.test(row.name))
}

// A TCGplayer product listed under some OTHER group (e.g. the Organized Play promos) that really
// belongs in one of the main sets — the Nexus Night Runes, which only come in Nexus Night packs
// but are numbered as that set's next Rune variant (Origins "007b/298", Spiritforged "R01c",
// Vendetta "R01b"). Configured on the main set's own registry entry as `extraTcgplayerProducts:
// [{ groupId, productIds, nameSuffix }]`, so no extra set shows up in any set picker.
function placedExtraCard(set, row, nameSuffix) {
  const baseName = row.name.replace(/\s*\([^)]*\)/g, '').trim()
  const isRune = /\brune\b/i.test(baseName)
  const rMatch = row.extNumber.match(/^(R\d+[a-z]?)$/i)
  const nMatch = row.extNumber.match(/^(\d+)([a-z]?)\s*\/\s*\d+/i)
  return {
    id: `${set.setCode.toLowerCase()}-${row.extNumber.toLowerCase().replace(/\s*\/\s*/, '-')}`,
    name: nameSuffix ? `${baseName} (${nameSuffix})` : baseName,
    number: rMatch ? rMatch[1].toUpperCase().replace(/[A-Z]$/, (c) => c.toLowerCase()) : nMatch ? `${parseInt(nMatch[1], 10)}${nMatch[2]}` : row.extNumber,
    publicCode: `${set.setCode}-${row.extNumber}`,
    setCode: set.setCode,
    setName: set.setName,
    rarity: 'Promo',
    cardType: isRune ? 'Rune' : (row.extCardType || ''),
    tags: isRune ? [baseName.split(/\s+/)[0]] : [baseName.split(',')[0].trim()],
    imageUrl: tcgPhoto(row),
    marketPrice: row.marketPrice,
    marketPriceFoil: 0,
    lowPriceNM: row.lowPrice,
    lowPriceNMFoil: 0,
    artFallbackName: baseName, // see useGalleryArtForPhotoless
  }
}

// A product the sync placed (or staff moved) via `riftbound.placements` — see
// discoverRiftboundProducts(). Its id is `tcg-{productId}` whatever set it's in, so moving it
// between sets in the staff portal keeps the same card (and every collector's link to it).
// `displayName` is a name staff gave it on Needs Review, which every sync keeps.
export function placementDefaultName(tcgplayerName) {
  const base = tcgplayerName.replace(/\s*\([^)]*\)/g, '').trim()
  const parens = [...tcgplayerName.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean)
  return `${base} (${parens.join(', ') || 'Promo'})`
}

// `image` is staff's pick on Needs Review: 'tcgplayer' (TCGplayer's photo, or none until it has
// one), 'riot' (the same card's gallery art) or 'none'. Unset = TCGplayer's photo, else Riot's art.
function placementCard(set, row, displayName, image) {
  const card = set.tcgplayerOnly
    ? { ...tcgplayerOnlyCard(set, row), id: `tcg-${row.productId}` }
    : { ...placedExtraCard(set, row, ''), id: `tcg-${row.productId}`, name: placementDefaultName(row.name) }
  if (displayName) card.name = displayName
  if (image === 'none') { card.imageUrl = ''; card.keepImage = true }
  else if (image === 'tcgplayer') card.keepImage = true
  else if (image === 'riot') { card.imageUrl = ''; card.needsGalleryArt = true; card.keepImage = true }
  return card
}

function tcgplayerRowCache() {
  const cache = new Map()
  return (groupId) => {
    if (!cache.has(groupId)) cache.set(groupId, fetchTcgplayerGroupRows(groupId))
    return cache.get(groupId)
  }
}

// Cards built straight from TCGplayer rather than Riot's gallery: tcgplayerOnly sets, the
// extraTcgplayerProducts placed into main sets, and `placements` (set → its cards). `allSets` is
// the whole registry list, for finding a placement's set.
async function fetchTcgplayerOnlyRiftboundSets({ sets, placements = [], allSets = sets, rowsOf }) {
  const cards = []

  for (const set of sets.filter((s) => s.tcgplayerOnly && typeof s.tcgcsvGroupId === 'number' && s.setCode)) {
    try {
      // Optional: only the products whose name contains this (e.g. "(Metal)" out of the much
      // bigger Organized Play promo group), and/or exactly these products (a hand-picked set).
      const only = set.tcgplayerNameFilter ? String(set.tcgplayerNameFilter).toLowerCase() : null
      const pick = Array.isArray(set.tcgplayerProductIds) ? new Set(set.tcgplayerProductIds.map(String)) : null
      const setCards = (await rowsOf(set.tcgcsvGroupId))
        .filter((row) => (!only || row.name.toLowerCase().includes(only)) && (!pick || pick.has(row.productId)))
        .map((row) => tcgplayerOnlyCard(set, row))
      await borrowMissingPhotos(setCards)
      cards.push(...setCards)
      console.log(`   TCGCSV ${set.setName}: ${setCards.length} TCGplayer-only cards`)
    } catch (err) {
      console.warn(`   ⚠️  TCGCSV ${set.setName} error: ${err.message}`)
    }
  }

  for (const set of sets.filter((s) => Array.isArray(s.extraTcgplayerProducts) && s.setCode)) {
    for (const extra of set.extraTcgplayerProducts) {
      try {
        const pick = new Set((extra.productIds ?? []).map(String))
        const extraCards = (await rowsOf(extra.groupId))
          .filter((row) => pick.has(row.productId))
          .map((row) => placedExtraCard(set, row, extra.nameSuffix))
        await borrowMissingPhotos(extraCards)
        cards.push(...extraCards)
        console.log(`   TCGCSV ${set.setName}: ${extraCards.length} extra cards from group ${extra.groupId}`)
      } catch (err) {
        console.warn(`   ⚠️  TCGCSV ${set.setName} extras error: ${err.message}`)
      }
    }
  }

  const setByName = new Map(allSets.filter((s) => s.setCode).map((s) => [s.setName, s]))
  const byGroup = new Map()
  for (const p of placements) {
    if (!p.setName || !setByName.has(p.setName)) continue
    byGroup.set(p.groupId, [...(byGroup.get(p.groupId) ?? []), p])
  }
  for (const [groupId, list] of byGroup) {
    try {
      const rows = new Map(oneRowPerProduct(await rowsOf(groupId)).map((r) => [r.productId, r]))
      const placedCards = list
        .filter((p) => rows.has(String(p.productId)))
        .map((p) => placementCard(setByName.get(p.setName), rows.get(String(p.productId)), p.displayName, p.image))
      await borrowMissingPhotos(placedCards)
      cards.push(...placedCards)
      console.log(`   TCGCSV group ${groupId}: ${placedCards.length} placed cards`)
    } catch (err) {
      console.warn(`   ⚠️  TCGCSV group ${groupId} placements error: ${err.message}`)
    }
  }
  return cards
}

// ── Finding new TCGplayer products ───────────────────────────────────────────
// Riot's gallery only lists the main sets, so promos, bundles and event cards exist only on
// TCGplayer — and a sync used to see only the groups and products someone had already typed into
// the registry. Each sync now reads TCGplayer's whole Riftbound group list and, for anything the
// registry doesn't cover yet:
//
//  - a promo "pool" group (Organized Play, Promotional Cards, Judge…): each new numbered product
//    is placed into the main set its collector number belongs to ("052/298" → Origins), as a
//    "Promo" card. Anything it can't place (tokens, unnumbered runes) is recorded but left out.
//  - any other new group with numbered cards (a bundle like Worlds Bundle 2025): it becomes a new
//    TCGplayer-only set in the Promos group, flagged needsReview.
//
// Everything lands in `riftbound.placements` / `riftbound.sets` for staff to check on the Needs
// Review page, where a placement can be moved to any set or left out.
const POOL_GROUP_NAME = /promo|organized play|judge|prize/i
// A group this big is a main set TCGplayer lists before Riot's gallery does — the gallery creates it.
const MAIN_SET_MIN_CARDS = 60

function guessPlacementSet(extNumber, setByDenominator) {
  const m = extNumber.match(/^\d+[a-z*]?\s*\/\s*(\d+)$/i)
  return m ? setByDenominator.get(String(parseInt(m[1], 10))) ?? null : null
}

function newBundleSet(group, sets, groupOrder, nowIso) {
  const setName = group.name.replace(/^riftbound:?\s*/i, '').trim() || group.name
  const taken = new Set(sets.map((s) => s.setCode))
  let setCode = String(group.abbreviation ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase() || `G${group.groupId}`
  if (taken.has(setCode)) setCode = `${setCode}${group.groupId}`
  return {
    setName, setCode, releaseDate: group.publishedOn ? String(group.publishedOn).slice(0, 10) : null, cardCount: 0,
    cardexGroup: groupOrder.includes('Promos') ? 'Promos' : groupOrder[0] ?? null,
    tcgcsvGroupId: group.groupId, groupMatchConfidence: null, needsReview: true,
    source: 'auto-detected', tcgplayerOnly: true, addedAt: nowIso,
  }
}

// `save: false` = dry run (scripts that preview what a sync would place).
export async function discoverRiftboundProducts(registry, galleryCards, rowsOf = tcgplayerRowCache(), { save = true } = {}) {
  const rb = registry?.riftbound
  if (!rb?.sets) return { newSets: [], newPlacements: [], returned: [] }
  const res = await fetch('https://tcgcsv.com/tcgplayer/89/groups', { headers: TCGCSV_HEADERS })
  if (!res.ok) throw new Error(`groups: ${res.status}`)
  const groups = (await res.json()).results ?? []
  const mainGroupIds = new Set((await getTcgcsvGroups()).map((g) => g.groupId))
  const placements = rb.placements ?? []

  // "298" → Origins: each main set's most common collector-number denominator in the gallery.
  const counts = new Map()
  for (const c of galleryCards) {
    const m = (c.publicCode ?? '').match(/^([A-Z]+)-\d+[a-z*]?\/(\d+)$/)
    if (!m) continue
    const key = `${String(parseInt(m[2], 10))}|${m[1]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const mainSetByCode = new Map(rb.sets.filter((s) => !s.tcgplayerOnly && s.setCode).map((s) => [s.setCode, s]))
  const setByDenominator = new Map()
  const best = new Map()
  for (const [key, n] of counts) {
    const [denom, code] = key.split('|')
    if (!mainSetByCode.has(code) || n <= (best.get(denom) ?? 0)) continue
    best.set(denom, n)
    setByDenominator.set(denom, mainSetByCode.get(code).setName)
  }

  const nowIso = new Date().toISOString()
  const newSets = []
  const newPlacements = []
  const placed = new Set(placements.filter((p) => !p.ignored).map((p) => String(p.productId)))
  // "Ignore" on Needs Review = ask again next sync (maybe it has a photo by then): offered again
  // as part of this sync's batch, where staff last had it (or a fresh guess).
  const ignored = new Map(placements.filter((p) => p.ignored).map((p) => [String(p.productId), p]))
  const returned = []
  for (const group of groups) {
    if (mainGroupIds.has(group.groupId)) continue
    const setsHere = rb.sets.filter((s) => s.tcgplayerOnly && s.tcgcsvGroupId === group.groupId)
    if (setsHere.some((s) => !s.tcgplayerNameFilter && !Array.isArray(s.tcgplayerProductIds))) continue // whole group is one set
    const extras = rb.sets.flatMap((s) => (s.extraTcgplayerProducts ?? []).filter((e) => e.groupId === group.groupId))
    const isPool = setsHere.length > 0 || extras.length > 0 || placements.some((p) => p.groupId === group.groupId) || POOL_GROUP_NAME.test(group.name)

    let rows
    try { rows = oneRowPerProduct(await rowsOf(group.groupId)) } catch (err) {
      console.warn(`   ⚠️  TCGCSV group ${group.groupId} (${group.name}): ${err.message}`)
      continue
    }
    if (rows.length === 0) continue // only sealed product so far — checked again next sync

    if (!isPool) {
      if (rows.length >= MAIN_SET_MIN_CARDS) continue
      if (rb.sets.some((s) => s.tcgcsvGroupId === group.groupId)) continue
      const set = newBundleSet(group, rb.sets, rb.groupOrder ?? [], nowIso)
      rb.sets.push(set)
      newSets.push(set)
      console.log(`   🆕 New TCGplayer set: ${set.setName} (${rows.length} cards, group ${group.groupId})`)
      continue
    }

    const covered = new Set(extras.flatMap((e) => (e.productIds ?? []).map(String)))
    for (const s of setsHere) {
      const only = s.tcgplayerNameFilter ? String(s.tcgplayerNameFilter).toLowerCase() : null
      const pick = new Set((s.tcgplayerProductIds ?? []).map(String))
      for (const r of rows) if ((only && r.name.toLowerCase().includes(only)) || pick.has(r.productId)) covered.add(r.productId)
    }
    for (const r of rows) {
      if (covered.has(r.productId) || placed.has(r.productId)) continue
      placed.add(r.productId)
      const prior = ignored.get(r.productId)
      if (prior) {
        Object.assign(prior, {
          ignored: false, setName: prior.setName ?? guessPlacementSet(r.extNumber, setByDenominator),
          name: r.name, number: r.extNumber, auto: true, reviewed: false, addedAt: nowIso,
        })
        returned.push(prior)
        continue
      }
      newPlacements.push({
        productId: Number(r.productId), groupId: group.groupId, groupName: group.name,
        name: r.name, number: r.extNumber, setName: guessPlacementSet(r.extNumber, setByDenominator),
        auto: true, reviewed: false, addedAt: nowIso,
      })
    }
  }
  if (newPlacements.length) console.log(`   🆕 ${newPlacements.length} new TCGplayer products placed (${newPlacements.filter((p) => !p.setName).length} left out)`)
  if (returned.length) console.log(`   ↩️  ${returned.length} ignored TCGplayer product(s) offered again`)

  if (save && (newSets.length || newPlacements.length || returned.length)) {
    rb.placements = [...placements, ...newPlacements]
    try {
      await savePlacementsOnLatest('riftbound', { added: newPlacements, reoffered: returned, newSets })
    } catch (err) {
      console.warn(`   ⚠️  Couldn't save new placements to the registry: ${err.message}`)
    }
  }
  return { newSets, newPlacements, returned }
}

// Build lookup key for a TCGPlayer product
// extNumber examples: "007a/298" (alt-art), "227/221" (overnumber), "227*/221" (signature),
// "SP3/006" (a distinct foil-only "Special" promo subset introduced in Vendetta — its own
// numbering line, unrelated to any plain-numbered card that happens to share the digit).
function tcgKey(setCode, extNumber, name) {
  const spMatch = extNumber.match(/^SP(\d+)\//i)
  if (spMatch) return `${setCode}:sp${parseInt(spMatch[1], 10)}`
  const m = extNumber.match(/^(\d+)([a*]?)\//)
  if (!m) return null
  const num = String(parseInt(m[1], 10))
  const suffix = m[2]
  const isSig = suffix === '*' || name.includes('(Signature)')
  const isAlt = suffix === 'a' || name.includes('(Alternate Art)')
  const isOver = name.includes('(Overnumbered)')
  if (isSig) return `${setCode}:${num}:star`
  if (isAlt) return `${setCode}:${num}:altart`
  if (isOver) return `${setCode}:${num}:over`
  return `${setCode}:${num}:regular`
}

// Build lookup key for a catalog card
function catalogKey(card) {
  // "SP" subset cards carry their real number only in publicCode (e.g. "VEN-SP3/006") — the
  // gallery's own `number` field is just the bare digit ("3"), which would otherwise collide
  // with an unrelated plain-numbered card sharing that same digit.
  const spMatch = (card.publicCode ?? '').match(/-SP(\d+)\//i)
  if (spMatch) return `${card.setCode}:sp${parseInt(spMatch[1], 10)}`
  const isStar = card.id.includes('-star-')
  const isOvernumbered = card.rarity === 'Overnumbered' || card.rarity === 'Showcase'
  // publicCode like "OGN-007a/298" → has 'a/' means same-number alt-art. This must NOT depend
  // on rarity === 'Alt Art'/'Showcase' — some sets' alt-arts (e.g. Vendetta) keep the base
  // card's rarity (Epic, etc.) on the gallery side, with the "a" suffix in publicCode as the
  // only signal.
  const isSameNumAlt = (card.publicCode ?? '').includes('a/')
  const num = String(parseInt(card.number, 10))
  if (isStar) return `${card.setCode}:${num}:star`
  if (isSameNumAlt) return `${card.setCode}:${num}:altart`
  if (isOvernumbered) return `${card.setCode}:${num}:over`
  return `${card.setCode}:${num}:regular`
}

// Rune cards use an R-format collector number (R01–R06, R01a–R06a, R01b–R06b). They were
// historically absent from the official playriftbound.com gallery (sourced from TCGPlayer
// only) — but Vendetta's gallery does list them (see the id-collision handling below), so this
// can no longer be assumed true for every set.
const RUNE_NAMES = { R01: 'Fury Rune', R02: 'Calm Rune', R03: 'Mind Rune', R04: 'Body Rune', R05: 'Chaos Rune', R06: 'Order Rune' }
const RUNE_TAGS  = { R01: ['Fury'],    R02: ['Calm'],    R03: ['Mind'],    R04: ['Body'],    R05: ['Chaos'],    R06: ['Order'] }
// VEN/RAD were missing here previously — any Rune sourced from TCGCSV for those sets fell back
// to the literal set code ("VEN") instead of the real name ("Vendetta").
const SET_NAMES_MAP = { OGN: 'Origins', SFD: 'Spiritforged', UNL: 'Unleashed', OGS: 'Proving Grounds', VEN: 'Vendetta', RAD: 'Radiance' }

async function fetchRiftboundPrices() {
  // Returns { prices: Map<key, {normal, foil, lowNormal, lowFoil}>, extraCards: Card[] }
  const prices = new Map()
  const runeExtras = new Map() // cardId → card object
  for (const { groupId, setCode } of await getTcgcsvGroups()) {
    try {
      const url = `https://tcgcsv.com/tcgplayer/89/${groupId}/ProductsAndPrices.csv`
      const res = await fetch(url, { headers: TCGCSV_HEADERS })
      if (!res.ok) { console.warn(`   ⚠️  TCGCSV ${setCode} failed: ${res.status}`); continue }
      const text = await res.text()
      // Read by column name, not position — TCGplayer's column order isn't fixed across groups.
      for (const row of parseCsv(text)) {
        const name       = row.name ?? ''
        const tcgImg     = tcgPhoto(row)
        const lowPrice    = parseFloat(row.lowPrice) || 0
        const marketPrice = parseFloat(row.marketPrice) || 0
        const subType    = row.subTypeName ?? ''   // 'Normal' or 'Foil'
        const extRarity  = row.extRarity ?? ''
        const extNumber  = row.extNumber ?? ''
        if (!extNumber || !name) continue

        // Rune cards: R01, R01a, R01b, R02, ... R06b
        const runeMatch = extNumber.match(/^(R\d+)([a-b]?)$/)
        if (runeMatch) {
          const baseCode  = runeMatch[1] // "R04"
          const artSuffix = runeMatch[2] // '', 'a', 'b'
          const cardId    = `${setCode.toLowerCase()}-${extNumber.toLowerCase()}`
          if (!runeExtras.has(cardId)) {
            const cleanName = RUNE_NAMES[baseCode] ?? name.replace(/\s*\([^)]+\)\s*$/, '').trim()
            runeExtras.set(cardId, {
              id: cardId,
              name: cleanName,
              number: extNumber,
              publicCode: `${setCode}-${extNumber}`,
              setCode,
              setName: SET_NAMES_MAP[setCode] ?? setCode,
              rarity: extRarity || (artSuffix ? 'Alt Art' : 'Common'),
              cardType: 'Rune',
              tags: RUNE_TAGS[baseCode] ?? [],
              imageUrl: tcgImg,
              marketPrice:      subType !== 'Foil' ? marketPrice : 0,
              marketPriceFoil:  subType === 'Foil' ? marketPrice : 0,
              lowPriceNM:       subType !== 'Foil' ? lowPrice    : 0,
              lowPriceNMFoil:   subType === 'Foil' ? lowPrice    : 0,
            })
          } else {
            const entry = runeExtras.get(cardId)
            if (subType === 'Foil') {
              entry.marketPriceFoil = Math.max(entry.marketPriceFoil, marketPrice)
              entry.lowPriceNMFoil  = entry.lowPriceNMFoil > 0 ? Math.min(entry.lowPriceNMFoil, lowPrice || Infinity) : lowPrice
            } else {
              entry.marketPrice = Math.max(entry.marketPrice, marketPrice)
              entry.lowPriceNM  = entry.lowPriceNM > 0 ? Math.min(entry.lowPriceNM, lowPrice || Infinity) : lowPrice
            }
          }
          continue
        }

        if (marketPrice === 0 && lowPrice === 0) continue
        const key = tcgKey(setCode, extNumber, name)
        if (!key) continue
        const entry = prices.get(key) ?? { normal: 0, foil: 0, lowNormal: 0, lowFoil: 0, img: '', rarity: '' }
        if (extRarity) entry.rarity = extRarity
        if (subType === 'Foil') {
          entry.foil    = marketPrice
          entry.lowFoil = lowPrice
        } else {
          entry.normal    = marketPrice
          entry.lowNormal = lowPrice
        }
        // Store TCGPlayer image for Signature stubs (star keys only need one image)
        if (key.endsWith(':star') && tcgImg) entry.img = tcgImg
        prices.set(key, entry)
      }
      // For Alt Art/Promo runes (foil-only), marketPrice = foil price
      for (const card of runeExtras.values()) {
        if (card.setCode === setCode && (card.rarity === 'Alt Art' || card.rarity === 'Promo')) {
          card.marketPrice  = card.marketPriceFoil  || card.marketPrice
          card.marketPriceFoil = 0
          card.lowPriceNM   = card.lowPriceNMFoil   || card.lowPriceNM
          card.lowPriceNMFoil = 0
        }
      }
      const priceCount = [...prices.keys()].filter(k => k.startsWith(setCode)).length
      const runeCount  = [...runeExtras.keys()].filter(k => k.startsWith(setCode.toLowerCase())).length
      console.log(`   TCGCSV ${setCode}: ${priceCount} products, ${runeCount} rune cards`)
    } catch (err) {
      console.warn(`   ⚠️  TCGCSV ${setCode} error: ${err.message}`)
    }
  }
  return { prices, extraCards: [...runeExtras.values()] }
}

function findCardsInNextData(obj, depth = 0) {
  if (depth > 10) return null
  if (Array.isArray(obj)) {
    if (obj.length > 5 && obj[0]?.cardImage) return obj
    for (const item of obj.slice(0, 10)) {
      const found = findCardsInNextData(item, depth + 1)
      if (found) return found
    }
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      const found = findCardsInNextData(val, depth + 1)
      if (found) return found
    }
  }
  return null
}

const REGULAR_RARITIES = new Set(['Common', 'Uncommon', 'Rare', 'Epic'])

export async function downloadRiftbound() {
  console.log('\n⚡ Riftbound...')

  const registry = await loadRegistry()
  const registrySets = registry?.riftbound?.sets ?? []
  const rowsOf = tcgplayerRowCache()
  const [galleryRes, { prices, extraCards }, tcgplayerOnlyCards] = await Promise.all([
    fetch('https://playriftbound.com/en-us/card-gallery/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }),
    fetchRiftboundPrices(),
    fetchTcgplayerOnlyRiftboundSets({ sets: registrySets, placements: (registry?.riftbound?.placements ?? []).filter((p) => !p.ignored), rowsOf }),
  ])

  if (!galleryRes.ok) throw new Error(`Gallery fetch failed: ${galleryRes.status} ${galleryRes.statusText}`)
  const html = await galleryRes.text()

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('__NEXT_DATA__ not found in page')

  const nextData = JSON.parse(match[1])
  const items = findCardsInNextData(nextData)
  if (!items) throw new Error('Card array not found in __NEXT_DATA__')

  console.log(`   Found ${items.length} cards from official gallery`)

  const all = items
    .filter((c) => c?.name && c?.cardImage?.url)
    .map((c) => {
      const pubCode = c.publicCode ?? ''
      const isSig = pubCode.includes('*/')
      // Same-number alt-art print: "a" suffix right before the "/NNN" denominator (e.g.
      // "UNL-022a/219"). This must NOT depend on Riot's own gallery rarity label — some sets
      // (UNL, VEN) keep the base card's rarity (Rare, Epic, etc.) on these instead of ever
      // reporting "Showcase", so publicCode's "a/" is the only reliable signal. Mirrors
      // catalogKey()'s isSameNumAlt just below, which already had to be this defensive.
      const isSameNumAlt = !isSig && pubCode.includes('a/')
      // Detect overnumber from publicCode: "UNL-234/219" where 234 > 219
      const pubNums = pubCode.match(/-(\d+)\*?\/(\d+)$/)
      const isOvernumber = !isSig && !isSameNumAlt && !!pubNums && parseInt(pubNums[1]) > parseInt(pubNums[2])
      // We call a genuine same-number alt-art print "Alt Art" in our own catalog (to
      // distinguish it from "Overnumbered", the chase variant whose collector number exceeds
      // the set's card count; both used to share the literal "Showcase" rarity value here,
      // which is what this rename fixes).
      const rarity = isSig ? 'Star'
        : isSameNumAlt ? 'Alt Art'
        : isOvernumber ? 'Overnumbered'
        : (c.rarity?.value?.label ?? '')
      const card = {
        id: c.id,
        name: isSig ? c.name + ' (Signature)' : c.name,
        number: String(c.collectorNumber ?? ''),
        publicCode: pubCode,
        setCode: c.set?.value?.id ?? '',
        setName: c.set?.value?.label ?? '',
        rarity,
        cardType: c.cardType?.type?.[0]?.label ?? '',
        // tags link thematic cards to their champion (e.g. "Deceiver" → ["LeBlanc"])
        tags: Array.isArray(c.tags?.tags) ? c.tags.tags : [],
        imageUrl: c.cardImage.url,
        marketPrice: 0,
        marketPriceFoil: 0,
        lowPriceNM: 0,
        lowPriceNMFoil: 0,
      }
      const key = catalogKey(card)
      const p = prices.get(key)
      if (p) {
        // "SP" cards are foil-only listings on TCGPlayer (no Normal row exists for them at all)
        // even though Riot's own gallery still classifies their in-game rarity as e.g. Epic —
        // that's an expected mismatch between game-rules rarity and TCGPlayer's print tier, not
        // a bug, so treat them like Showcase/Star for price-slotting without touching `rarity`.
        // Overnumbered is deliberately NOT included here — unlike Alt Art/Star, it prints like a
        // regular card (not foil-only; see lib/utils.ts's riftboundInherentFoil(), which returns
        // false for Overnumbered specifically). Including it used to make a foil TCGPlayer
        // listing silently win over the normal price for every Overnumbered card that had one.
        const isShowcaseOrStar = card.rarity === 'Alt Art' || card.id.includes('-star-') || key.includes(':sp')
        card.marketPrice     = isShowcaseOrStar ? (p.foil    || p.normal)    : (p.normal    || p.foil)
        card.marketPriceFoil = isShowcaseOrStar ? 0           : p.foil
        card.lowPriceNM      = isShowcaseOrStar ? (p.lowFoil || p.lowNormal) : (p.lowNormal || p.lowFoil)
        card.lowPriceNMFoil  = isShowcaseOrStar ? 0           : p.lowFoil
        // Riot's gallery occasionally has a regular card's rarity wrong — six Vendetta cards
        // (Otterpus and Mask Mother/Dragon Form listed Uncommon, Lacerate/Ravenbloom Prefect/
        // Patched Porobot listed Common), where TCGplayer and the printed cards agree on the
        // opposite. When both sides name one of the four regular tiers and disagree, TCGplayer
        // wins. Variant rarities (Alt Art, Overnumbered, Star) are ours and never touched.
        if (REGULAR_RARITIES.has(card.rarity) && REGULAR_RARITIES.has(p.rarity) && card.rarity !== p.rarity) {
          card.rarity = p.rarity
        }
      }
      return card
    })

  // Append extra cards (Runes etc.) sourced from TCGCSV rather than the official gallery.
  // Some sets' galleries (e.g. Vendetta) DO also list a Rune under the same id, but with a
  // bogus bare-digit `collectorNumber` (Riot's gallery data isn't Rune-aware) — e.g. gallery
  // "ven-r02" gets number "2" instead of the correct "R02" that TCGCSV's extNumber carries.
  // When ids collide, the TCGCSV-derived version always wins for numbering purposes: replace
  // the gallery entry instead of skipping the extra, rather than assuming (as before) that a
  // colliding id always means the gallery already has it right.
  //
  // extraCards were built inside fetchRiftboundPrices(), which runs in parallel with the
  // gallery fetch above and so had no gallery data yet — their `setName` came from the
  // hardcoded SET_NAMES_MAP, which needs a code change for every new set. Patch it here from
  // this SAME run's own gallery scrape instead, now that `all` (real gallery cards, one per set)
  // is available — this is the one Riftbound source that already has to stay code-free for a
  // new set to work at all, so piggyback on it rather than needing SET_NAMES_MAP kept in sync
  // too. SET_NAMES_MAP stays only as the last-resort fallback for a set with zero gallery cards
  // (shouldn't happen for anything with an actual Rune, but cheap insurance).
  const setNameByCode = new Map(all.map((c) => [c.setCode, c.setName]).filter(([, name]) => name))
  for (const extra of extraCards) {
    extra.setName = setNameByCode.get(extra.setCode) ?? SET_NAMES_MAP[extra.setCode] ?? extra.setCode
  }

  const galleryIndexById = new Map(all.map((c, i) => [c.id, i]))
  for (const extra of extraCards) {
    const existingIndex = galleryIndexById.get(extra.id)
    if (existingIndex === undefined) { all.push(extra); continue }
    // Riot's own art beats TCGplayer's product photo (often still missing for new runes).
    if (all[existingIndex].imageUrl) extra.imageUrl = all[existingIndex].imageUrl
    all[existingIndex] = extra
  }

  // Create Signature (Star) stubs from TCGCSV price entries.
  // Signatures are signed premium variants that never appear on the official gallery.
  // For each star price key (e.g. "OGN:227:star"), find the base regular card and
  // clone it with a new id, Star rarity, and the foil price.
  const allById = new Map(all.map((c) => [c.id, c]))
  let starCount = 0
  // Ids of TCGCSV-synthesized stubs from a PAST run that the gallery has since caught up on —
  // see the `hasGalleryStar` branch below. Reported to syncToFirestore() to hide, not just left
  // to silently accumulate as stale, permanently-orphaned duplicates (see that call's comment).
  const supersededStubIds = []
  for (const [key, p] of prices.entries()) {
    if (!key.endsWith(':star')) continue
    const [setCode, num] = key.split(':')
    const starId = `${setCode.toLowerCase()}-${num}-star`
    if (allById.has(starId)) continue
    // Skip if gallery already has a star card for this set+number (publicCode contains */).
    // Real bug this guards against, caught in production: Vendetta's Signature cards weren't on
    // the gallery yet during VEN's first few syncs, so this loop synthesized stubs for them
    // (id like "ven-189-star"). Once Riot's gallery caught up, it started providing REAL
    // Signature cards under Riot's own id ("ven-189-star-166" — a different id, since it's the
    // gallery's own scheme, not this synthetic one) — this guard correctly stopped creating NEW
    // stubs at that point, but the OLD stub id was already in Firestore and nothing here ever
    // touched it again (it's simply absent from every subsequent run's freshly-scraped `all`, so
    // syncToFirestore()'s diff loop has nothing to compare it against) — a permanently stale,
    // duplicate-priced card sitting right next to the real one forever. `supersededStubIds` is
    // how this is now actually fixed instead of just not made worse.
    const hasGalleryStar = all.some(
      (c) => c.setCode === setCode && String(parseInt(c.number, 10)) === num && (c.publicCode ?? '').includes('*/')
    )
    if (hasGalleryStar) { supersededStubIds.push(starId); continue }
    // Prefer a plain (non-Alt Art/Overnumbered) sibling at this number as the clone template,
    // but some "Legend" champions (e.g. Renekton - Butcher of the Sands) only ever appear at
    // this exact number as the Alt Art/Overnumbered printing — their Signature is a signed
    // version of THAT art, not a separate plain card, so fall back to allowing it once no plain
    // sibling exists (still never cloning from an existing Star, to avoid double-synthesis).
    const notStar = (c) => c.setCode === setCode && String(parseInt(c.number, 10)) === num && c.rarity !== 'Star' && !c.id.includes('-star')
    const baseCard = all.find((c) => notStar(c) && c.rarity !== 'Alt Art' && c.rarity !== 'Overnumbered') ?? all.find(notStar)
    if (!baseCard) continue
    const starCard = {
      ...baseCard,
      id: starId,
      name: baseCard.name + ' (Signature)',
      rarity: 'Star',
      // The base card's publicCode (e.g. "VEN-190/166") doesn't carry a signature marker —
      // insert "*" right before the trailing "/NNN" so this stub's publicCode matches the
      // "190*/166" convention real gallery-sourced signatures already have.
      publicCode: baseCard.publicCode ? baseCard.publicCode.replace(/\/(\d+)$/, '*/$1') : baseCard.publicCode,
      imageUrl: p.img || baseCard.imageUrl,
      // These ultra-low-volume listings often have no TCGPlayer "market price" yet (insufficient
      // recent sales) — only low/mid/high estimates. Falling back to the low price beats showing
      // a misleading $0 for a card that's actually worth hundreds.
      marketPrice: p.foil || p.normal || p.lowFoil || p.lowNormal,
      marketPriceFoil: 0,
      lowPriceNM: p.lowFoil || p.lowNormal,
      lowPriceNMFoil: 0,
    }
    all.push(starCard)
    allById.set(starId, starCard)
    starCount++
  }
  if (starCount > 0) console.log(`   Created ${starCount} Signature (Star) stubs from TCGCSV`)

  // New TCGplayer groups/products since the last sync — placed, built and saved for review.
  let discovered = { newSets: [], newPlacements: [], returned: [] }
  try {
    discovered = await discoverRiftboundProducts(registry, all, rowsOf)
    tcgplayerOnlyCards.push(...await fetchTcgplayerOnlyRiftboundSets({
      sets: discovered.newSets, placements: [...discovered.newPlacements, ...discovered.returned], allSets: registrySets, rowsOf,
    }))
  } catch (err) {
    console.warn(`   ⚠️  Looking for new TCGplayer products failed: ${err.message}`)
  }
  // A product staff denied (or the sync couldn't place) is hidden if it was ever a card — and,
  // being in `placements`, never offered again.
  // (Read after discovery, which brings ignored ones back.) Ignored ones stay hidden until offered again.
  const leftOutIds = (registry?.riftbound?.placements ?? []).filter((p) => !p.setName || p.ignored).map((p) => `tcg-${p.productId}`)
  const returnedIds = discovered.returned.filter((p) => p.setName).map((p) => `tcg-${p.productId}`)

  useGalleryArtForPhotoless(tcgplayerOnlyCards, all)
  all.push(...tcgplayerOnlyCards)

  all.sort((a, b) => {
    const setDiff = (SET_ORDER[a.setCode] ?? 99) - (SET_ORDER[b.setCode] ?? 99)
    if (setDiff !== 0) return setDiff
    const aNum = parseInt(a.number, 10)
    const bNum = parseInt(b.number, 10)
    const aIsR = isNaN(aNum)
    const bIsR = isNaN(bNum)
    if (!aIsR && !bIsR) return aNum - bNum
    if (aIsR && bIsR) return String(a.number).localeCompare(String(b.number))
    return aIsR ? 1 : -1  // R-format cards sort after numeric cards
  })

  const priced = all.filter(c => c.marketPrice > 0).length
  console.log(`   Priced ${priced}/${all.length} cards from TCGCSV`)
  const result = await syncToFirestore('riftbound', all, { hideIds: [...supersededStubIds, ...leftOutIds], unhideIds: returnedIds })
  return { ...result, discovered }
}

// ── One Piece ─────────────────────────────────────────────────────────────────
// Primary:   tcgcsv.com category 68 (TCGplayer) — every card is one TCGplayer product (+ finish),
//            linked by `tcgProductId` saved on the card
// Secondary: github.com/apitcg/one-piece-tcg-data — names, rarities and set names for its cards,
//            and the version descriptions the secondary check compares against
// How the two are put together: scripts/lib/onepiece-tcgplayer.mjs. Existing cards never change
// what they show (photo, name, set); only prices refresh, from the product they show.

const ONEPIECE_TCGCSV_HEADERS = {
  // tcgcsv blocks disguised browser User-Agents ("Please identify your application") — name the app.
  'User-Agent': 'TCGHaven/1.0 (+https://tcghaven.org)',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
}

// apitcg's cards, deduped by id. apitcg repeats cards across files (general.json re-lists all of
// EB-01), so files are processed in name order and the first copy wins — download order varied.
async function fetchApitcgOnePiece() {
  const files = await fetchJSON(
    'https://api.github.com/repos/apitcg/one-piece-tcg-data/contents/cards/en',
    githubApiHeaders({ Accept: 'application/vnd.github.v3+json' })
  )
  const results = await Promise.all(files.filter((f) => f.name.endsWith('.json')).map(async (file) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return [file.name, await fetchJSON(file.download_url)] } catch (err) {
        if (attempt === 2) { console.warn(`   ⚠️  Skipped ${file.name}: ${err.message}`); return [file.name, []] }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
      }
    }
  }))
  results.sort((a, b) => a[0].localeCompare(b[0]))
  const seen = new Set()
  const cards = []
  for (const [, list] of results) {
    for (const c of Array.isArray(list) ? list : []) {
      if (!c?.id || !c?.code || !c?.name || seen.has(c.id)) continue
      seen.add(c.id)
      cards.push(c)
    }
  }
  return cards
}

async function fetchTcgplayerOnePiece() {
  const groups = (await fetchJSON('https://tcgcsv.com/tcgplayer/68/groups', ONEPIECE_TCGCSV_HEADERS)).results ?? []
  if (groups.length < 50) throw new Error(`TCGplayer returned ${groups.length} One Piece groups — not syncing against a partial list`)
  const productsByGroup = new Map()
  const failedGroupIds = new Set()
  for (let i = 0; i < groups.length; i += 20) {
    await Promise.all(groups.slice(i, i + 20).map(async (g) => {
      let csv = null
      for (let attempt = 0; attempt < 3 && csv === null; attempt++) {
        try { csv = await fetchText(`https://tcgcsv.com/tcgplayer/68/${g.groupId}/ProductsAndPrices.csv`, ONEPIECE_TCGCSV_HEADERS) } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
      if (csv === null) { failedGroupIds.add(g.groupId); return }
      productsByGroup.set(g.groupId, opProductsFromRows(parseCsv(csv)))
    }))
  }
  if (failedGroupIds.size > groups.length * 0.1) {
    throw new Error(`${failedGroupIds.size}/${groups.length} TCGplayer One Piece groups failed to download — not syncing a partial catalog`)
  }
  return { groups, productsByGroup, failedGroupIds }
}

/** What a One Piece sync would write, without writing (scripts/onepiece-source-report.mjs uses it too). */
export async function planOnePieceCatalog() {
  const [apiCards, tcg, snap] = await Promise.all([
    fetchApitcgOnePiece(),
    fetchTcgplayerOnePiece(),
    getDocs(collection(db, 'catalog', 'onepiece', 'cards')),
  ])
  const existing = new Map(snap.docs.map((d) => [d.id, d.data()]))
  const built = buildOnePieceCatalog({ apiCards, groups: tcg.groups, productsByGroup: tcg.productsByGroup, existing, failedGroupIds: tcg.failedGroupIds })
  const r = built.report
  console.log(`   apitcg: ${apiCards.length} versions · TCGplayer: ${tcg.groups.length} groups${tcg.failedGroupIds.size ? ` (${tcg.failedGroupIds.size} failed)` : ''} · ${existing.size} existing cards kept as they are · ${r.newCards} new · ${r.reviewCards} for review · ${r.mismatches.length} set text ≠ photo (reported)`)
  return { ...built, existing, apiCards, tcg }
}

export async function downloadOnePiece() {
  console.log('\n🏴‍☠️  One Piece...')
  const plan = await planOnePieceCatalog()

  // Cards from TCGplayer's promo buckets go through Needs Review (accept / ignore / deny / move)
  const promoById = new Map()
  for (const card of plan.cards) {
    if (!card._review) continue
    delete card._review
    promoById.set(card.id, card)
  }
  const groupNames = plan.tcg.groups.map((g) => ({ groupId: g.groupId, setName: g.name }))
  const review = await reviewTcgplayerPromos('onepiece', promoById, groupNames)
  const reviewed = new Map(review.cards.map((c) => [c.id, { ...c, fromReview: true }]))
  const cards = plan.cards
    .filter((c) => !promoById.has(c.id) || reviewed.has(c.id))
    .map((c) => { const out = reviewed.get(c.id) ?? c; delete out._groupId; return out })

  cards.sort((a, b) => String(a.set ?? '').localeCompare(String(b.set ?? '')) || (parseInt(a.number, 10) - parseInt(b.number, 10)))
  const result = await syncToFirestore('onepiece', cards, { hideIds: review.hideIds, unhideIds: review.unhideIds })
  return {
    ...result, setCodesBySetName: plan.setCodesBySetName, newPlacements: review.newPlacements,
    sourceReport: { at: new Date().toISOString(), newCards: plan.report.newCards, reviewCards: plan.report.reviewCards, mismatches: plan.report.mismatches.length, lostProducts: plan.report.lostProducts.length },
  }
}

// ── Magic: The Gathering ────────────────────────────────────────────────────────
// Card data + prices: api.scryfall.com — a free, no-key public API that (unlike every other
// game here) returns prices AND images directly on the card object itself, so there's no
// separate TCGCSV/tcgcsv-style price-merge pass needed at all: one bulk-data fetch is the whole
// sync. Closest existing shape to Lorcana's Phase 1/2 (lorcast also returns prices inline), just
// without a Phase 3 promo-groups step — Scryfall's bulk file already includes everything.
//
// "default_cards" bulk data = one object per distinct printing (every reprint counted
// separately, same "one catalog row per physical card" model Pokemon/Lorcana/Riftbound/One
// Piece all use) — as opposed to "oracle_cards" (one row per unique card, no reprint/finish
// granularity) or "all_cards" (every language variant too, unnecessarily huge). As of this
// writing it's a ~75MB gzipped .jsonl file (one JSON object per line, NOT a single JSON array —
// Scryfall's bulk-data listing exposes this as `jsonl_download_uri`, not `download_uri`; verify
// this is still current if you touch this code, since Scryfall has changed this format before)
// covering 100k+ printings and only grows — see the maxDuration comment on
// app/api/sync/mtg/route.ts for why a full sync is expected to need `npm run download-cards`
// locally rather than the Admin Catalog button on most Vercel plans, the same caveat Pokemon's
// sync already carries for a similar (if smaller-scale) reason.
//
// Filtering: `games.includes('paper')` excludes Arena/MTGO-only printings (this alone already
// excludes every purely-digital "Alchemy" set, since none of its cards are ever in `games`
// alongside 'paper'). MTG_EXCLUDED_SET_TYPES additionally drops token/memorabilia/art_series/
// minigame sets — real paper products, but not "cards" in the collecting sense (see
// lib/api/mtg.ts, which keeps the same blocklist for the live /sets picker so it never offers a
// set with zero cataloged cards in it).

const MTG_EXCLUDED_SET_TYPES = new Set(['token', 'memorabilia', 'art_series', 'minigame'])

// Scryfall rejects any request missing BOTH a User-Agent and an Accept header (plain 400 — see
// lib/api/mtg.ts's SCRYFALL_HEADERS, duplicated here across the runtime boundary on purpose, same
// reasoning as this file's other per-source header constants).
const SCRYFALL_HEADERS = { 'User-Agent': 'TCGHaven/1.0', Accept: 'application/json' }

export async function downloadMTG() {
  console.log('\n🔮 Magic: The Gathering...')
  const all = await planMtgCatalog()
  return syncToFirestore('mtg', all)
}

/** Scryfall's cards as catalog cards — what an MTG sync writes (scripts/mtg-source-report.mjs uses it too). */
export async function planMtgCatalog() {

  // ── Find and stream-parse the "default_cards" bulk data file ───────────────
  const bulkList = await fetchJSON('https://api.scryfall.com/bulk-data', SCRYFALL_HEADERS)
  const bulkEntry = (bulkList.data ?? []).find((b) => b.type === 'default_cards')
  if (!bulkEntry) throw new Error('Scryfall bulk-data listing has no "default_cards" entry')
  console.log(`   Downloading bulk data (${(bulkEntry.compressed_size / 1024 / 1024).toFixed(0)}MB gzipped)...`)

  const gzipRes = await fetch(bulkEntry.jsonl_download_uri, { headers: SCRYFALL_HEADERS })
  if (!gzipRes.ok) throw new Error(`Bulk data download failed: ${gzipRes.status} ${gzipRes.statusText}`)

  // The file is gzip-compressed (Content-Type: application/gzip, no Content-Encoding header for
  // fetch to auto-decompress) AND, decompressed, exceeds V8's ~512MB max string length — so this
  // can't be read into one buffer/string like every other game's fetchJSON()/fetchText() calls.
  // Stream it: gunzip -> readline, one JSON object per line, filtering/mapping as lines arrive
  // rather than materializing the full 100k+-entry array before touching any of it.
  const gunzip = zlib.createGunzip()
  // An 'error' event with no listener is an uncaught exception in Node — a network interruption
  // or a corrupt gzip chunk mid-stream would otherwise crash the whole process (not just reject
  // a promise this function's own try/catch could handle), taking down a long-running Vercel
  // function ungracefully instead of surfacing as this sync's ordinary failure response.
  let streamError = null
  gunzip.on('error', (err) => { streamError = err })
  Readable.fromWeb(gzipRes.body).pipe(gunzip)
  const rl = readline.createInterface({ input: gunzip, crlfDelay: Infinity })

  const all = []
  let total = 0
  let skipped = 0
  for await (const line of rl) {
    if (streamError) throw streamError
    if (!line) continue
    total++
    let c
    try {
      c = JSON.parse(line)
    } catch {
      // One malformed line out of 100k+ shouldn't abort a sync that already has tens of
      // thousands of good cards parsed in memory — skip it and keep going.
      skipped++
      continue
    }
    if (!c?.name || !c?.set || !c?.collector_number) continue
    if (!Array.isArray(c.games) || !c.games.includes('paper')) continue // Arena/MTGO-only printing
    if (MTG_EXCLUDED_SET_TYPES.has(c.set_type)) continue

    // Double-faced/split/adventure cards carry images per-face instead of top-level — fall back
    // to the front face's image. `prices` is always top-level regardless of layout.
    const imageUrl =
      c.image_uris?.normal ?? c.image_uris?.large ??
      c.card_faces?.[0]?.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large ?? ''
    if (!imageUrl) continue

    all.push({
      id: c.id, // Scryfall's own UUID — already globally unique, no set-prefixing needed
      name: c.name, // Scryfall already combines multi-faced names as "Front // Back"
      set: c.set,
      setName: c.set_name,
      number: String(c.collector_number),
      rarity: c.rarity ?? '',
      imageUrl,
      marketPrice: parseFloat(c.prices?.usd) || 0,
      // usd_etched covers etched-only foil treatments that have no usd_foil price at all
      marketPriceFoil: parseFloat(c.prices?.usd_foil) || parseFloat(c.prices?.usd_etched) || 0,
    })
  }
  if (streamError) throw streamError
  console.log(`   ${total} total printings from Scryfall, ${all.length} kept after filtering (excluded digital-only/token/art/memorabilia)${skipped ? `, ${skipped} unparseable line(s) skipped` : ''}`)

  all.sort((a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number, undefined, { numeric: true }))
  return all
}
