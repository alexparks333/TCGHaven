/**
 * Read-only report: what the One Piece sync (TCGplayer primary, apitcg secondary — see
 * scripts/lib/onepiece-tcgplayer.mjs) would do to the live catalog. Writes NOTHING to Firestore.
 *
 *   node scripts/onepiece-source-report.mjs [--out report.json]
 *
 * The promise it checks: no card already in the catalog changes anything a collector sees (name,
 * set, number, rarity, picture, visibility) — so nobody's logged card can change, whoever they are.
 * Also lists price moves, new cards by set, and the secondary check's mismatches (apitcg's version
 * description names a different product than the photo the card shows).
 */
import fs from 'node:fs'

function loadEnvLocal() {
  const path = new URL('../.env.local', import.meta.url)
  if (!fs.existsSync(path)) return
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\\\$/g, '$')
  }
}
loadEnvLocal()
const outArg = process.argv.indexOf('--out')
const outPath = outArg > 0 ? process.argv[outArg + 1] : null

const { planOnePieceCatalog, stableStringify } = await import('./lib/catalog-sync.mjs')
const plan = await planOnePieceCatalog()
const existing = plan.existing

const VISIBLE = ['name', 'set', 'setName', 'number', 'rarity', 'imageUrl', 'hidden']
const visibleChanges = []
const priceMoves = []
for (const c of plan.cards) {
  const ex = existing.get(c.id)
  if (!ex) continue
  for (const k of VISIBLE) if (k in c && stableStringify(c[k]) !== stableStringify(ex[k])) visibleChanges.push({ id: c.id, field: k, before: ex[k], after: c[k] })
  const a = ex.marketPrice || 0
  const b = c.marketPrice ?? a
  if (Math.abs(a - b) >= 0.01) priceMoves.push({ id: c.id, name: ex.name, before: a, after: b })
}
const planned = new Set(plan.cards.map((c) => c.id))
const leftAsIs = [...existing.keys()].filter((id) => !planned.has(id))
const newCards = plan.cards.filter((c) => !existing.has(c.id))
const bySet = Object.entries(newCards.reduce((m, c) => ((m[c.setName] = (m[c.setName] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])
const r = plan.report
const summary = {
  liveCards: existing.size,
  plannedCards: plan.cards.length,
  existingCardsWithVisibleChange: visibleChanges.length,
  existingCardsLeftExactlyAsIs: leftAsIs.length,
  priceMoves: priceMoves.length,
  bigPriceMoves: priceMoves.filter((x) => x.before >= 1 && Math.abs(x.after - x.before) / x.before > 0.25),
  newCards: newCards.length,
  forReview: r.reviewCards,
  newCardsBySet: bySet.slice(0, 40),
  mismatches: r.mismatches.length,
  lostProducts: r.lostProducts.length,
}
console.log(JSON.stringify(summary, null, 2))
if (visibleChanges.length) console.log('VISIBLE CHANGES:', visibleChanges.slice(0, 20))
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify({ summary, visibleChanges, priceMoves, mismatches: r.mismatches, newCards: newCards.map(({ id, name, setName, number, rarity, marketPrice, _review }) => ({ id, name, setName, number, rarity, marketPrice, review: !!_review })) }, null, 1))
  console.log(`Full report: ${outPath}`)
}
process.exit(visibleChanges.length ? 2 : 0)
