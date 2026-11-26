/**
 * Stagnant prices — the catalog cards whose price nothing updates on its own (no sync price, no
 * TCGplayer product, no PriceCharting ungraded price; scripts/lib/stagnant.mjs has the rule), and the way an
 * AI agent (or anyone) prices them by hand. Staff only — collectors never see the word.
 * docs/catalog.md "Stagnant prices"; the agent's instructions: .claude/commands/update-stagnant-prices.md
 *
 *   npm run stagnant-prices -- list                        # every game, a table
 *   npm run stagnant-prices -- list --game riftbound --json
 *   npm run stagnant-prices -- set riftbound ckx-ogn-303a-298 450 --note "eBay sold: 3 sales Nov 2026, $420–$480"
 *   npm run stagnant-prices -- set riftbound <id> 12.5 --foil 30 --note "…"   # a foil price too
 *
 * `set` refuses a card a sync prices (it isn't stagnant) and writes marketPrice (+ marketPriceFoil),
 * priceSource 'manual', manualPriceAt, manualPriceNote, updatedAt. Every sync keeps that price until
 * it finds a real one. The app picks it up within ~2 minutes (the catalog cache's updatedAt deltas).
 * Reads the compressed catalog snapshots + the changes since (cheap).
 * Needs ADMIN_EMAIL / ADMIN_PASSWORD and the NEXT_PUBLIC_FIREBASE_* vars, like download-cards.
 */
import fs from 'node:fs'

function loadEnvLocal() {
  const path = new URL('../.env.local', import.meta.url)
  if (!fs.existsSync(path)) return
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.replace(/\r$/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/\\\$/g, '$') // CLAUDE.md rule 23
  }
}
loadEnvLocal()

const { ensureSignedIn, getCatalogDb } = await import('./lib/catalog-sync.mjs')
const { readCompressedSnapshot } = await import('./lib/snapshot-codec.mjs')
const { stagnantReason, STAGNANT_SKIP_GAMES } = await import('./lib/stagnant.mjs')
const { collection, doc, getDoc, getDocs, query, where, updateDoc, serverTimestamp, Timestamp } = await import('firebase/firestore')

const CATALOGS = ['pokemon', 'pokemon-jp', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh',
  'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk'].filter((g) => !STAGNANT_SKIP_GAMES.has(g))

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const cmd = args[0]

async function loadCards(db, game) {
  const map = new Map()
  const snap = await readCompressedSnapshot(db, game)
  const since = snap?.asOf ?? new Date(0)
  for (const c of snap?.cards ?? []) map.set(c.id, c)
  const q = snap ? query(collection(db, 'catalog', game, 'cards'), where('updatedAt', '>', Timestamp.fromDate(since)))
    : collection(db, 'catalog', game, 'cards')
  for (const d of (await getDocs(q)).docs) map.set(d.id, { ...d.data(), id: d.id })
  return [...map.values()]
}

async function list() {
  const games = flag('--game')?.split(',') ?? CATALOGS
  const bad = games.filter((g) => !CATALOGS.includes(g))
  if (bad.length) throw new Error(`--game takes: ${CATALOGS.join(', ')}`)
  const db = getCatalogDb()
  const out = []
  for (const game of games) {
    for (const c of await loadCards(db, game)) {
      const reason = stagnantReason(c)
      if (!reason) continue
      out.push({
        game, id: c.id, name: c.name, set: c.setName ?? c.set ?? '', number: c.number ?? '', rarity: c.rarity ?? '', reason,
        marketPrice: c.marketPrice ?? 0, marketPriceFoil: c.marketPriceFoil ?? 0,
        manualPriceAt: c.manualPriceAt || null, manualPriceNote: c.manualPriceNote || null, imageUrl: c.imageUrl || null,
      })
    }
  }
  // Never-priced first, then the oldest hand price
  out.sort((a, b) => (a.manualPriceAt ? 1 : 0) - (b.manualPriceAt ? 1 : 0) || String(a.manualPriceAt).localeCompare(String(b.manualPriceAt)) || a.game.localeCompare(b.game) || a.set.localeCompare(b.set))
  if (args.includes('--json')) { console.log(JSON.stringify(out, null, 1)); return }
  const byGame = {}
  for (const r of out) byGame[r.game] = (byGame[r.game] ?? 0) + 1
  console.log(`${out.length} stagnant card(s):`, byGame)
  const limit = Number(flag('--limit') ?? 200)
  for (const r of out.slice(0, limit)) {
    const price = r.marketPrice ? `$${r.marketPrice}${r.marketPriceFoil ? ` / $${r.marketPriceFoil} foil` : ''}` : '—'
    console.log(`${r.game.padEnd(10)} ${r.id.padEnd(28)} ${price.padEnd(18)} ${r.reason.padEnd(10)} ${r.set} · #${r.number} · ${r.name}${r.manualPriceAt ? ` (priced ${r.manualPriceAt.slice(0, 10)})` : ''}`)
  }
  if (out.length > limit) console.log(`… ${out.length - limit} more (--limit, or --json for all)`)
}

async function set() {
  const [, game, id, priceArg] = args
  const price = Number(priceArg)
  const foilArg = flag('--foil')
  const foil = foilArg === undefined ? undefined : Number(foilArg)
  const note = (flag('--note') ?? '').trim()
  // A hand price must be a real price (> 0) — $0 reads as "no price" everywhere else
  if (!CATALOGS.includes(game) || !id || !(price > 0) || (foil !== undefined && !(foil > 0))) {
    throw new Error('usage: set <game> <card id> <price> [--foil <price>] --note "<where the price came from>"')
  }
  if (!note) throw new Error('--note is required: say where the price came from (e.g. "eBay sold, 3 sales Nov 2026")')
  const db = getCatalogDb()
  const ref = doc(db, 'catalog', game, 'cards', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error(`No ${game} card ${id}`)
  const card = { ...snap.data(), id }
  const reason = stagnantReason(card)
  if (!reason) throw new Error(`${id} isn't stagnant — TCGplayer or PriceCharting keeps its price live, so a hand price would be overwritten`)
  const patch = {
    marketPrice: price, priceSource: 'manual', manualPriceAt: new Date().toISOString(), manualPriceNote: note.slice(0, 300),
    ...(foil !== undefined && { marketPriceFoil: foil }), updatedAt: serverTimestamp(),
  }
  if (args.includes('--dry-run')) { console.log('dry run —', id, JSON.stringify({ ...patch, updatedAt: 'now' })); return }
  await updateDoc(ref, patch)
  console.log(`✓ ${game} ${id} (${card.name}): $${price}${foil !== undefined ? ` / $${foil} foil` : ''} — was $${card.marketPrice ?? 0}`)
}

if (cmd !== 'list' && cmd !== 'set') {
  console.error('npm run stagnant-prices -- list [--game g1,g2] [--json] [--limit n]\nnpm run stagnant-prices -- set <game> <id> <price> [--foil <price>] --note "<source>" [--dry-run]')
  process.exit(1)
}
await ensureSignedIn()
await (cmd === 'list' ? list() : set()).then(() => process.exit(0), (err) => { console.error(err.message); process.exit(1) })
