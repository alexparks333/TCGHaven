/**
 * Read-only: what an MTG sync would write to the live catalog right now (how many cards change,
 * which fields, how long the Scryfall download + build takes). Writes NOTHING.
 *
 *   node scripts/mtg-source-report.mjs
 */
import fs from 'node:fs'
for (const line of fs.existsSync(new URL('../.env.local', import.meta.url)) ? fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n') : []) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\\\$/g, '$')
}
const { planMtgCatalog, stableStringify } = await import('./lib/catalog-sync.mjs')
const { getFirestore, collection, getDocs } = await import('firebase/firestore')
const { getApps } = await import('firebase/app')
const t0 = Date.now()
const fresh = await planMtgCatalog()
const tPlan = Date.now() - t0
const snap = await getDocs(collection(getFirestore(getApps()[0]), 'catalog', 'mtg', 'cards'))
const live = new Map(snap.docs.map((d) => [d.id, d.data()]))
let created = 0, updated = 0
const fields = {}
let bigMoves = 0
for (const c of fresh) {
  const ex = live.get(c.id)
  if (!ex) { created++; continue }
  const changed = Object.keys(c).filter((k) => stableStringify(ex[k]) !== stableStringify(c[k]))
  if (!changed.length) continue
  updated++
  for (const k of changed) fields[k] = (fields[k] ?? 0) + 1
  const a = ex.marketPrice || 0, b = c.marketPrice || 0
  if (a >= 1 && Math.abs(b - a) / a > 0.25) bigMoves++
}
console.log(JSON.stringify({ scryfallCards: fresh.length, liveCards: live.size, planSeconds: Math.round(tPlan / 1000), wouldCreate: created, wouldUpdate: updated, changedFields: fields, pricesMovedOver25pct: bigMoves, notInScryfallAnyMore: [...live.keys()].filter((id) => !fresh.some((c) => c.id === id)).length }, null, 2))
process.exit(0)
