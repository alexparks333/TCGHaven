/**
 * Read-only: would the new English Pokémon sync change anything a collector sees?
 *
 *   node scripts/check-collection.mjs <username> [--out result.json]
 *
 * Reads the collector's shared Cardex (shared_cardex/{uid} — which cards they own: apiId, edition,
 * finish, foil, grade, quantity; readable by any signed-in user while they share their Cardex), the
 * live English Pokémon catalog, and the catalog the next sync would write (planPokemonCatalog(),
 * plus the same backup-price step, with its cache save disabled), then compares every card they
 * own: does its catalog card still exist and stay visible, with the same name / set / number /
 * picture / rarity, and what's it worth (catalogPrice(), the app's one pricing rule) before vs after.
 *
 * Writes NOTHING. Other games and Japanese cards are listed as untouched (this sync only writes
 * catalog/pokemon).
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

const username = process.argv[2]?.replace(/^@/, '').toLowerCase()
if (!username || username.startsWith('--')) { console.error('Usage: node scripts/check-collection.mjs <username> [--out file.json]'); process.exit(1) }
const outArg = process.argv.indexOf('--out')
const outPath = outArg > 0 ? process.argv[outArg + 1] : null

const { ensureSignedIn, planPokemonCatalog, stableStringify } = await import('./lib/catalog-sync.mjs')
const { fillPokemonPriceGaps } = await import('./lib/price-fallback.mjs')
const { variantPrice } = await import('./lib/pokemon-variants.mjs')
const { getFirestore, collection, getDocs, doc, getDoc, query, where } = await import('firebase/firestore')
const { getApps } = await import('firebase/app')
const db = getFirestore(getApps()[0])
await ensureSignedIn()

// catalogPrice() from lib/pricing.ts, Pokémon branch — duplicated across the runtime boundary like
// the sync's other shared helpers (kept identical; compare when lib/pricing.ts changes)
function catalogPrice(card, { isFoil = false, edition, finish } = {}) {
  if (edition || finish) {
    const vp = card.variantPrices
    if (vp && Object.keys(vp).length) return variantPrice(vp, { edition, finish, isFoil })
    if (edition && edition !== 'unlimited') return 0
    if (finish) isFoil = finish !== 'normal'
  }
  const base = card.marketPrice ?? 0
  const foil = card.marketPriceFoil ?? 0
  return isFoil ? (foil || base) : (base || foil)
}

// ── Who ──
let uid = (await getDoc(doc(db, 'usernames', username))).data()?.uid
if (!uid) {
  const snap = await getDocs(query(collection(db, 'profiles'), where('displayNameLower', '>=', username), where('displayNameLower', '<=', `${username}`)))
  if (snap.size === 1) uid = snap.docs[0].id
  else { console.error(`No unique collector for "${username}" (${snap.size} display-name matches: ${snap.docs.map((d) => `@${d.data().username} / ${d.data().displayName}`).join(', ')})`); process.exit(1) }
}
const profile = (await getDoc(doc(db, 'profiles', uid))).data() ?? {}
const shared = await getDoc(doc(db, 'shared_cardex', uid))
if (!shared.exists()) { console.error(`@${profile.username} doesn't share their Cardex — can't read their cards`); process.exit(1) }
const owned = JSON.parse(shared.data().cards ?? '[]')
console.log(`@${profile.username} (${profile.displayName}) — ${owned.length} inventory rows, shared ${shared.data().updatedAt?.toDate?.().toISOString() ?? '?'}`)

// Japanese cards link to catalog/pokemon-jp (`jp-` ids), whatever their language field says
const isEnglishPokemon = (c) => c.game === 'pokemon' && c.language !== 'ja' && !String(c.apiId ?? '').startsWith('jp-')
const pokemonEn = owned.filter(isEnglishPokemon)
const others = owned.filter((c) => !isEnglishPokemon(c))
console.log(`   ${pokemonEn.length} English Pokémon rows (${pokemonEn.filter((c) => c.gradingCompany).length} graded), ${others.length} other rows (not touched by this sync)`)

// ── Before: the live catalog ──
const [cardsSnap, metaSnap] = await Promise.all([getDocs(collection(db, 'catalog', 'pokemon', 'cards')), getDoc(doc(db, 'catalog_meta', 'pokemon'))])
const before = new Map(cardsSnap.docs.map((d) => [d.id, d.data()]))
const lastBulkSyncAt = metaSnap.data()?.lastBulkSyncAt ?? null

// ── After: what the next sync writes (same steps as downloadPokemon, nothing saved) ──
console.log('\nPlanning the next sync (fetches GitHub + TCGplayer, writes nothing)…')
const plan = await planPokemonCatalog()
const fresh = plan.cards.map((c) => { const { _review, ...card } = c; return card })
const backup = (await getDoc(doc(db, 'catalog_meta', 'pokemon-price-backup'))).data() ?? null
await fillPokemonPriceGaps(fresh.filter((c) => !c.id.startsWith('tcg-')), { loadCache: async () => backup, saveCache: async () => {} })
const freshById = new Map(fresh.map((c) => [c.id, c]))
// syncToFirestore(): new → created; existing → changed fields replaced unless staff edited it
// since the last sync; priceSource reset to '' when a card no longer has a backup price; nothing
// is ever deleted
function afterOf(id) {
  const ex = before.get(id)
  const f = freshById.get(id)
  if (!ex) return f ? { ...f, hidden: false } : undefined
  if (!f) return ex
  if (lastBulkSyncAt && ex.updatedAt && ex.updatedAt.toMillis() > lastBulkSyncAt.toMillis()) return ex
  const out = { ...ex }
  for (const k of Object.keys(f)) if (stableStringify(ex[k]) !== stableStringify(f[k])) out[k] = f[k]
  if (!('priceSource' in f) && ex.priceSource) out.priceSource = ''
  return out
}

// ── Compare every card ──
const FIELDS = ['name', 'setName', 'set', 'number', 'imageUrl', 'rarity', 'hidden']
const rows = []
let valueBefore = 0, valueAfter = 0
for (const c of pokemonEn) {
  const qty = Number(c.quantity) || 1
  const label = `${c.name} · ${c.set ?? ''} #${c.number ?? ''}${c.gradingCompany ? ` · ${c.gradingCompany} ${c.grade ?? ''}` : ''}${c.edition ? ` · ${c.edition}` : ''}${c.finish ? ` · ${c.finish}` : c.isFoil ? ' · foil' : ''}`
  if (!c.apiId) { rows.push({ label, qty, status: 'no catalog link (custom card) — not affected' }); continue }
  const b = before.get(c.apiId)
  const a = afterOf(c.apiId)
  const problems = []
  if (!b) problems.push('catalog card missing BEFORE (already unlinked today)')
  if (b && !a) problems.push('catalog card would disappear')
  if (b && a) for (const f of FIELDS) if (stableStringify(b[f] ?? null) !== stableStringify(a[f] ?? null)) problems.push(`${f}: ${JSON.stringify(b[f])} → ${JSON.stringify(a[f])}`)
  const choice = { isFoil: !!c.isFoil, edition: c.edition, finish: c.finish }
  const pb = b ? catalogPrice(b, choice) : 0
  const pa = a ? catalogPrice(a, choice) : 0
  valueBefore += pb * qty
  valueAfter += pa * qty
  rows.push({ label, apiId: c.apiId, qty, priceBefore: pb, priceAfter: pa, problems })
}

const changedIdentity = rows.filter((r) => r.problems?.length)
const priceMoved = rows.filter((r) => r.apiId && Math.abs((r.priceAfter ?? 0) - (r.priceBefore ?? 0)) >= 0.01)
const round = (n) => Math.round(n * 100) / 100
console.log(`\n══ @${profile.username}: ${pokemonEn.length} English Pokémon rows checked ══`)
console.log(`Card link / name / set / number / picture / rarity / visibility changed: ${changedIdentity.length}`)
for (const r of changedIdentity) console.log(`   ✗ ${r.label} [${r.apiId}] — ${r.problems.join('; ')}`)
console.log(`Price changed: ${priceMoved.length}`)
for (const r of priceMoved) console.log(`   • ${r.label} [${r.apiId}] ×${r.qty}: $${r.priceBefore} → $${r.priceAfter}`)
console.log(`English Pokémon value: $${round(valueBefore)} → $${round(valueAfter)} (${valueAfter >= valueBefore ? '+' : ''}${round(valueAfter - valueBefore)})`)
console.log(`Other rows (${others.length}: ${[...new Set(others.map((c) => (c.game === 'pokemon' ? 'pokemon-jp' : c.game)))].join(', ')}) — not written by this sync`)
const unchanged = rows.filter((r) => r.apiId && !r.problems?.length && Math.abs((r.priceAfter ?? 0) - (r.priceBefore ?? 0)) < 0.01).length
console.log(`Identical in every checked field and price: ${unchanged} of ${rows.filter((r) => r.apiId).length} linked rows`)
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify({ username: profile.username, rows, valueBefore, valueAfter }, null, 1))
  console.log(`\nFull result: ${outPath}`)
}
process.exit(0)
