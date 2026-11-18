/**
 * PriceCharting graded prices → graded_prices/{catalog} in Firestore, once a day.
 * docs/PriceCharting.md has the licence terms and the plan; the pure logic is in
 * scripts/lib/pricecharting.mjs (tests: npm run test:pricecharting).
 *
 *   npm run pricecharting-sync -- --file prices.csv --dry-run   # a downloaded CSV, report only
 *   npm run pricecharting-sync -- --file a.csv --file b.csv     # write from local files
 *   npm run pricecharting-sync                                  # download, then write
 *   npm run pricecharting-sync -- --only pokemon-jp,onepiece    # just these catalogs
 *   npm run pricecharting-sync -- --dry-run --save-dir <folder> # keep the downloads for --file reruns
 *   npm run pricecharting-sync -- --categories one-piece-cards  # download just these lists
 *
 * Download: PRICECHARTING_TOKEN — the account's API token (PriceCharting → Subscriptions →
 * "API/Download", Legendary plan). It lives in 1Password, .env.local and the GitHub secret — never
 * in the repo, never printed. One CSV per category (CATEGORIES below); PriceCharting rebuilds them
 * once a day and allows one download per 10 minutes.
 *
 * Writes nothing to the catalog cards (their updatedAt would read as a staff edit to the catalog
 * sync). Each catalog's graded prices are rewritten whole: chunks first, then the meta doc's
 * chunkCount, which is all the app reads up to. Nothing is ever deleted. A catalog whose match
 * count collapses (a partial or wrong file) keeps yesterday's prices instead.
 *
 * Needs ADMIN_EMAIL / ADMIN_PASSWORD and the NEXT_PUBLIC_FIREBASE_* vars, like download-cards.
 */

import fs from 'node:fs'

function loadEnvLocal() {
  const path = new URL('../.env.local', import.meta.url)
  if (!fs.existsSync(path)) return
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.replace(/\r$/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, key, rawValue] = m
    if (process.env[key] !== undefined) continue // real env/shell vars win over the file
    process.env[key] = rawValue.replace(/\\\$/g, '$') // CLAUDE.md rule 23
  }
}
loadEnvLocal()

// After the env is loaded: catalog-sync.mjs initialises Firebase when imported
const { ensureSignedIn, getCatalogDb } = await import('./lib/catalog-sync.mjs')
const { readCompressedSnapshot } = await import('./lib/snapshot-codec.mjs')
const { parsePcCsv, pickByTcgId, matchCatalog } = await import('./lib/pricecharting.mjs')
const { doc, getDoc, setDoc, writeBatch, serverTimestamp } = await import('firebase/firestore')

// Every catalog a PriceCharting row could match (by TCGplayer product id)
const CATALOGS = ['pokemon', 'pokemon-jp', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh',
  'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']
const CHUNK = 1500            // entries per chunk doc (~150 bytes each — far under Firestore's 1MiB)
const MIN_ROWS = 100          // fewer rows than this = not the real price list
const COLLAPSE_RATIO = 0.5    // matches below half of the last run's = keep the last run's

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const files = args.flatMap((a, i) => (a === '--file' && args[i + 1] ? [args[i + 1]] : []))
const onlyArg = args.find((a, i) => args[i - 1] === '--only')
const only = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null
if (only?.some((k) => !CATALOGS.includes(k))) {
  console.error(`--only takes: ${CATALOGS.join(', ')}`)
  process.exit(1)
}

// The trading-card price lists to download. The first four are listed on PriceCharting's
// Subscriptions → API/Download page (2026-11-18); Japanese Pokémon is inside pokemon-cards.
// Riftbound, Lorcana and the rest live under "Other TCG Cards" on PriceCharting's site (e.g.
// "Trading Cards > Other TCG Cards > Riftbound Promo") — other-tcg-cards is that category's slug,
// not listed on the download page, so a run that can't read it just says so and carries on.
// lorcana-cards / star-wars-cards / digimon-cards: not on the download page either, but real lists
// (probed 2026-11-18). An unknown slug returns the video-game list — rejected below.
const CATEGORIES = ['pokemon-cards', 'magic-cards', 'yugioh-cards', 'one-piece-cards', 'other-tcg-cards',
  'lorcana-cards', 'star-wars-cards', 'digimon-cards']
const csvUrl = (token, category) =>
  `https://www.pricecharting.com/price-guide/download-custom?t=${encodeURIComponent(token)}&category=${encodeURIComponent(category)}`

let downloadFailed = false

// PriceCharting throttles back-to-back downloads (2026-11-18: three in a row were fine, the fourth
// got HTTP 429). Space them out, and on a 429 wait as long as it asks (Retry-After) — or its
// documented "one download every 10 minutes" — then try again.
const BETWEEN_DOWNLOADS_MS = 20_000
const RETRIES_429 = 2
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function download(url, category) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'TCGHaven/1.0 (+https://tcghaven.org)', Accept: 'text/csv,*/*' } })
    if (res.ok) return res.text()
    if (res.status !== 429 || attempt >= RETRIES_429) throw new Error(`HTTP ${res.status}`)
    const retryAfter = Number(res.headers.get('retry-after'))
    const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 900) * 1000 : 10 * 60_000
    console.log(`   ${category}: PriceCharting says too many requests — waiting ${Math.round(ms / 60_000 * 10) / 10} min, then retrying`)
    await wait(ms)
  }
}

// --categories pokemon-cards,one-piece-cards: download just these (default: all of CATEGORIES)
const catArg = args.find((a, i) => args[i - 1] === '--categories')
const categories = catArg ? catArg.split(',').map((s) => s.trim()).filter(Boolean) : CATEGORIES
// --save-dir <folder>: keep each downloaded list as <folder>/<category>.csv (no token in them), so
// later dry runs can use --file instead of downloading again
const saveDir = args.find((a, i) => args[i - 1] === '--save-dir') ?? null

async function readSources() {
  if (files.length) {
    return files.map((f) => ({ label: f, text: fs.readFileSync(f, 'utf8') }))
  }
  const token = String(process.env.PRICECHARTING_TOKEN ?? '').trim()
  if (!token) {
    throw new Error('Set PRICECHARTING_TOKEN (PriceCharting → Subscriptions → API/Download — it is in 1Password) ' +
      'or pass --file <downloaded.csv>')
  }
  const out = []
  for (const [i, category] of categories.entries()) {
    // The URL holds the token — only ever print the category
    try {
      if (i > 0) await wait(BETWEEN_DOWNLOADS_MS)
      const text = await download(csvUrl(token, category), category)
      if (saveDir) {
        fs.mkdirSync(saveDir, { recursive: true })
        fs.writeFileSync(`${saveDir}/${category}.csv`, text)
      }
      out.push({ label: category, text })
    } catch (err) {
      // One missing list must not stop the others; a catalog that loses its matches keeps
      // yesterday's prices (COLLAPSE_RATIO below)
      downloadFailed = true
      console.error(`   ${category}: download failed — ${err.message}`)
    }
  }
  if (!out.length) throw new Error('No PriceCharting price list could be downloaded')
  return out
}

async function main() {
  const sources = await readSources()
  const rows = []
  for (const { label, text } of sources) {
    const r = parsePcCsv(text)
    // An unknown category quietly returns PriceCharting's VIDEO GAME list (seen with
    // flesh-and-blood-cards, 2026-11-18) — same columns, but no row has a TCGplayer id.
    if (r.length < MIN_ROWS || !('tcg-id' in r[0]) || !('id' in r[0]) || !r.some((row) => row['tcg-id'])) {
      downloadFailed = true
      console.error(`   ${label}: ${r.length} rows, columns ${Object.keys(r[0] ?? {}).slice(0, 8).join(', ') || 'none'} — ` +
        `doesn't look like PriceCharting's price list (needs id and tcg-id), skipped`)
      continue
    }
    console.log(`   ${label}: ${r.length.toLocaleString()} rows`)
    for (const row of r) rows.push(row) // not push(...r): 135k arguments overflow the stack
  }
  if (!rows.length) throw new Error('No usable PriceCharting price list')
  const { byTcg, ambiguous } = pickByTcgId(rows)
  console.log(`PriceCharting: ${byTcg.size.toLocaleString()} TCGplayer products with graded sales; ` +
    `${ambiguous.length} skipped (several listings, none plain)`)
  for (const a of ambiguous.slice(0, 5)) console.log(`   ambiguous ${a.tcgId}: ${a.names.join(' | ')}`)

  if (!dryRun) await ensureSignedIn()
  const db = getCatalogDb()
  let failed = false

  for (const key of only ?? CATALOGS) {
    try {
      const snap = await readCompressedSnapshot(db, key)
      if (!snap) { console.log(`- ${key}: no catalog snapshot, skipped`); continue }
      const { entries, withProductId, sharedProductIds } = matchCatalog(snap.cards, byTcg)
      const line = `- ${key}: ${entries.length.toLocaleString()} cards priced of ${withProductId.toLocaleString()} with a TCGplayer id ` +
        `(${snap.cards.length.toLocaleString()} in catalog${sharedProductIds ? `, ${sharedProductIds} shared ids skipped` : ''})`
      if (dryRun) {
        console.log(line)
        for (const e of entries.slice(0, 3)) console.log(`     ${e.id} → ${JSON.stringify(e.p)}  ${e.u}`)
        continue
      }
      const metaRef = doc(db, 'graded_prices', key)
      const prev = await getDoc(metaRef)
      const prevMatched = prev.exists() ? Number(prev.data().matched) || 0 : 0
      if (prevMatched >= 50 && entries.length < prevMatched * COLLAPSE_RATIO) {
        console.warn(`${line}\n   ⚠️  down from ${prevMatched} last run — keeping last run's prices (check the CSV)`)
        failed = true
        continue
      }
      const chunks = []
      for (let i = 0; i < entries.length; i += CHUNK) chunks.push(entries.slice(i, i + CHUNK))
      for (let i = 0; i < chunks.length; i += 400) {
        const batch = writeBatch(db)
        chunks.slice(i, i + 400).forEach((c, j) => batch.set(doc(db, 'graded_prices', key, 'chunks', String(i + j)), { cards: JSON.stringify(c) }))
        await batch.commit()
      }
      await setDoc(metaRef, {
        chunkCount: chunks.length, matched: entries.length, source: 'pricecharting', asOf: serverTimestamp(),
      })
      console.log(`${line} — written`)
    } catch (err) {
      failed = true
      console.error(`- ${key}: failed — ${err.message}`)
    }
  }
  if (dryRun) console.log('Dry run: nothing written.')
  if (failed || downloadFailed) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((err) => {
  console.error(`PriceCharting sync failed: ${err.message}`)
  process.exit(1)
})
