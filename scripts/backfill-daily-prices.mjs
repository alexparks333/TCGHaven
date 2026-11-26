// One-off (2026-11-01): builds the daily price files and first-price maps (price-history.mjs
// "Daily closes") from the existing month docs, so Portfolio's 24h / 7d / 30d baselines work from
// the day this ships instead of only once new days have piled up.
//
// NOT safe to re-run blindly any more: since 2026-11-25 the month docs also hold the weekly 2024–2026
// backfill (scripts/backfill-price-history.mjs), from before we recorded prices. Rebuilding from all
// of it would write weekly day files for those years and make every card's first price its 2024
// price — Portfolio's fallback cost basis for cards with nothing paid — changing collectors' gains.
// So writing needs `--from YYYY-MM-DD` (month-doc days before it are ignored — use a day on or after
// the game's real recorded history began), and the first prices already stored always win: month
// docs only fill cards (or slots) that have none.
//
//   node scripts/backfill-daily-prices.mjs --dry-run [--from YYYY-MM-DD]  (reads and reports only)
//   node scripts/backfill-daily-prices.mjs --from YYYY-MM-DD              (writes)
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
const fromArg = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null
if (fromArg !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) { console.error('--from needs a YYYY-MM-DD day'); process.exit(1) }
if (!dryRun && !fromArg) {
  console.error('Refusing to write without --from YYYY-MM-DD: the month docs include the weekly 2024 backfill (see the header).')
  process.exit(1)
}
const db = getFirestore(getApps()[0])
await ensureSignedIn()

for (const game of ['pokemon', 'pokemon-jp', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']) {
  const months = await getDocs(collection(db, PRICE_HISTORY_COLLECTION, game, 'months'))
  // 'YYYY-MM-DD' → { t: latest sync time that day, prices: { [id]: tuple } } across every set
  const byDay = new Map()
  for (const d of months.docs) {
    const { month, days } = d.data()
    for (const [dd, raw] of Object.entries(days ?? {})) {
      let entry
      try { entry = JSON.parse(raw) } catch { continue }
      const day = `${month}-${dd}`
      if (fromArg && day < fromArg) continue // the pre-recording backfill (see the header)
      if (!byDay.has(day)) byDay.set(day, { t: entry.t, prices: {} })
      const acc = byDay.get(day)
      if (entry.t > acc.t) acc.t = entry.t
      Object.assign(acc.prices, entry.p)
    }
  }
  const days = [...byDay.keys()].sort()
  if (!days.length) { console.log(`${game}: no history, skipped`); continue }

  // First prices: what's already stored wins (a card's first price must never move — it's
  // Portfolio's fallback cost basis); month docs, oldest day first, only fill what's missing.
  const firsts = {}
  const existing = await readPriceChunks(game, FIRSTS_COLLECTION).catch((err) => {
    if (!dryRun) throw err
    console.warn(`${game}: couldn't read existing first prices (${err.code ?? err.message}) — firestore.rules not deployed yet?`)
    return null
  })
  if (existing) mergeFirsts(firsts, existing.prices)
  for (const day of days) mergeFirsts(firsts, byDay.get(day).prices)

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
