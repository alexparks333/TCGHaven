/**
 * Read-only: would the next sync change anything a collector sees?
 *
 *   node scripts/check-collection.mjs <username…|--all> [--game pokemon|onepiece|all] [--out result.json]
 *
 * For each collector (every one who shares their Cardex with --all): reads their shared Cardex
 * (shared_cardex/{uid} — which cards they own: apiId, edition, finish, foil, grade, quantity;
 * readable by any signed-in user while they share it), the live catalog, and the catalog the next
 * sync would write (planPokemonCatalog() / planOnePieceCatalog(), plus Pokémon's backup-price step
 * with its cache save disabled), then compares every card they own: does its catalog card still
 * exist and stay visible, with the same name / set / number / picture / rarity, and what's it worth
 * (catalogPrice(), the app's one pricing rule) before vs after.
 *
 * Writes NOTHING.
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

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const outPath = flag('--out')
const gameArg = flag('--game') ?? 'all'
const all = args.includes('--all')
const usernames = args.filter((a, i) => !a.startsWith('--') && !['--out', '--game'].includes(args[i - 1])).map((u) => u.replace(/^@/, '').toLowerCase())
if (!all && !usernames.length) { console.error('Usage: node scripts/check-collection.mjs <username…|--all> [--game pokemon|onepiece|all] [--out file.json]'); process.exit(1) }
const GAMES = gameArg === 'all' ? ['pokemon', 'onepiece'] : [gameArg]

const { ensureSignedIn, planPokemonCatalog, planOnePieceCatalog, stableStringify } = await import('./lib/catalog-sync.mjs')
const { fillPokemonPriceGaps } = await import('./lib/price-fallback.mjs')
const { variantPrice } = await import('./lib/pokemon-variants.mjs')
const { getFirestore, collection, getDocs, doc, getDoc } = await import('firebase/firestore')
const { getApps } = await import('firebase/app')
const db = getFirestore(getApps()[0])
await ensureSignedIn()

// catalogPrice() from lib/pricing.ts — duplicated across the runtime boundary like the sync's other
// shared helpers (kept identical; compare when lib/pricing.ts changes)
function catalogPrice(game, card, { isFoil = false, edition, finish } = {}) {
  if ((game === 'pokemon' || game === 'yugioh' || game === 'fab') && (edition || finish)) {
    const vp = card.variantPrices
    if (vp && Object.keys(vp).length) return variantPrice(vp, { edition, finish, isFoil })
    if (edition && edition !== 'unlimited') return 0
    if (finish) isFoil = finish !== 'normal'
  }
  if (game === 'onepiece') return card.marketPrice ?? 0
  const base = card.marketPrice ?? 0
  const foil = card.marketPriceFoil ?? 0
  return isFoil ? (foil || base) : (base || foil)
}

// ── Collectors ──
const profiles = (await getDocs(collection(db, 'profiles'))).docs.map((d) => ({ uid: d.id, ...d.data() }))
const chosen = all ? profiles : usernames.map((u) => profiles.find((p) => p.username === u || p.displayName?.toLowerCase() === u) ?? (console.error(`No collector "${u}"`), process.exit(1)))
const collectors = []
for (const p of chosen) {
  const shared = await getDoc(doc(db, 'shared_cardex', p.uid)).catch(() => null) // private Cardex → refused
  if (!shared?.exists()) { console.log(`@${p.username}: doesn't share their Cardex — can't be checked`); continue }
  collectors.push({ username: p.username, displayName: p.displayName, owned: JSON.parse(shared.data().cards ?? '[]') })
}

// Which catalog a card belongs to (Japanese cards link to catalog/pokemon-jp, `jp-` ids)
const gameOf = (c) => (c.game === 'pokemon' ? (c.language === 'ja' || String(c.apiId ?? '').startsWith('jp-') ? 'pokemon-jp' : 'pokemon') : c.game)

// ── Before (live) and after (planned) per game ──
const FIELDS = ['name', 'setName', 'set', 'number', 'imageUrl', 'rarity', 'hidden']
const states = {}
for (const game of GAMES) {
  if (!collectors.some((c) => c.owned.some((x) => gameOf(x) === game))) continue
  const [cardsSnap, metaSnap] = await Promise.all([getDocs(collection(db, 'catalog', game, 'cards')), getDoc(doc(db, 'catalog_meta', game))])
  const before = new Map(cardsSnap.docs.map((d) => [d.id, d.data()]))
  const lastBulkSyncAt = metaSnap.data()?.lastBulkSyncAt ?? null
  console.log(`\nPlanning the next ${game} sync (fetches the sources, writes nothing)…`)
  const plan = game === 'pokemon' ? await planPokemonCatalog() : await planOnePieceCatalog()
  const fresh = plan.cards.map((c) => { const { _review, _groupId, ...card } = c; return card })
  if (game === 'pokemon') {
    const backup = (await getDoc(doc(db, 'catalog_meta', 'pokemon-price-backup'))).data() ?? null
    await fillPokemonPriceGaps(fresh.filter((c) => !c.id.startsWith('tcg-')), { loadCache: async () => backup, saveCache: async () => {} })
  }
  const freshById = new Map(fresh.map((c) => [c.id, c]))
  // syncToFirestore(): new → created; existing → changed fields replaced unless staff edited it
  // since the last sync; Pokémon's priceSource reset when no longer backup-priced; nothing deleted
  const afterOf = (id) => {
    const ex = before.get(id)
    const f = freshById.get(id)
    if (!ex) return f ? { ...f, hidden: false } : undefined
    if (!f) return ex
    if (lastBulkSyncAt && ex.updatedAt && ex.updatedAt.toMillis() > lastBulkSyncAt.toMillis()) return ex
    const out = { ...ex }
    for (const k of Object.keys(f)) if (stableStringify(ex[k]) !== stableStringify(f[k])) out[k] = f[k]
    if (game === 'pokemon' && !('priceSource' in f) && ex.priceSource) out.priceSource = ''
    return out
  }
  states[game] = { before, afterOf }
}

// ── Compare every card each collector owns ──
const results = []
const round = (n) => Math.round(n * 100) / 100
let totalProblems = 0
for (const col of collectors) {
  console.log(`\n══ @${col.username} (${col.displayName}) — ${col.owned.length} inventory rows ══`)
  const result = { username: col.username, games: {} }
  for (const game of GAMES) {
    const st = states[game]
    const mine = col.owned.filter((c) => gameOf(c) === game)
    if (!st || !mine.length) continue
    const rows = []
    let vb = 0, va = 0
    for (const c of mine) {
      const qty = Number(c.quantity) || 1
      const label = `${c.name} · ${c.set ?? ''} #${c.number ?? ''}${c.gradingCompany ? ` · ${c.gradingCompany} ${c.grade ?? ''}` : ''}${c.edition ? ` · ${c.edition}` : ''}${c.finish ? ` · ${c.finish}` : c.isFoil ? ' · foil' : ''}`
      if (!c.apiId) { rows.push({ label, qty, note: 'no catalog link (custom card) — not affected' }); continue }
      const b = st.before.get(c.apiId)
      const a = st.afterOf(c.apiId)
      const problems = []
      if (!b) problems.push('catalog card missing BEFORE (already unlinked today)')
      if (b && !a) problems.push('catalog card would disappear')
      if (b && a) for (const f of FIELDS) if (stableStringify(b[f] ?? null) !== stableStringify(a[f] ?? null)) problems.push(`${f}: ${JSON.stringify(b[f])} → ${JSON.stringify(a[f])}`)
      const choice = { isFoil: !!c.isFoil, edition: c.edition, finish: c.finish }
      const pb = b ? catalogPrice(game, b, choice) : 0
      const pa = a ? catalogPrice(game, a, choice) : 0
      vb += pb * qty; va += pa * qty
      rows.push({ label, apiId: c.apiId, qty, priceBefore: pb, priceAfter: pa, problems })
    }
    const linked = rows.filter((r) => r.apiId)
    const changed = linked.filter((r) => r.problems.length)
    const moved = linked.filter((r) => Math.abs(r.priceAfter - r.priceBefore) >= 0.01)
    totalProblems += changed.length
    console.log(`${game}: ${mine.length} rows (${mine.filter((c) => c.gradingCompany).length} graded) · card link / name / set / number / picture / rarity / visibility changed: ${changed.length} · price changed: ${moved.length}`)
    for (const r of changed) console.log(`   ✗ ${r.label} [${r.apiId}] — ${r.problems.join('; ')}`)
    for (const r of moved) console.log(`   • ${r.label} [${r.apiId}] ×${r.qty}: $${r.priceBefore} → $${r.priceAfter}`)
    console.log(`   value: $${round(vb)} → $${round(va)} · identical in every checked field and price: ${linked.length - new Set([...changed, ...moved]).size} of ${linked.length}`)
    result.games[game] = { rows, valueBefore: vb, valueAfter: va }
  }
  const untouched = col.owned.filter((c) => !GAMES.includes(gameOf(c)))
  if (untouched.length) console.log(`(${untouched.length} other rows — ${[...new Set(untouched.map(gameOf))].join(', ')} — not written by these syncs)`)
  results.push(result)
}
console.log(`\n${totalProblems === 0 ? '✓ No logged card changes its link, name, set, number, picture, rarity or visibility.' : `✗ ${totalProblems} logged card(s) would change — see above.`}`)
if (outPath) { fs.writeFileSync(outPath, JSON.stringify(results, null, 1)); console.log(`Full result: ${outPath}`) }
process.exit(totalProblems ? 2 : 0)
