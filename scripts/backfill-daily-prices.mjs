// One-off (2026-11-01): builds the daily price files and first-price maps (price-history.mjs
// "Daily closes") from the existing month docs, so Portfolio's 24h / 7d / 30d baselines work from
// the day this ships instead of only once new days have piled up. Safe to re-run: every day file
// is rewritten from the month docs, and first prices only ever keep the earliest value.
//
//   node scripts/backfill-daily-prices.mjs            (writes)
//   node scripts/backfill-daily-prices.mjs --dry-run  (reads and reports only)
//
// Reads every price_history/{game}/months doc once (~2,100 docs); writes one or two docs per day
// of history per game.

import fs from 'node:fs'

for (const line of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\r$/, '').replace(/^"|"$/g, '').replace(/\\\$/g, '$')
}
const { ensureSignedIn, writePriceChunks, readPriceChunks } = await import('./lib/catalog-sync.mjs')
const { getFirestore, collection, getDocs } = await import('firebase/firestore')
const { getApps } = await import('firebase/app')
const { PRICE_HISTORY_COLLECTION, DAYS_COLLECTION, FIRSTS_COLLECTION, dayDocId, mergeFirsts } = await import('./lib/price-history.mjs')

const dryRun = process.argv.includes('--dry-run')
const db = getFirestore(getApps()[0])
await ensureSignedIn()

for (const game of ['pokemon', 'pokemon-jp', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld']) {
  const months = await getDocs(collection(db, PRICE_HISTORY_COLLECTION, game, 'months'))
  // 'YYYY-MM-DD' → { t: latest sync time that day, prices: { [id]: tuple } } across every set
  const byDay = new Map()
  for (const d of months.docs) {
    const { month, days } = d.data()
    for (const [dd, raw] of Object.entries(days ?? {})) {
      let entry
      try { entry = JSON.parse(raw) } catch { continue }
      const day = `${month}-${dd}`
      if (!byDay.has(day)) byDay.set(day, { t: entry.t, prices: {} })
      const acc = byDay.get(day)
      if (entry.t > acc.t) acc.t = entry.t
      Object.assign(acc.prices, entry.p)
    }
  }
  const days = [...byDay.keys()].sort()
  if (!days.length) { console.log(`${game}: no history, skipped`); continue }

  // First prices, oldest day first; whatever the live sync already recorded only fills gaps.
  const firsts = {}
  for (const day of days) mergeFirsts(firsts, byDay.get(day).prices)
  const existing = await readPriceChunks(game, FIRSTS_COLLECTION).catch((err) => {
    if (!dryRun) throw err
    console.warn(`${game}: couldn't read existing first prices (${err.code ?? err.message}) — firestore.rules not deployed yet?`)
    return null
  })
  if (existing) mergeFirsts(firsts, existing.prices)

  console.log(`${game}: ${months.size} month docs → ${days.length} days (${days[0]} … ${days.at(-1)}), ${Object.keys(firsts).length} first prices`)
  if (dryRun) continue

  let chunks = 0
  for (const day of days) {
    const { t, prices } = byDay.get(day)
    chunks += await writePriceChunks(game, DAYS_COLLECTION, (n) => dayDocId(day, n), { day, t }, prices)
  }
  await writePriceChunks(game, FIRSTS_COLLECTION, String, { t: new Date().toISOString() }, firsts)
  console.log(`${game}: wrote ${chunks} day chunk(s) and the first-price map`)
}
process.exit(0)
