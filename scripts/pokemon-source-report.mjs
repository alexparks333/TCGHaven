/**
 * Read-only report: what the English Pokémon sync (TCGplayer primary, GitHub secondary — see
 * scripts/lib/pokemon-tcgplayer.mjs) would do to the live catalog. Writes NOTHING to Firestore.
 *
 *   node scripts/pokemon-source-report.mjs [--out report.json]
 *
 * Runs the exact plan downloadPokemon() runs (planPokemonCatalog), then compares it card by card
 * with catalog/pokemon/cards as it is now.
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

const { planPokemonCatalog, stableStringify } = await import('./lib/catalog-sync.mjs')
const { getFirestore, collection, getDocs, doc, getDoc } = await import('firebase/firestore')
const { getApps } = await import('firebase/app')
const db = getFirestore(getApps()[0])

const outArg = process.argv.indexOf('--out')
const outPath = outArg > 0 ? process.argv[outArg + 1] : null

console.log('Planning (fetches GitHub + TCGplayer, writes nothing)…')
const plan = await planPokemonCatalog()
console.log('\nReading the live catalog…')
const [snap, metaSnap] = await Promise.all([getDocs(collection(db, 'catalog', 'pokemon', 'cards')), getDoc(doc(db, 'catalog_meta', 'pokemon'))])
const existing = new Map(snap.docs.map((d) => [d.id, d.data()]))
const lastBulkSyncAt = metaSnap.data()?.lastBulkSyncAt ?? null

const fresh = plan.cards.map((c) => { const { _review, ...card } = c; return card })
const freshIds = new Set(fresh.map((c) => c.id))

const created = []
const fieldChanges = {}
const lostPrintings = [] // an existing card whose variantPrices loses a key someone may have picked
const bigPriceMoves = []
const staffEdited = []
for (const card of fresh) {
  const ex = existing.get(card.id)
  if (!ex) { created.push(card); continue }
  if (lastBulkSyncAt && ex.updatedAt && ex.updatedAt.toMillis() > lastBulkSyncAt.toMillis()) { staffEdited.push(card.id); continue }
  for (const key of Object.keys(card)) {
    if (stableStringify(ex[key]) === stableStringify(card[key])) continue
    fieldChanges[key] = (fieldChanges[key] ?? 0) + 1
  }
  const before = ex.variantPrices ?? {}
  const after = card.variantPrices ?? {}
  const lost = Object.keys(before).filter((k) => before[k] > 0 && !(after[k] > 0))
  if (lost.length && !ex.priceSource) lostPrintings.push({ id: card.id, name: card.name, set: card.setName, lost, before, after })
  const m0 = ex.marketPrice || 0, m1 = card.marketPrice || 0
  if (!ex.priceSource && m0 >= 1 && Math.abs(m1 - m0) / m0 > 0.5) bigPriceMoves.push({ id: card.id, name: card.name, set: card.setName, before: m0, after: m1 })
}
const untouched = [...existing.keys()].filter((id) => !freshIds.has(id))

// A manually added card (Admin Catalog "Add Missing Card") the new cards might duplicate
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const customs = [...existing.entries()].filter(([, c]) => c.isCustom || c.source === 'manual')
const possibleDupes = []
for (const [id, c] of customs) {
  const twin = created.find((n) => n.setName === c.setName && norm(n.number) === norm(c.number))
    ?? created.find((n) => norm(n.name) === norm(c.name) && norm(n.number) === norm(c.number))
  if (twin) possibleDupes.push({ custom: id, name: c.name, set: c.setName, number: c.number, newCard: twin.id, newName: twin.name })
}

const byKey = (list, key) => Object.entries(list.reduce((m, x) => ((m[x[key]] = (m[x[key]] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])
const r = plan.report
const summary = {
  liveCatalogCards: existing.size,
  plannedCards: fresh.length,
  wouldCreate: created.length,
  wouldCreateBySet: byKey(created, 'setName'),
  existingCardsChanged: Object.values(fieldChanges).length ? fieldChanges : 'none',
  existingCardsUntouched: untouched.length,
  untouchedExamples: untouched.slice(0, 15),
  staffEditedSkipped: staffEdited.length,
  lostPrintings: lostPrintings.length,
  bigPriceMoves: bigPriceMoves.length,
  possibleDuplicatesOfManualCards: possibleDupes,
  linked: r.linked,
  variantsBySet: byKey(r.variants, 'set'),
  newSets: r.newSets,
  oddGroups: r.oddGroups,
  reviewCards: plan.placements.length,
  githubOnly: r.githubOnly.length,
  githubOnlyBySet: byKey(r.githubOnly, 'set').slice(0, 30),
  duplicateListings: r.duplicateListings.length,
  linkedElsewhere: r.linkedElsewhere.length,
  numberOnlyRejected: r.numberOnlyRejected.length,
  idMoves: r.idMoves,
  editionOnly: r.editionOnly.length,
  unnumberedInSets: r.unnumberedInSets.length,
  contentMatched: r.contentMatched,
  claimedCaughtUp: r.claimedCaughtUp,
  skippedGroups: r.skippedGroups,
  stalePriceSets: r.stalePriceSets,
  differences: r.differences.length,
  differencesByField: byKey(r.differences.flatMap((d) => d.diffs), 'field'),
  setsListed: plan.sets.length,
}
console.log('\n' + JSON.stringify(summary, null, 2))
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify({ summary, report: r, lostPrintings, bigPriceMoves, created: created.map(({ id, name, setName, number, rarity, imageUrl, marketPrice }) => ({ id, name, setName, number, rarity, imageUrl, marketPrice })), untouched, sets: plan.sets }, null, 1))
  console.log(`\nFull report: ${outPath}`)
}
process.exit(0)
