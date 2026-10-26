// One-off cleanup (2026-10-26): before pokemon-variants.mjs, the Pokémon sync priced WotC-era
// cards (Jungle, Fossil, Team Rocket, Gym, Neo, …) at whichever edition row TCGplayer listed
// first — usually 1st Edition — so every price-history day recorded before the fix holds that
// inflated price. Left alone, an Unlimited Jungle Snorlax would show a fake -63% on Portfolio's
// 24h/7d/30d windows. This removes those cards' entries from history days written by the old
// sync, so their history simply starts at the fix.
//
// Which entries: cards that now have a non-Unlimited edition price (the ones the bug touched),
// except Base Set — its 1st Edition/Shadowless prices come from a TCGplayer group the old sync
// never matched, so its old history was already the right (Unlimited) price. Only entries without
// the 5th "printings" element are removed: every day written by the fixed sync carries it for
// these cards (price-history.mjs's historyNeedsVariants), so re-running is harmless.
//
//   node scripts/fix-vintage-history.mjs           # dry run — prints what it would remove
//   node scripts/fix-vintage-history.mjs --apply   # writes

import fs from 'node:fs'

for (const line of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/\\\$/g, '$')
}
const { ensureSignedIn } = await import('./lib/catalog-sync.mjs')
const { getFirestore, collection, getDocs, doc, updateDoc } = await import('firebase/firestore')
const { getApps } = await import('firebase/app')
const { editionsOf } = await import('./lib/pokemon-variants.mjs')
const { PRICE_HISTORY_COLLECTION } = await import('./lib/price-history.mjs')

const apply = process.argv.includes('--apply')
const db = getFirestore(getApps()[0])
await ensureSignedIn()

const chunks = await getDocs(collection(db, 'catalog_snapshot', 'pokemon', 'chunks'))
const affected = new Set()
for (const c of chunks.docs.flatMap((d) => JSON.parse(d.data().cards))) {
  if (c.set === 'base1') continue
  if (editionsOf(c.variantPrices).some((e) => e !== 'unlimited')) affected.add(c.id)
}
console.log(`${affected.size} vintage cards had edition-inflated history`)

const months = await getDocs(collection(db, PRICE_HISTORY_COLLECTION, 'pokemon', 'months'))
let docsTouched = 0
let entriesRemoved = 0
for (const m of months.docs) {
  const days = m.data().days ?? {}
  const updates = {}
  for (const [dd, raw] of Object.entries(days)) {
    let day
    try { day = JSON.parse(raw) } catch { continue }
    let removed = 0
    for (const id of Object.keys(day.p ?? {})) {
      if (affected.has(id) && day.p[id].length < 5) { delete day.p[id]; removed++ }
    }
    if (removed) { updates[`days.${dd}`] = JSON.stringify(day); entriesRemoved += removed }
  }
  if (!Object.keys(updates).length) continue
  docsTouched++
  console.log(`  ${m.id}: ${Object.keys(updates).length} day(s)`)
  if (apply) await updateDoc(doc(db, PRICE_HISTORY_COLLECTION, 'pokemon', 'months', m.id), updates)
}
console.log(`${apply ? 'Removed' : 'Would remove'} ${entriesRemoved} entries across ${docsTouched} month doc(s)${apply ? '' : ' — re-run with --apply to write'}`)
process.exit(0)
