#!/usr/bin/env node
/**
 * Catalog checks for the TCGplayer-sourced games — read-only, writes nothing.
 *   npm run tcgplayer-games-report                       (all five)
 *   npm run tcgplayer-games-report -- --only fab,swu --sample 30
 * docs/adding-a-game.md Phase 3; docs/games.md ("TCGplayer-sourced games").
 *
 * Plans each catalog exactly as a sync would (catalog-sync.mjs planTcgplayerGame) and checks:
 *   1. Every card's fields — name, number, set, rarity, photo; no duplicate ids.
 *   2. Prices — coverage per set (sets under half priced listed), outliers.
 *   3. Existing cards (after the first sync) — nothing a collector sees may change.
 * Then prints a seeded random sample with TCGplayer links for the owner to check by hand.
 * None of these games has a second free card list to compare against (TCGplayer is the only
 * source), so completeness is TCGplayer's own: every single it lists in the category.
 *
 * Exit 1 if something is wrong enough to stop a sync (duplicates, cards without a name or set, an
 * existing card that would change what collectors see); exit 0 otherwise. Needs .env.local.
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

const { ensureSignedIn, planTcgplayerGame } = await import('./lib/catalog-sync.mjs')
const { TCGPLAYER_GAMES, TCGPLAYER_GAME_IDS } = await import('./lib/tcgplayer-games.mjs')

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const games = arg('--only') ? arg('--only').split(',').map((s) => s.trim()) : TCGPLAYER_GAME_IDS
const SAMPLE = Number(arg('--sample')) || 20
for (const g of games) if (!TCGPLAYER_GAMES[g]) { console.error(`Unknown game "${g}" — one of ${TCGPLAYER_GAME_IDS.join(', ')}`); process.exit(2) }

const problems = []
await ensureSignedIn()

for (const game of games) {
  const cfg = TCGPLAYER_GAMES[game]
  console.log(`\n━━ ${cfg.label} (tcgcsv category ${cfg.category}) ━━`)
  const plan = await planTcgplayerGame(game)
  const cards = plan.cards

  // ── 1. Fields ──
  const ids = new Map()
  const bad = { name: [], number: [], set: [], rarity: [], photo: [] }
  for (const c of cards) {
    ids.set(c.id, (ids.get(c.id) ?? 0) + 1)
    if (!c.name) bad.name.push(c)
    if (!c.number) bad.number.push(c)
    if (!c.setName || !c.set) bad.set.push(c)
    if (!c.rarity) bad.rarity.push(c)
    if (!c.imageUrl) bad.photo.push(c)
  }
  const dupes = [...ids.entries()].filter(([, n]) => n > 1)
  console.log(`1. ${cards.length} cards in ${plan.sets.length} sets · duplicate ids ${dupes.length}`)
  for (const [k, list] of Object.entries(bad)) {
    const note = k === 'number' ? ' (promos and art cards TCGplayer lists without one)' : k === 'photo' ? ' (TCGplayer has no photo yet — shown as No Image, filled in by a later sync)' : ''
    console.log(`   no ${k.padEnd(6)} ${String(list.length).padStart(5)}${list.length ? `${note} — e.g. ${list.slice(0, 3).map((c) => `${c.id} "${c.name}" ${c.number}`).join(' | ')}` : ''}`)
  }
  if (dupes.length) problems.push(`${cfg.label}: ${dupes.length} duplicate ids`)
  if (bad.name.length || bad.set.length) problems.push(`${cfg.label}: cards without a name or set`)

  // ── 2. Prices ──
  const priced = cards.filter((c) => c.marketPrice > 0 || c.marketPriceFoil > 0)
  console.log(`2. ${priced.length} of ${cards.length} cards have a market price (${(priced.length / Math.max(1, cards.length) * 100).toFixed(1)}%)`)
  const coverage = new Map()
  for (const c of cards) {
    const s = coverage.get(c.setName) ?? { n: 0, p: 0 }
    s.n++; if (c.marketPrice > 0 || c.marketPriceFoil > 0) s.p++
    coverage.set(c.setName, s)
  }
  const thin = [...coverage.entries()].filter(([, s]) => s.n >= 20 && s.p / s.n < 0.5)
  console.log(`   sets (20+ cards) under half priced: ${thin.length}${thin.length ? ' — ' + thin.map(([n, s]) => `${n} ${s.p}/${s.n}`).join(' · ') : ''}`)
  const top = (c) => Math.max(c.marketPrice || 0, c.marketPriceFoil || 0, ...Object.values(c.variantPrices ?? {}))
  const outliers = cards.filter((c) => top(c) > 2000).sort((a, b) => top(b) - top(a))
  console.log(`   over $2,000 (each should be a real chase card): ${outliers.length}${outliers.length ? ' — ' + outliers.slice(0, 8).map((c) => `${c.name}${c.variant ? ` (${c.variant})` : ''} $${top(c).toFixed(0)}`).join(' · ') : ''}`)

  // ── 3. Existing cards ──
  let changed = 0
  for (const c of cards) {
    const old = plan.existing.get(c.id)
    if (!old) continue
    if (['name', 'number', 'set', 'setName', 'rarity', 'variant'].some((k) => (old[k] ?? '') !== (c[k] ?? ''))) changed++
    else if (old.imageUrl && old.imageUrl !== c.imageUrl) changed++
  }
  console.log(`3. existing cards: ${plan.existing.size} · would change what collectors see: ${changed}`)
  if (changed) problems.push(`${cfg.label}: ${changed} existing cards would change`)

  // ── Spot check ──
  console.log(`   Spot check — ${SAMPLE} random cards (seeded: the same list each run). Open each link and compare:`)
  let seed = 20261110 + cfg.category
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const picks = new Set()
  while (picks.size < Math.min(SAMPLE, cards.length)) picks.add(Math.floor(rnd() * cards.length))
  let i = 0
  for (const k of picks) {
    const c = cards[k]
    const price = c.variantPrices && Object.keys(c.variantPrices).length
      ? Object.entries(c.variantPrices).map(([p, v]) => `${p} $${v}`).join(', ')
      : [c.marketPrice ? `$${c.marketPrice}` : '', c.marketPriceFoil ? `foil $${c.marketPriceFoil}` : ''].filter(Boolean).join(' / ') || '—'
    console.log(`   ${String(++i).padStart(2)}  ${(c.name + (c.variant ? ` (${c.variant})` : '')).slice(0, 46).padEnd(46)} ${String(c.number).slice(0, 16).padEnd(17)} ${String(c.rarity).slice(0, 14).padEnd(15)} ${c.setName.slice(0, 30).padEnd(31)} ${price.slice(0, 34).padEnd(35)} https://www.tcgplayer.com/product/${c.tcgProductId}`)
  }
}

console.log(problems.length ? `\n✗ ${problems.join('; ')}` : '\n✓ No problems that should stop a sync')
process.exit(problems.length ? 1 : 0)
