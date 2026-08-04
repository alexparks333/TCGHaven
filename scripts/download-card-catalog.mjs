/**
 * Downloads all card catalogs (name, image, set, number) and syncs them into Firestore —
 * the shared, admin-only-writable catalog every copy of the app reads from (see
 * lib/api/catalog.ts and firestore.rules). Run once: npm run download-cards
 * Re-run whenever new sets release.
 *
 * Requires ADMIN_EMAIL/ADMIN_PASSWORD + the NEXT_PUBLIC_FIREBASE_* vars in .env.local — run
 * via `npm run download-cards`, which passes --env-file=.env.local. Signs in as the admin
 * account (same as a real browser session) rather than using a service-account key, so this
 * script satisfies the exact same Firestore security rules as the Admin Catalog page.
 *
 * Sync behavior: never deletes a card. New cards are created; existing cards are only
 * overwritten if something actually changed AND no admin edit has happened to them since the
 * last bulk sync (an edit made from /admin always wins over a fresh re-scrape). `hidden` is
 * never touched by this script — only the Admin Catalog page's Hide/Unhide toggle changes it.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { normSetName } from './lib/text-norm.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dir, '..', 'data')

const firebaseApp = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
})
const auth = getAuth(firebaseApp)
const db = getFirestore(firebaseApp)

async function ensureSignedIn() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local to sync the catalog to Firestore ' +
      '(this is what lets this script write under the same rules as a real admin browser session).'
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
 * names present in the final (post-sync) catalog, for the summary file written at the end.
 */
async function syncToFirestore(game, freshCards) {
  const metaRef = doc(db, 'catalog_meta', game)
  const metaSnap = await getDoc(metaRef)
  const lastBulkSyncAt = metaSnap.exists() ? metaSnap.data().lastBulkSyncAt ?? null : null

  const existingSnap = await getDocs(collection(db, 'catalog', game, 'cards'))
  const existingMap = new Map(existingSnap.docs.map((d) => [d.id, d.data()]))

  const finalMap = new Map(existingMap) // start from current Firestore state — never drop a card
  const writes = []

  for (const card of freshCards) {
    const existing = existingMap.get(card.id)

    if (!existing) {
      finalMap.set(card.id, { ...card, hidden: false })
      writes.push({ id: card.id, data: { ...card, hidden: false, updatedAt: serverTimestamp() } })
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
  await writeSnapshot(game, finalCards)
  await setDoc(metaRef, { lastBulkSyncAt: serverTimestamp() })

  return [...new Set(finalCards.map((c) => c.setName).filter(Boolean))]
}

// Registry (data/set-registry.json) is the mutable source of truth for Riftbound
// TCGPlayer group IDs discovered by the sync feature — it overrides/extends the
// hardcoded TCGCSV_GROUPS bootstrap list below without ever touching this file.
function loadRegistry() {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, 'set-registry.json'), 'utf-8'))
  } catch {
    return null
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url, label = '') {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.text()
}

async function fetchJSONWithHeaders(url, headers = {}) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return res.json()
}

// Parse a tcgcsv CSV text into row objects using the header row
function parseCsv(text) {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    // Handle quoted fields with embedded commas/newlines using a simple state machine
    const cols = []
    let cur = '', inQ = false
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = '' }
      else { cur += ch }
    }
    cols.push(cur)
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

async function downloadPokemon() {
  console.log('\n🎴 Pokemon TCG...')

  // ── Phase 1: Card data from GitHub ──────────────────────────────────────────
  const sets = await fetchJSON(
    'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json'
  )
  const setNameById = Object.fromEntries(sets.map((s) => [s.id, s.name]))
  console.log(`   ${sets.length} sets found`)

  const files = await fetchJSON(
    'https://api.github.com/repos/PokemonTCG/pokemon-tcg-data/contents/cards/en',
    { Accept: 'application/vnd.github.v3+json' }
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
    const groupData = await fetchJSONWithHeaders('https://tcgcsv.com/tcgplayer/3/groups', TCGP_HEADERS)
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

async function downloadLorcana() {
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
            imageUrl: c.image_uris?.digital?.small ?? c.image_uris?.digital?.normal ?? '',
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

  // Phase 3: TCGPlayer-only groups — D23, Disney promos, Illumineer's Quest, etc.
  // lorcast doesn't include these; we pull from tcgcsv (category 71, same CSV format as Riftbound).
  const LORCANA_PROMO_GROUPS = [
    { groupId: 17690, setName: 'D23 Promos' },
    { groupId: 23234, setName: 'Disney Lorcana Promo Cards' },
    { groupId: 23305, setName: 'Disney100 Promos' },
    { groupId: 23528, setName: "Illumineer's Quest: Deep Trouble" },
    { groupId: 24257, setName: "Illumineer's Quest: Palace Heist" },
    { groupId: 24734, setName: "Illumineer's Quest: The Great Hunny Rescue" },
    { groupId: 24740, setName: 'Hyperia City' },
  ]

  // Dedup by name+setName to avoid re-adding lorcast cards that also appear in TCGPlayer promo groups
  const seenByNameSet = new Set([...seen.values()].map(c => `${c.name}|${c.setName}`))

  const promoByProductId = new Map() // productId → card (merges Normal + Foil rows)

  await Promise.all(LORCANA_PROMO_GROUPS.map(async ({ groupId, setName }) => {
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
      let added = 0
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
        if (!productId || !name || !extNumber) continue
        if (seenByNameSet.has(`${name}|${setName}`)) continue // already in lorcast

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
// and written into data/set-registry.json — see getTcgcsvGroups() below.
const TCGCSV_GROUPS = [
  { groupId: 24344, setCode: 'OGN' },
  { groupId: 24519, setCode: 'SFD' },
  { groupId: 24560, setCode: 'UNL' },
  { groupId: 24439, setCode: 'OGS' },
]

function getTcgcsvGroups() {
  const registry = loadRegistry()
  if (!registry?.riftbound?.sets) return TCGCSV_GROUPS
  const merged = new Map(TCGCSV_GROUPS.map((g) => [g.setCode, g.groupId]))
  for (const s of registry.riftbound.sets) {
    if (s.setCode && typeof s.tcgcsvGroupId === 'number') merged.set(s.setCode, s.tcgcsvGroupId)
  }
  return [...merged.entries()].map(([setCode, groupId]) => ({ groupId, setCode }))
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
  const isShowcase = card.rarity === 'Showcase'
  // publicCode like "OGN-007a/298" → has 'a/' means same-number alt-art. This must NOT depend
  // on rarity === 'Showcase' — some sets' alt-arts (e.g. Vendetta) keep the base card's rarity
  // (Epic, etc.) on the gallery side, with the "a" suffix in publicCode as the only signal.
  const isSameNumAlt = (card.publicCode ?? '').includes('a/')
  const num = String(parseInt(card.number, 10))
  if (isStar) return `${card.setCode}:${num}:star`
  if (isSameNumAlt) return `${card.setCode}:${num}:altart`
  if (isShowcase) return `${card.setCode}:${num}:over`
  return `${card.setCode}:${num}:regular`
}

const TCGCSV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://tcgcsv.com/',
  'Accept': 'text/csv,*/*',
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
  for (const { groupId, setCode } of getTcgcsvGroups()) {
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
              rarity: extRarity || (artSuffix ? 'Showcase' : 'Common'),
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
      // For Showcase/Promo runes (foil-only), marketPrice = foil price
      for (const card of runeExtras.values()) {
        if (card.setCode === setCode && (card.rarity === 'Showcase' || card.rarity === 'Promo')) {
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

async function downloadRiftbound() {
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
      // Detect overnumber from publicCode: "UNL-234/219" where 234 > 219
      // Some sets (UNL, VEN) return the base rarity instead of "Showcase" from the gallery API
      const pubNums = pubCode.match(/-(\d+)\*?\/(\d+)$/)
      const isOvernumber = !isSig && !!pubNums && parseInt(pubNums[1]) > parseInt(pubNums[2])
      const card = {
        id: c.id,
        name: isSig ? c.name + ' (Signature)' : c.name,
        number: String(c.collectorNumber ?? ''),
        publicCode: pubCode,
        setCode: c.set?.value?.id ?? '',
        setName: c.set?.value?.label ?? '',
        rarity: isSig ? 'Star' : (isOvernumber ? 'Showcase' : (c.rarity?.value?.label ?? '')),
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
        const isShowcaseOrStar = card.rarity === 'Showcase' || card.id.includes('-star-') || key.includes(':sp')
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
  for (const [key, p] of prices.entries()) {
    if (!key.endsWith(':star')) continue
    const [setCode, num] = key.split(':')
    const starId = `${setCode.toLowerCase()}-${num}-star`
    if (allById.has(starId)) continue
    // Skip if gallery already has a star card for this set+number (publicCode contains */)
    const hasGalleryStar = all.some(
      (c) => c.setCode === setCode && String(parseInt(c.number, 10)) === num && (c.publicCode ?? '').includes('*/')
    )
    if (hasGalleryStar) continue
    // Prefer a plain (non-Showcase) sibling at this number as the clone template, but some
    // "Legend" champions (e.g. Renekton - Butcher of the Sands) only ever appear at this exact
    // number as the Showcase/Overnumber printing — their Signature is a signed version of THAT
    // art, not a separate plain card, so fall back to allowing Showcase once no plain sibling
    // exists (still never cloning from an existing Star, to avoid double-synthesis).
    const notStar = (c) => c.setCode === setCode && String(parseInt(c.number, 10)) === num && c.rarity !== 'Star' && !c.id.includes('-star')
    const baseCard = all.find((c) => notStar(c) && c.rarity !== 'Showcase') ?? all.find(notStar)
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
  return syncToFirestore('riftbound', all)
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log('📦 Downloading card catalogs...')
await ensureSignedIn()
const [pokemonSetNames, lorcanaSetNames, riftboundSetNames] =
  await Promise.all([downloadPokemon(), downloadLorcana(), downloadRiftbound()])

// Structured summary for scripts/sync-runner.mjs — avoids scraping human-readable stdout.
mkdirSync(DATA_DIR, { recursive: true })
writeFileSync(join(DATA_DIR, 'last-download-summary.json'), JSON.stringify({
  completedAt: new Date().toISOString(),
  pokemon: { setNames: pokemonSetNames },
  lorcana: { setNames: lorcanaSetNames },
  riftbound: { setNames: riftboundSetNames },
}))

console.log('\n✅ Done! Catalog synced to Firestore — every running app instance picks up the change on its next cache refresh, no rebuild needed.')
