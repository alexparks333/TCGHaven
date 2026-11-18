/**
 * PriceCharting graded prices → graded_prices/{catalog} in Firestore, once a day.
 * docs/PriceCharting.md has the licence terms and the plan; the pure logic is in
 * scripts/lib/pricecharting.mjs (tests: npm run test:pricecharting).
 *
 *   npm run pricecharting-sync -- --file prices.csv --dry-run   # a downloaded CSV, report only
 *   npm run pricecharting-sync -- --file a.csv --file b.csv     # write from local files
 *   npm run pricecharting-sync                                  # download, then write
 *   npm run pricecharting-sync -- --only pokemon-jp,onepiece    # just these catalogs
 *
 * Download: PRICECHARTING_CSV_URLS — the price-list link(s) copied from PriceCharting's
 * Subscriptions page → "API/Download" (Legendary plan), separated by commas or new lines. Each link
 * holds the account's token, so it lives in 1Password, .env.local and the GitHub secret — never
 * in the repo. PriceCharting rebuilds the file once a day and allows one download per 10 minutes.
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

async function readSources() {
  if (files.length) {
    return files.map((f) => ({ label: f, text: fs.readFileSync(f, 'utf8') }))
  }
  const urls = String(process.env.PRICECHARTING_CSV_URLS ?? '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
  if (!urls.length) {
    throw new Error('Set PRICECHARTING_CSV_URLS (the price-list link from PriceCharting → Subscriptions → API/Download; ' +
      'it is in 1Password) or pass --file <downloaded.csv>')
  }
  const out = []
  for (const [i, url] of urls.entries()) {
    // The link holds the token — never print it
    const label = `download ${i + 1} of ${urls.length}`
    const res = await fetch(url, { headers: { 'User-Agent': 'TCGHaven/1.0 (+https://tcghaven.org)', Accept: 'text/csv,*/*' } })
    if (!res.ok) throw new Error(`PriceCharting ${label}: HTTP ${res.status}`)
    out.push({ label, text: await res.text() })
  }
  return out
}

async function main() {
  const sources = await readSources()
  const rows = []
  for (const { label, text } of sources) {
    const r = parsePcCsv(text)
    if (r.length < MIN_ROWS || !('tcg-id' in r[0]) || !('id' in r[0])) {
      throw new Error(`${label}: ${r.length} rows, columns ${Object.keys(r[0] ?? {}).slice(0, 8).join(', ') || 'none'} — ` +
        `doesn't look like PriceCharting's price list (needs id and tcg-id)`)
    }
    console.log(`   ${label}: ${r.length.toLocaleString()} rows`)
    rows.push(...r)
  }
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
  if (failed) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((err) => {
  console.error(`PriceCharting sync failed: ${err.message}`)
  process.exit(1)
})
