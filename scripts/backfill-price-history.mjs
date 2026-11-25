// One-off (2026-11-25, the Owner's call): loads price history from before we started recording it —
// back to 2024-02-08 (the first day tcgcsv archived) or a card's release — into the shared month docs
// (price_history/{game}/months, scripts/lib/price-history.mjs), so a card's chart shows its whole life.
//
// Input: tcgcsv's daily price archives, boiled down to one file per day by a converter run outside the
// repo — `<daysDir>/{YYYY-MM-DD}.json.gz` = { tcgCategory: { productId: { subTypeName: [market, low] } } }.
//
// Matching (no per-game rules to re-implement): over the game's latest 30 recorded days that the archives
// also have (every current card has those — most games' records only start in Oct/Nov 2026), a card's
// recorded prices identify its TCGplayer listing and which subtype is its
// normal price (tuple slot 0) and its foil price (slot 1): a card with a stored product id
// (productIdOf()) is matched among that product's subtypes; one without (Riftbound's gallery cards) by
// looking its prices up among every product. Kept only when one listing agrees on ≥ 80% of the days
// (and clearly beats any other). Low prices (slots 2/3) come from the same listing's low price, when
// the card's recorded low prices agree with it too.
//
// Writing: for each matched card, one archive day a week before the card's FIRST recorded day, into its
// set's month doc — days we already have are never replaced (a day both have only gains the cards it
// lacked). The daily-close files and first prices (Portfolio's baselines) are not touched.
//
//   node scripts/backfill-price-history.mjs <daysDir> [--game pokemon,lorcana] [--apply]
//   (dry run by default: reports what it would match and write)

import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'

for (const line of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.replace(/\r$/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\\\$/g, '$')
}
const { ensureSignedIn, getCatalogDb } = await import('./lib/catalog-sync.mjs')
const { productIdOf } = await import('./lib/pricecharting.mjs')
const { setKeyOf, PRICE_HISTORY_COLLECTION } = await import('./lib/price-history.mjs')
const { collection, getDocs, doc, writeBatch } = await import('firebase/firestore')

const args = process.argv.slice(2)
const daysDir = args.find((a) => !a.startsWith('--'))
const APPLY = args.includes('--apply')
const WHY = args.includes('--why') ? Number(args[args.indexOf('--why') + 1]) : 0
const gameArg = args.includes('--game') ? args[args.indexOf('--game') + 1].split(',') : null
if (!daysDir || !fs.existsSync(daysDir)) { console.error('usage: node scripts/backfill-price-history.mjs <daysDir> [--game …] [--apply]'); process.exit(1) }

// history game → TCGplayer category
const CATEGORY = {
  pokemon: '3', 'pokemon-jp': '85', lorcana: '71', riftbound: '89', onepiece: '68', mtg: '1', yugioh: '2',
  swu: '79', gundam: '86', fab: '62', digimon: '63', palworld: '91', cyberpunk: '92',
}
const OVERLAP_DAYS = 30     // the game's latest recorded days used to match cards
const FIRST_ARCHIVE = '2024-02-08'
const MIN_DAYS = 4          // a slot needs this many overlap days with a price to be matched
const MIN_SCORE = 0.8       // share of those days the listing must agree on
const DOC_LIMIT = 950_000   // stay under Firestore's 1 MiB per doc

const same = (a, b) => Math.abs(a - b) < 0.011
// Our syncs and tcgcsv's archive snapshot at different hours, so a price we recorded on day D is often the
// archive's D-1 or D+1 — a day counts as agreeing when any of the three does (over 15–30 days in a row
// that's still an exact fingerprint)
const shift = (day, by) => new Date(Date.parse(day) + by * 86400000).toISOString().slice(0, 10)
const near = (day) => [day, shift(day, -1), shift(day, 1)]
const dayFiles = fs.readdirSync(daysDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).map((f) => f.slice(0, 10)).sort()
const readDay = (day) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(daysDir, day + '.json.gz'))).toString())

await ensureSignedIn()
const db = getCatalogDb()

for (const game of gameArg ?? Object.keys(CATEGORY)) {
  const cat = CATEGORY[game]
  console.log(`\n== ${game} (TCGplayer category ${cat})`)
  // Our history: card → day → tuple, and where each card's month docs live
  const months = (await getDocs(collection(db, PRICE_HISTORY_COLLECTION, game, 'months'))).docs.map((d) => ({ id: d.id, ...d.data() }))
  const hist = new Map()      // cardId → Map(day → tuple)
  const setOf = new Map()     // cardId → setKey
  for (const m of months) {
    for (const [dd, raw] of Object.entries(m.days ?? {})) {
      let entry; try { entry = JSON.parse(raw) } catch { continue }
      const day = `${m.month}-${dd}`
      for (const [id, t] of Object.entries(entry.p ?? {})) {
        if (!hist.has(id)) hist.set(id, new Map())
        hist.get(id).set(day, t)
        setOf.set(id, m.setKey)
      }
    }
  }
  if (!hist.size) { console.log('   no history — skipped'); continue }
  const catalog = new Map((await getDocs(collection(db, 'catalog', game, 'cards'))).docs.map((d) => [d.id, { id: d.id, ...d.data() }]))

  // The overlap: the game's latest recorded days the archives have too
  const recorded = new Set()
  for (const days of hist.values()) for (const d of days.keys()) recorded.add(d)
  const overlapDays = dayFiles.filter((d) => recorded.has(d)).slice(-OVERLAP_DAYS)
  const inWindow = new Set(overlapDays)
  const have = new Set(dayFiles)
  const archDays = [...new Set(overlapDays.flatMap(near))].filter((d) => have.has(d))
  const arch = new Map(archDays.map((d) => [d, readDay(d)[cat] ?? {}]))
  if (!overlapDays.length) { console.log('   no overlap archives yet — skipped'); continue }
  // value index (first overlap day with prices) for cards without a product id: "12.34" → ["pid|sub", …]
  const index = new Map()
  for (const [day, rows] of arch) {
    for (const [pid, subs] of Object.entries(rows)) {
      for (const [sub, [m]] of Object.entries(subs)) {
        if (!(m > 0)) continue
        const k = `${day}|${m.toFixed(2)}`
        if (!index.has(k)) index.set(k, [])
        index.get(k).push(`${pid}|${sub}`)
      }
    }
  }

  /** The listing (pid|sub) whose market price follows this card's slot over the overlap days */
  function matchSlot(series, pid) {
    if (series.length < MIN_DAYS) return null
    // matched by price alone (no product id): only on a long run of days — 4 (Magic's record so far) is too few to trust
    if (!pid && series.length < 10) return null
    let cands
    if (pid) cands = new Set(series.flatMap(([day]) => near(day).flatMap((d) => Object.keys(arch.get(d)?.[pid] ?? {}).map((s) => `${pid}|${s}`))))
    else {
      cands = new Set()
      for (const [day, v] of series.slice(0, 3)) for (const d of near(day)) for (const c of index.get(`${d}|${v.toFixed(2)}`) ?? []) cands.add(c)
      if (cands.size > 400) return null // too common a price to tell apart
    }
    let best = null, second = 0
    for (const c of cands) {
      const [p, s] = c.split('|')
      let hit = 0
      for (const [day, v] of series) if (near(day).some((d) => { const r = arch.get(d)?.[p]?.[s]; return r && same(r[0], v) })) hit++
      const score = hit / series.length
      if (!best || score > best.score) { second = best?.score ?? 0; best = { pid: p, sub: s, score } } else if (score > second) second = score
    }
    if (!best || best.score < MIN_SCORE || best.score - second < 0.15) return null
    return best
  }
  const lowAgrees = (series, slot) => {
    if (!slot || series.length < MIN_DAYS) return false
    let hit = 0
    for (const [day, v] of series) if (near(day).some((d) => { const r = arch.get(d)?.[slot.pid]?.[slot.sub]; return r && same(r[1], v) })) hit++
    return hit / series.length >= 0.6
  }

  const maps = new Map() // cardId → { m, mf, l, lf, first }
  let byId = 0, byPrice = 0, none = 0, noOverlap = 0
  for (const [id, days] of hist) {
    const first = [...days.keys()].sort()[0]
    const inOverlap = [...days].filter(([d]) => inWindow.has(d)).sort()
    if (!inOverlap.length) { noOverlap++; continue }
    const slot = (i) => inOverlap.filter(([, t]) => Number(t[i]) > 0).map(([d, t]) => [d, Number(t[i])])
    const pid = productIdOf(catalog.get(id) ?? { id })
    const m = matchSlot(slot(0), pid ? String(pid) : null)
    const mf = matchSlot(slot(1), pid ? String(pid) : (m ? m.pid : null))
    if (!m && !mf) {
      none++
      if (WHY && none <= WHY) {
        const c = catalog.get(id)
        const s0 = slot(0), s1 = slot(1)
        const subs = pid ? Object.fromEntries(Object.entries(arch.get(inOverlap.at(-1)[0])?.[String(pid)] ?? {}).map(([k, v]) => [k, v[0]])) : null
        console.log(`   ? ${id} ${c?.name ?? ''} | pid ${pid ?? '-'} | ours m ${s0.at(-1)?.[1] ?? 0} mf ${s1.at(-1)?.[1] ?? 0} (${s0.length}/${s1.length} days) | archive ${JSON.stringify(subs)} | src ${c?.priceSource ?? ''} hidden ${!!c?.hidden}`)
      }
      continue
    }
    if (pid) byId++; else byPrice++
    maps.set(id, { m, mf, l: lowAgrees(slot(2), m) ? m : null, lf: lowAgrees(slot(3), mf) ? mf : null, first })
  }
  console.log(`   matching on ${overlapDays.length} days ${overlapDays[0]} → ${overlapDays.at(-1)}; cards with history: ${hist.size} — matched ${maps.size} (${byId} by product id, ${byPrice} by their prices); not matched ${none}; no price on those days ${noOverlap}`)

  // What to write, a month at a time (Magic has ~85k matched cards — all at once ran out of memory):
  // one price a week (the Owner's call 2026-11-25 — daily for 2+ years was several GB, some big sets'
  // months went over 1 MiB, and "All" charts read it all), every 7th archive day from 2024-02-08
  const existing = new Map(months.map((m) => [m.id, m]))
  const weekly = dayFiles.filter((d) => d >= FIRST_ARCHIVE && Math.round((Date.parse(d) - Date.parse(FIRST_ARCHIVE)) / 86400000) % 7 === 0)
  const byMonth = new Map()
  for (const d of weekly) { if (!byMonth.has(d.slice(0, 7))) byMonth.set(d.slice(0, 7), []); byMonth.get(d.slice(0, 7)).push(d) }
  let points = 0, bytes = 0, tooBig = 0, docCount = 0, written = 0
  for (const [month, days] of byMonth) {
    const writes = new Map() // docId → Map(dd → { id: tuple })
    for (const day of days) {
      const rows = readDay(day)[cat] ?? {}
      for (const [id, mp] of maps) {
        if (day >= mp.first) continue
        const v = (slot, i) => (slot ? Number(rows[slot.pid]?.[slot.sub]?.[i]) || 0 : 0)
        const t = [v(mp.m, 0), v(mp.mf, 0), v(mp.l, 1), v(mp.lf, 1)]
        if (!t.some((x) => x > 0)) continue
        const docId = `${setOf.get(id)}__${month}`
        if (!writes.has(docId)) writes.set(docId, new Map())
        const byDay = writes.get(docId)
        if (!byDay.has(day.slice(8))) byDay.set(day.slice(8), {})
        byDay.get(day.slice(8))[id] = t
        points++
      }
    }
    // Merge with what's there: an existing day keeps every price it has and only gains missing cards
    const docs = []
    for (const [docId, byDay] of writes) {
      const cur = existing.get(docId)
      const setKey = docId.slice(0, docId.lastIndexOf('__'))
      const out = {}
      for (const [dd, p] of byDay) {
        let merged = { t: `${month}-${dd}T20:30:00.000Z`, p }
        if (cur?.days?.[dd]) {
          try { const old = JSON.parse(cur.days[dd]); merged = { t: old.t, p: { ...p, ...old.p } } } catch { continue }
        }
        out[dd] = JSON.stringify(merged)
      }
      if (JSON.stringify({ ...(cur?.days ?? {}), ...out }).length > DOC_LIMIT) { tooBig++; continue }
      bytes += JSON.stringify(out).length
      docs.push({ docId, setKey, days: out })
    }
    docCount += docs.length
    if (APPLY) {
      // a batch's total is capped at ~10 MiB — keep each well under
      let batch = writeBatch(db), inBatch = 0, batchBytes = 0
      for (const d of docs) {
        const size = JSON.stringify(d.days).length
        if (inBatch && (inBatch >= 200 || batchBytes + size > 8_000_000)) { await batch.commit(); batch = writeBatch(db); inBatch = 0; batchBytes = 0 }
        batch.set(doc(db, PRICE_HISTORY_COLLECTION, game, 'months', d.docId), { game, setKey: d.setKey, month, days: d.days }, { merge: true })
        inBatch++; batchBytes += size; written++
      }
      if (inBatch) await batch.commit()
    }
  }
  console.log(`   ${APPLY ? 'wrote' : 'would write'} ${points.toLocaleString()} weekly card-prices into ${docCount} month docs (~${(bytes / 1e6).toFixed(1)} MB)${tooBig ? `; ${tooBig} docs skipped (over 1 MiB)` : ''}; ${weekly.length} weeks ${weekly[0]} → ${weekly.at(-1)}`)
}
process.exit(0)
