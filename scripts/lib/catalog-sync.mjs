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
  getFirestore, collection, doc, getDoc, getDocs, setDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { normSetName } from './text-norm.mjs'

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

async function syncToFirestore(game, freshCards, { hideIds = [] } = {}) {
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
      writes.push({ id: card.id, data: { ...card, hidden: false, updatedAt: serverTimestamp() } })
      newCardIds.push(card.id)
      continue
    }

    const editedSinceLastSync =
      lastBulkSyncAt && existing.updatedAt && existing.updatedAt.toMillis() > lastBulkSyncAt.toMillis()
    if (editedSinceLastSync) continue // an admin correction happened since — never clobber it

    const changed = {}
    for (const key of Object.keys(card)) {
      if (JSON.stringify(existing[key]) !== JSON.stringify(card[key])) changed[key] = card[key]
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

  if (writes.length > 0) {
    for (const batchOps of chunk(writes, 450)) { // headroom under Firestore's 500-op batch cap
      const batch = writeBatch(db)
      for (const { id, data } of batchOps) batch.set(doc(db, 'catalog', game, 'cards', id), data, { merge: true })
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
  if (checkCandidates.length > 0) {
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
  await setDoc(metaRef, { lastBulkSyncAt: serverTimestamp(), brokenImageIds }, { merge: true })

  return {
    setNames: [...new Set(finalCards.map((c) => c.setName).filter(Boolean))],
    cards: finalCards,
    newSetNames,
    totalBrokenImages: brokenImageIds.length,
    newlyBrokenImages: newlyBrokenImages.length,
    newlyFixedImages: newlyFixedImages.length,
  }
}

// The set registry (formerly data/set-registry.json, now Firestore's registry/main doc — see
// lib/api/registry.ts for the cached TS-side reader/writer real routes should prefer). This
// module only reads it for Riftbound's tcgcsvGroupId bootstrap-merge below, always live
// (uncached) since a route may have just updated it earlier in the same request.
async function loadRegistry() {
  try {
    const snap = await getDoc(doc(db, 'registry', 'main'))
    return snap.exists() ? snap.data() : null
  } catch {
    return null
  }
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

// Parse a tcgcsv CSV text into row objects using the header row. Delegates the actual field
// splitting to parseCSVLine (defined below, hoisted — this is an .mjs file, function
// declarations hoist the same as CommonJS) rather than its own copy of the same state machine:
// this one used to just toggle on every `"`, which misaligns columns on any field containing an
// escaped `""` (TCGPlayer product names occasionally have one) — parseCSVLine already handles
// that correctly, so there's no reason for two parsers with different correctness here.
function parseCsv(text) {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const row = {}
    for (let j = 0; j < headers.length; j++) row[headers[j]] = (cols[j] ?? '').trim()
    rows.push(row)
  }
  return rows
}

// Normalize a card number for matching: "001/195" → "1", "TG01/TG30" → "TG1"
function normCardNum(n) {
  const base = String(n ?? '').split('/')[0].trim()
  return base.replace(/^([A-Za-z]*)0*(\d+)([a-z]?)$/, (_, alpha, digits, suffix) =>
    alpha.toUpperCase() + parseInt(digits, 10) + suffix
  ) || base
}

// ── Pokemon ───────────────────────────────────────────────────────────────────
// Card data: github.com/PokemonTCG/pokemon-tcg-data (all sets, raw CDN, no rate limit)
// Prices:    tcgcsv.com category 3 (TCGPlayer mirror, daily updates, no API key)

export async function downloadPokemon() {
  console.log('\n🎴 Pokemon TCG...')

  // ── Phase 1: Card data from GitHub ──────────────────────────────────────────
  const sets = await fetchJSON(
    'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json'
  )
  const setNameById = Object.fromEntries(sets.map((s) => [s.id, s.name]))
  console.log(`   ${sets.length} sets found`)

  const files = await fetchJSON(
    'https://api.github.com/repos/PokemonTCG/pokemon-tcg-data/contents/cards/en',
    githubApiHeaders({ Accept: 'application/vnd.github.v3+json' })
  )

  const all = []
  let done = 0
  await Promise.all(
    files.map(async (file) => {
      const setId = file.name.replace('.json', '')
      try {
        const cards = await fetchJSON(file.download_url)
        for (const c of cards) {
          if (!c?.name || !c?.images?.small) continue
          all.push({
            id: `${setId}-${c.number}`,
            name: c.name,
            set: setId,
            setName: setNameById[setId] ?? setId,
            number: String(c.number ?? ''),
            // Not every card has one (mostly Basic Energy, plus a handful of promo-only sets
            // like McDonald's Collections) — '' rather than omitting the field entirely, so
            // syncToFirestore()'s field-level diffing (comparing JSON.stringify per key) always
            // has something to compare and this can't silently vanish on a later resync.
            rarity: c.rarity ?? '',
            imageUrl: c.images.large ?? c.images.small,
            marketPrice: 0,
            marketPriceFoil: 0,
            lowPriceNM: 0,
            lowPriceNMFoil: 0,
          })
        }
      } catch (err) {
        console.warn(`   ⚠️  Skipped ${file.name}: ${err.message}`)
      }
      done++
      if (done % 20 === 0) process.stdout.write(`   ${done}/${files.length} sets...\r`)
    })
  )
  console.log(`   ${all.length} cards from GitHub`)

  // ── Phase 2: Prices from tcgcsv.com (category 3 = Pokemon) ─────────────────
  const TCGP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://tcgcsv.com/',
    'Accept': 'application/json,text/csv,*/*',
  }
  console.log('   Fetching prices from tcgcsv.com...')
  try {
    // Build normalized name → setId map from GitHub data
    // "Silver Tempest" → "swsh12"
    const nameToSetId = new Map()
    for (const s of sets) {
      nameToSetId.set(normSetName(s.name), s.id)
    }

    // Fetch all TCGPlayer groups for Pokemon
    const groupData = await fetchJSON('https://tcgcsv.com/tcgplayer/3/groups', TCGP_HEADERS)
    const groups = groupData.results ?? []

    // setId lookup for abbreviation matching
    const setIdSet = new Set(sets.map((s) => s.id))

    // Map tcgcsv groupId → GitHub setId
    const groupToSetId = new Map()
    for (const g of groups) {
      // Strategy 1: strip set-code prefix like "SWSH12: " / "SV07: " / "SV: "
      const stripped = g.name.replace(/^[A-Z0-9]+:\s*/i, '').trim()
      // Also try stripping known subset suffixes
      const stripped2 = stripped.replace(/\s+(Trainer Gallery|Shiny Vault|Galarian Gallery|Radiant Collection|Classic Collection)$/i, '').trim()
      const nameCandidates = [stripped, stripped2, g.name]
      let matched = false
      for (const v of nameCandidates) {
        const norm = normSetName(v)
        if (nameToSetId.has(norm)) {
          groupToSetId.set(g.groupId, nameToSetId.get(norm))
          matched = true
          break
        }
      }
      // Strategy 2: match by abbreviation (strip leading zeros from numeric suffix)
      // "SWSH01" → "swsh1", "SM01" → "sm1"
      if (!matched && g.abbreviation) {
        const abbrev = g.abbreviation.toLowerCase()
          .replace(/^([a-z]+)0*([1-9]\d*)$/, '$1$2')  // swsh01 → swsh1
        if (setIdSet.has(abbrev)) {
          groupToSetId.set(g.groupId, abbrev)
          matched = true
        }
      }
    }
    console.log(`   Matched ${groupToSetId.size}/${groups.length} TCGPlayer groups to GitHub sets`)

    // Download price CSVs in parallel batches of 20
    // priceMap key: `${setId}:${normalizedNumber}` → {normal, holofoil, reverseHolo}
    const priceMap = new Map()
    const groupEntries = [...groupToSetId.entries()]
    const BATCH = 20
    for (let i = 0; i < groupEntries.length; i += BATCH) {
      const batch = groupEntries.slice(i, i + BATCH)
      await Promise.all(
        batch.map(async ([groupId, setId]) => {
          try {
            const csv = await fetchText(`https://tcgcsv.com/tcgplayer/3/${groupId}/ProductsAndPrices.csv`, TCGP_HEADERS)
            const rows = parseCsv(csv)
            for (const row of rows) {
              const extNum = row.extNumber ?? ''
              if (!extNum || !/^[A-Z0-9]*\d/.test(extNum)) continue
              const num = normCardNum(extNum)
              const key = `${setId}:${num}`
              if (!priceMap.has(key)) priceMap.set(key, { normal: 0, holofoil: 0, reverseHolo: 0, lowNormal: 0, lowHolofoil: 0, lowReverseHolo: 0 })
              const entry = priceMap.get(key)
              const price    = parseFloat(row.marketPrice) || parseFloat(row.midPrice) || 0
              const lowPrice = parseFloat(row.lowPrice) || 0
              const sub = row.subTypeName ?? ''
              if (sub === 'Normal') { if (price > 0) entry.normal = price; if (lowPrice > 0) entry.lowNormal = lowPrice }
              else if (sub === 'Holofoil') { if (price > 0) entry.holofoil = price; if (lowPrice > 0) entry.lowHolofoil = lowPrice }
              else if (sub === 'Reverse Holofoil') { if (price > 0) entry.reverseHolo = price; if (lowPrice > 0) entry.lowReverseHolo = lowPrice }
              else if (!entry.normal && !entry.holofoil && price > 0) { entry.normal = price; if (lowPrice > 0) entry.lowNormal = lowPrice }
            }
          } catch {
            // silently skip groups that fail — card still appears with $0 price
          }
        })
      )
      process.stdout.write(`   Prices: ${Math.min(i + BATCH, groupEntries.length)}/${groupEntries.length} sets...\r`)
    }

    // Merge prices into cards
    let priced = 0
    for (const card of all) {
      const num = normCardNum(card.number)
      const key = `${card.set}:${num}`
      const p = priceMap.get(key)
      if (p) {
        card.marketPrice     = p.normal       || p.holofoil    || 0
        card.marketPriceFoil = p.holofoil     || p.reverseHolo || 0
        card.lowPriceNM      = p.lowNormal    || p.lowHolofoil || 0
        card.lowPriceNMFoil  = p.lowHolofoil  || p.lowReverseHolo || 0
        if (card.marketPrice > 0 || card.marketPriceFoil > 0) priced++
      }
    }
    console.log(`   Prices found for ${priced}/${all.length} cards`)
  } catch (err) {
    console.warn(`   ⚠️  Price fetch failed: ${err.message} — catalog saved without prices`)
  }

  all.sort((a, b) => a.set.localeCompare(b.set) || a.number.localeCompare(b.number, undefined, { numeric: true }))
  return syncToFirestore('pokemon', all)
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
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
}

// Minimal CSV parser that handles quoted fields
function parseCSVLine(line) {
  const fields = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) {
      fields.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
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
      const lines = (await res.text()).split('\n')
      if (lines.length === 0) return
      // TCGPlayer's CSV column layout is NOT fixed across groups — a group containing only
      // sealed product (booster boxes, cases, troves — no actual cards, e.g. "Hyperia City")
      // has no extRarity/extNumber columns at all, since those are per-card fields. Reading by
      // fixed index there would silently grab price columns instead (that's exactly how price
      // values like "199.62" ended up in the `rarity` field). Look columns up by header name
      // instead: real card groups resolve every name below; sealed-goods-only groups resolve
      // extRarity/extNumber to -1, so every row in them is skipped by the guard further down.
      const header = parseCSVLine(lines[0]).map((h) => h.trim())
      const col = (name) => header.indexOf(name)
      const idx = {
        productId: col('productId'), name: col('name'), imageUrl: col('imageUrl'),
        extRarity: col('extRarity'), extNumber: col('extNumber'),
        marketPrice: col('marketPrice'), midPrice: col('midPrice'), subTypeName: col('subTypeName'),
      }
      // Buffer candidate rows first — whether this group's unmatched cards actually get kept
      // depends on the group-wide ratio computed after this loop, not decided per-row.
      const candidates = []
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const f = parseCSVLine(line)
        const get = (i) => (i >= 0 ? f[i]?.trim() ?? '' : '')
        const productId   = get(idx.productId)
        const name        = get(idx.name)
        const imageUrl    = get(idx.imageUrl).replace('_200w.jpg', '_400w.jpg')
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

  // Merge promo cards into the main seen map
  for (const [id, card] of promoByProductId) {
    seen.set(id, card)
  }

  const merged = [...seen.values()]
  merged.sort((a, b) =>
    a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number, undefined, { numeric: true })
  )
  return syncToFirestore('lorcana', merged)
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
    if (s.setCode && typeof s.tcgcsvGroupId === 'number') merged.set(s.setCode, s.tcgcsvGroupId)
  }
  return [...merged.entries()].map(([setCode, groupId]) => ({ groupId, setCode }))
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
      const lines = text.split('\n')
      // header: productId,name,cleanName,imageUrl,categoryId,groupId,url,modifiedOn,
      //         imageCount,lowPrice,midPrice,highPrice,marketPrice,directLowPrice,
      //         subTypeName,extRarity,extNumber,...
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const f = parseCSVLine(line)
        const name       = f[1]  ?? ''
        const tcgImg     = f[3]  ?? ''
        const lowPrice    = parseFloat(f[9])  || 0
        const marketPrice = parseFloat(f[12]) || 0
        const subType    = f[14] ?? ''   // 'Normal' or 'Foil'
        const extRarity  = f[15] ?? ''
        const extNumber  = f[16] ?? ''
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
        const entry = prices.get(key) ?? { normal: 0, foil: 0, lowNormal: 0, lowFoil: 0, img: '' }
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

export async function downloadRiftbound() {
  console.log('\n⚡ Riftbound...')

  const [galleryRes, { prices, extraCards }] = await Promise.all([
    fetch('https://playriftbound.com/en-us/card-gallery/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }),
    fetchRiftboundPrices(),
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
    if (existingIndex === undefined) all.push(extra)
    else all[existingIndex] = extra
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
  return syncToFirestore('riftbound', all, { hideIds: supersededStubIds })
}

// ── One Piece ─────────────────────────────────────────────────────────────────
// Card data: github.com/apitcg/one-piece-tcg-data (community-maintained, MIT-shaped like
// PokemonTCG/pokemon-tcg-data — one JSON file per set/bucket in cards/en/, no API key, no rate
// limit beyond plain GitHub raw-content serving). Each file already includes every print
// variant as its own entry: a base card "OP01-024" and its "Parallel" alt-art reprint(s)
// "OP01-024_p1", "OP01-024_p2", ... are separate array entries with the same `code`.
//
// Prices: tcgcsv.com category 68. Unlike the other three games, price matching needs no
// per-set group-ID bootstrap and no fuzzy set-name matching at all — tcgcsv's `extNumber`
// column is *literally* the same card code apitcg uses ("OP01-024"), so cards match across
// the two sources by an exact string compare, with zero normalization. There's also no
// external "sets" list to reconcile against (unlike Pokemon's live api.pokemontcg.io): the
// registry entries for One Piece are themselves derived from whatever `set.name` values show
// up in the scraped cards — see app/api/sync/onepiece/route.ts, which backfills new registry
// entries the same way Riftbound's sync route does (Riftbound has no live sets API either).
//
// The one genuine approximation here: TCGPlayer doesn't structurally tag which product row is
// the "regular" print vs which numbered Parallel it is — only the product *name* contains
// "(Parallel)" (and occasionally more descriptive suffixes like "(Parallel) (Manga) (Alternate
// Art)"). Rows for a given code are sorted with non-Parallel-named rows first, then
// Parallel-named ones, and only *within* those two groups by productId ascending (a reasonable
// proxy for catalog/release order when nothing else distinguishes multiple Parallels of the same
// card) — matched positionally to apitcg's own base/_p1/_p2/... ordering. productId ascending
// alone is NOT reliable as the sole signal: it briefly shipped that way and mispriced OP01-003
// (Romance Dawn's Leader Luffy) by roughly $950, because its Parallel product happened to get a
// *lower* productId than its own Normal product on TCGPlayer. The "(Parallel)" text match fixes
// that specific failure mode; ordering multiple Parallels of the same card among each other still
// has no better signal than productId — if you ever see a *2nd/3rd* Parallel's price on the
// wrong print variant, that remaining approximation is the place to look.

const ONEPIECE_TCGCSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
}

// Shared by parseOnePieceSetName() below and downloadOnePiece()'s Phase 3 (synthesizing cards
// for sets apitcg hasn't scraped yet, whose only name source is tcgcsv's own group name).
const titleCase = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

// "-ROMANCE DAWN- [OP01]" -> { code: "OP01", name: "Romance Dawn" } — bracket present, use it.
// "DODGERS ONE PIECE NIGHT" (a one-off promo "set", no official bracketed code on the official
// site) -> { code: null, name: "Dodgers One Piece Night" } — caller falls back to the card's own
// print-numbering prefix in that case (see downloadOnePiece() below), so `set` is never actually
// empty on a synced card even though this helper can return a null code.
function parseOnePieceSetName(raw) {
  const bracketMatch = raw.match(/\[([^\]]+)\]\s*$/)
  if (!bracketMatch) return { code: null, name: titleCase(raw.trim()) }
  const code = bracketMatch[1].replace(/[\s-]/g, '').toUpperCase()
  // Strip runs of dashes AND whitespace together (not whitespace-then-dashes in two separate
  // passes) — "-ROMANCE DAWN- [OP01]" leaves a trailing "- " (dash, then the space that was
  // between it and the bracket) after the bracket itself is removed below; stripping dashes
  // before trimming would miss it, since `-+$` doesn't match with that space still in the way.
  const name = titleCase(raw.replace(/\[[^\]]+\]\s*$/, '').replace(/^[-\s]+|[-\s]+$/g, '') || raw)
  return { code, name }
}

export async function downloadOnePiece() {
  console.log('\n🏴‍☠️  One Piece...')

  // ── Phase 1: Card data from GitHub ──────────────────────────────────────────
  const files = await fetchJSON(
    'https://api.github.com/repos/apitcg/one-piece-tcg-data/contents/cards/en',
    githubApiHeaders({ Accept: 'application/vnd.github.v3+json' })
  )

  const all = []
  // setName -> official bracketed code, or null if this "set" never had one (a promo/event
  // grouping, not a real product). Kept separate from each card's own `set` field (which DOES
  // fall back to a print-numbering prefix — see below) because the registry/Cardex grouping
  // needs to tell "genuinely OP09" apart from "a Treasure Cup promo whose cards just happen to
  // be numbered from OP09's print run" — conflating the two put dozens of one-off tournament
  // "sets" in the Cardex's Main Sets group alongside the real numbered boosters. See
  // app/api/sync/onepiece/route.ts, which reads this map for the registry's `code` field.
  const setBracketCodes = new Map()
  let done = 0
  await Promise.all(
    files.filter((f) => f.name.endsWith('.json')).map(async (file) => {
      try {
        const cards = await fetchJSON(file.download_url)
        for (const c of cards) {
          if (!c?.name || !c?.code || !c?.images?.large && !c?.images?.small) continue
          const numMatch = c.code.match(/-(\d+)$/)
          if (!numMatch) continue // every real card code ends "-<digits>"; skip anything malformed
          const { code: bracketCode, name: setName } = parseOnePieceSetName(c.set?.name ?? '')
          if (!setBracketCodes.has(setName)) setBracketCodes.set(setName, bracketCode)
          all.push({
            id: c.id,
            name: c.name,
            // Prefer the official bracketed set code; a promo "set" with no bracket (e.g. a
            // one-off tournament giveaway) falls back to the card's own print-numbering prefix,
            // e.g. "EB02" — that's still meaningful for an individual card (it says which real
            // print run the card belongs to) and keeps this field non-empty always, no
            // nullability to thread through the rest of the app the way Riftbound's setCode
            // never is either. It is NOT what the registry's set-level `code` uses, precisely
            // because it conflates real sets and promo fallbacks — see setBracketCodes above.
            set: bracketCode ?? c.code.split('-')[0],
            setName,
            number: numMatch[1],
            rarity: c.rarity ?? '',
            imageUrl: c.images.large ?? c.images.small,
            marketPrice: 0,
            _code: c.code, // scratch field for the price-merge pass below — stripped before sync
          })
        }
      } catch (err) {
        console.warn(`   ⚠️  Skipped ${file.name}: ${err.message}`)
      }
      done++
    })
  )
  console.log(`   ${all.length} cards from GitHub (every print variant counted separately)`)

  // ── Phase 2: Prices from tcgcsv.com (category 68) ──────────────────────────
  console.log('   Fetching prices from tcgcsv.com...')
  try {
    const groupData = await fetchJSON('https://tcgcsv.com/tcgplayer/68/groups', ONEPIECE_TCGCSV_HEADERS)
    const groups = groupData.results ?? []

    // rowsByCode: code -> [{ productId, marketPrice, imageUrl }], ordered by productId ascending
    // as they arrive (each group's CSV is already in a stable order; a final sort below is what
    // matters)
    const rowsByCode = new Map()
    const BATCH = 20
    for (let i = 0; i < groups.length; i += BATCH) {
      const batch = groups.slice(i, i + BATCH)
      await Promise.all(
        batch.map(async (g) => {
          try {
            const csv = await fetchText(`https://tcgcsv.com/tcgplayer/68/${g.groupId}/ProductsAndPrices.csv`, ONEPIECE_TCGCSV_HEADERS)
            const rows = parseCsv(csv)
            for (const row of rows) {
              const code = row.extNumber ?? ''
              if (!code || !/^[A-Z0-9]+-\d+$/.test(code)) continue // skip sealed product (booster boxes etc — no extNumber)
              const price = parseFloat(row.marketPrice) || parseFloat(row.midPrice) || parseFloat(row.lowPrice) || 0
              if (price === 0) continue // no listing data at all — would otherwise occupy a
                                         // positional slot in the base/_p1/_p2/... pairing below
                                         // and silently zero out a real variant's price
              const productId = parseInt(row.productId, 10) || 0
              // Whether TCGPlayer's own product name marks this as the Parallel print — used as
              // the *primary* sort key below (see the comment there for why productId alone
              // isn't reliable enough on its own).
              const isParallel = /\(Parallel\)/i.test(row.name ?? '')
              if (!rowsByCode.has(code)) rowsByCode.set(code, [])
              rowsByCode.get(code).push({
                productId, marketPrice: price, imageUrl: row.imageUrl ?? '', isParallel,
                name: row.name ?? '', rarity: row.extRarity ?? '', // only used by Phase 3 below,
                                                                    // for codes apitcg never scraped
              })
            }
          } catch {
            // silently skip groups that fail — cards in them still appear with $0 price
          }
        })
      )
      process.stdout.write(`   Prices: ${Math.min(i + BATCH, groups.length)}/${groups.length} groups...\r`)
    }
    // Primary sort key: whether the product name says "(Parallel)" — a non-Parallel row always
    // sorts before every Parallel row for the same code, matching apitcg's own base-before-_p1
    // ordering. productId ascending is only the *secondary* key (to order multiple Parallels
    // among themselves, where no better signal exists) — it is NOT reliable as the sole signal:
    // OP01-003 (Romance Dawn's Leader Luffy) had its "(Parallel)" product created on TCGPlayer
    // with a *lower* productId than its plain "Normal" product, so productId-only sorting paired
    // the base card with the Parallel's ~$955 price and the Parallel with the base's ~$7 price —
    // exactly backwards. Caught because it swapped prices on one of the game's most recognizable
    // chase cards; if you see another price that looks implausibly swapped for a code with
    // multiple variants, this is the place to check first.
    for (const rows of rowsByCode.values()) {
      rows.sort((a, b) => (Number(a.isParallel) - Number(b.isParallel)) || (a.productId - b.productId))
    }

    // ── Phase 3: synthesize cards for sets tcgcsv has priced but apitcg hasn't scraped yet ────
    // apitcg's GitHub dataset can lag real TCGPlayer releases by weeks — OP13 through OP17 (five
    // whole sets, hundreds of cards) were already selling with real tcgcsv prices while apitcg's
    // cards/en/ directory still topped out at op12.json. Rather than have those sets be entirely
    // invisible to the catalog until apitcg catches up, build minimal card entries straight from
    // tcgcsv's own CSV columns (name, extRarity, imageUrl — everything a catalog card needs
    // except apitcg's flavor-text `ability` field, which nothing in this app reads anyway) for
    // any code with priced rows but no matching apitcg card at all. Same "build catalog cards
    // directly from TCGPlayer data when the primary source doesn't have them" pattern
    // downloadLorcana()'s Phase 3 already uses for its TCGPlayer-only promo groups.
    const scrapedCodes = new Set(all.map((c) => c._code))
    // groupId abbreviations are inconsistent about what "-" means: "ST-31" is one prefix split
    // across two segments ("ST" + "31" -> "ST31"), "OP15-EB04" is two *different*, already-whole
    // prefixes sharing one combined product/group ("OP15" and "EB04" both -> "Adventure On
    // Kami's Island"), and "EB-03-04" is one letter-prefix shared across two number segments
    // ("EB" + "03" -> "EB03", "EB" + "04" -> "EB04"). All three read left-to-right as: a
    // pure-letters segment sets the "current" letter prefix for any pure-digits segment that
    // follows it; a segment that's already letters+digits (a whole prefix on its own) registers
    // immediately AND becomes the new current letter prefix for anything after it.
    const groupNameByPrefix = new Map()
    for (const g of groups) {
      const segments = (g.abbreviation ?? '').split('-').map((s) => s.replace(/\s/g, '').toUpperCase()).filter(Boolean)
      let currentLetters = ''
      for (const seg of segments) {
        if (/^\d+$/.test(seg)) {
          if (currentLetters && !groupNameByPrefix.has(currentLetters + seg)) {
            groupNameByPrefix.set(currentLetters + seg, g.name)
          }
        } else if (/^[A-Z]+\d+$/.test(seg)) {
          if (!groupNameByPrefix.has(seg)) groupNameByPrefix.set(seg, g.name)
          currentLetters = seg.match(/^[A-Z]+/)[0]
        } else if (/^[A-Z]+$/.test(seg)) {
          currentLetters = seg
        }
      }
    }
    let synthesized = 0
    for (const [code, rows] of rowsByCode) {
      if (scrapedCodes.has(code)) continue // apitcg already has this exact card — don't duplicate
      const prefixMatch = code.match(/^([A-Z0-9]+)-(\d+)$/)
      if (!prefixMatch) continue
      const [, prefix, num] = prefixMatch
      const setName = titleCase(groupNameByPrefix.get(prefix) ?? prefix)
      // Every synthesized card exists only because tcgcsv has a real numbered TCGPlayer product
      // group for it — that's the equivalent of apitcg's official bracket (see
      // parseOnePieceSetName()'s comment above), so it's fair to register it as this setName's
      // "official" code the same way, letting a genuine OP13-17 set land in Cardex's Main Sets
      // group once app/api/sync/onepiece/route.ts reads this map for the registry.
      if (!setBracketCodes.has(setName)) setBracketCodes.set(setName, prefix)
      rows.forEach((row, i) => {
        if (!row.name) return
        // Mirrors apitcg's own id scheme (base "OP13-001", parallels "OP13-001_p1", "_p2", ...)
        // so this synthesized card is indistinguishable from a real apitcg one to the rest of the
        // app (search-result "(Parallel)" labeling keys off this exact suffix — see search.ts).
        // `rows` is already sorted non-Parallel-first, so index 0 is always the base print here,
        // same as apitcg's own convention, regardless of what TCGPlayer happens to call it.
        const id = i === 0 ? code : `${code}_p${i}`
        const cleanName = row.name.replace(/\s*\(\d+\)\s*/g, ' ').replace(/\s*\(Parallel\)\s*/i, ' ').replace(/\s+/g, ' ').trim()
        all.push({
          id, name: cleanName || row.name, set: prefix, setName, number: num,
          rarity: row.rarity, imageUrl: row.imageUrl, marketPrice: row.marketPrice,
          _code: code,
        })
        synthesized++
      })
    }
    if (synthesized > 0) console.log(`   Synthesized ${synthesized} cards from TCGCSV for sets apitcg hasn't scraped yet`)

    // Merge prices: within each code, apitcg's own file-order (base, then _p1, _p2, ...) is
    // matched positionally against tcgcsv's productId-ascending rows for that same code.
    //
    // Also swaps `imageUrl` from the official gallery (en.onepiece-cardgame.com) to TCGPlayer's
    // own product photo wherever one exists. This isn't a quality preference — the official
    // site's images always fail to load from any other origin (its CDN sends
    // `Cross-Origin-Resource-Policy: same-site`, which every browser enforces regardless of a
    // plain `curl`/server-side fetch succeeding, so a raw HTTP 200 check on that URL is not
    // evidence it'll render in an `<img>` tag). TCGPlayer's CDN sends no such header. Same
    // "prefer a TCGPlayer product photo" pattern `downloadRiftbound()` already uses for its
    // Star/Signature stubs (`imageUrl: p.img || baseCard.imageUrl`) — just applied to every card
    // here instead of only synthesized ones, since the underlying problem (official-site images
    // never render for us) applies to all of them, not just the stubs.
    const byCode = new Map()
    for (const card of all) {
      if (!byCode.has(card._code)) byCode.set(card._code, [])
      byCode.get(card._code).push(card)
    }
    let priced = 0
    for (const [code, variants] of byCode) {
      const rows = rowsByCode.get(code)
      if (!rows) continue
      variants.forEach((card, i) => {
        const row = rows[i] ?? rows[rows.length - 1] // more tcgcsv rows than known variants
                                                       // (e.g. an extra listing style) -> reuse
                                                       // the last one rather than drop the price
        if (!row) return
        if (row.marketPrice > 0) { card.marketPrice = row.marketPrice; priced++ }
        if (row.imageUrl) card.imageUrl = row.imageUrl
      })
    }
    console.log(`   Prices found for ${priced}/${all.length} cards`)
  } catch (err) {
    console.warn(`   ⚠️  Price fetch failed: ${err.message} — catalog saved without prices`)
  }

  for (const card of all) delete card._code

  all.sort((a, b) => a.set.localeCompare(b.set) || (parseInt(a.number, 10) - parseInt(b.number, 10)))
  const result = await syncToFirestore('onepiece', all)
  return { ...result, setCodesBySetName: Object.fromEntries(setBracketCodes) }
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
  return syncToFirestore('mtg', all)
}
