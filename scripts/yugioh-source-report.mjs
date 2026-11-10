#!/usr/bin/env node
/**
 * Yu-Gi-Oh! catalog checks — read-only, writes nothing. `npm run yugioh-source-report`
 * (add `-- --sample 50` for the owner's spot-check table). docs/adding-a-game.md Phase 3.
 *
 * Plans the catalog exactly as a sync would (catalog-sync.mjs planYugiohCatalog — TCGplayer, the
 * primary source) and checks it three ways:
 *   1. Completeness — against YGOPRODeck (db.ygoprodeck.com, a second, independent card list):
 *      every English set code it lists that TCGplayer also sells should be a card here.
 *   2. Every card's fields — name, printed number pattern, set, rarity, photo; no duplicates.
 *   3. Prices — coverage per set, outliers, and (once written) existing cards unchanged.
 * Then prints a seeded random sample with TCGplayer links for the owner to check by hand.
 *
 * Exit 1 if something is wrong enough to stop a sync (duplicates, missing fields, an existing card
 * that would change what collectors see); exit 0 otherwise. Needs .env.local (reads the catalog).
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

const { ensureSignedIn, planYugiohCatalog } = await import('./lib/catalog-sync.mjs')
const { ygoKey } = await import('./lib/yugioh-tcgplayer.mjs')

const sampleArg = process.argv.indexOf('--sample')
const SAMPLE = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) || 50 : 50
const problems = []

await ensureSignedIn()
const plan = await planYugiohCatalog()
const cards = plan.cards

// ── 1. Completeness against YGOPRODeck ──────────────────────────────────────
console.log('\n1. Completeness — against YGOPRODeck')
const ygoRes = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php', { headers: { 'User-Agent': 'TCGHaven-catalog-check/1.0' } })
if (!ygoRes.ok) {
  console.log(`   YGOPRODeck unavailable (${ygoRes.status}) — skipped`)
} else {
  const ygo = (await ygoRes.json()).data ?? []
  const ours = new Set(cards.map((c) => ygoKey(c.number)))
  const tcgSets = new Set(cards.map((c) => c.set))
  const theirs = new Map()
  for (const card of ygo) {
    for (const s of card.card_sets ?? []) {
      const code = String(s.set_code ?? '')
      // English codes only, and only sets TCGplayer sells at all (a set TCGplayer doesn't carry —
      // Speed Duel, European-only printings — can't be priced, so it's out of scope)
      const region = code.match(/^[A-Z0-9]+-([A-Z]{1,2})\d/)
      if (region && !['EN', 'E'].includes(region[1])) continue
      if (!tcgSets.has(code.split('-')[0])) continue
      if (/speed duel|rush duel/i.test(s.set_name)) continue
      theirs.set(ygoKey(code), { name: card.name, set: s.set_name })
    }
  }
  const missing = [...theirs.entries()].filter(([k]) => !ours.has(k))
  const bySet = new Map()
  for (const [, v] of missing) bySet.set(v.set, (bySet.get(v.set) ?? 0) + 1)
  console.log(`   YGOPRODeck lists ${theirs.size} English set codes in sets TCGplayer sells; ${theirs.size - missing.length} are cards here (${((1 - missing.length / Math.max(1, theirs.size)) * 100).toFixed(1)}%)`)
  console.log(`   Missing here: ${missing.length}${missing.length ? ' — by set: ' + [...bySet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, n]) => `${s} ${n}`).join(' · ') : ''}`)
  if (missing.length) console.log(`   e.g. ${missing.slice(0, 6).map(([k, v]) => `${k} ${v.name}`).join(' | ')}`)
  console.log('   (A missing code is usually a printing TCGplayer files under another number — e.g. War of the')
  console.log('    Giants Reinforcements as BPW2-… — or a card TCGplayer doesn\'t list. Nothing is invented to fill it.)')
}

// ── 2. Every card's fields ──────────────────────────────────────────────────
console.log('\n2. Every card\'s fields')
const NUMBER = /^[A-Z0-9]{2,6}-[A-Z0-9]{2,7}[a-zA-Z]?$/   // "MAMS-EN001", "LOB-001", "BETB-ENSP1"
const ids = new Map()
const bad = { name: [], number: [], set: [], rarity: [], image: [] }
for (const c of cards) {
  ids.set(c.id, (ids.get(c.id) ?? 0) + 1)
  if (!c.name) bad.name.push(c)
  if (!NUMBER.test(c.number)) bad.number.push(c)
  if (!c.setName || !c.set) bad.set.push(c)
  if (!c.rarity) bad.rarity.push(c)
  if (!c.imageUrl) bad.image.push(c)
}
const dupes = [...ids.entries()].filter(([, n]) => n > 1)
console.log(`   ${cards.length} cards in ${plan.sets.length} sets · duplicate ids ${dupes.length}`)
for (const [k, list] of Object.entries(bad)) {
  console.log(`   ${k.padEnd(7)} problems: ${list.length}${list.length ? ' — e.g. ' + list.slice(0, 3).map((c) => `${c.id} "${c.name}" ${c.number}`).join(' | ') : ''}`)
}
const oddNumbers = cards.filter((c) => /[A-Z]-[A-Z]{2}O\d|\dO\d/.test(c.number))
console.log(`   numbers with a letter O typed for a 0 on TCGplayer: ${oddNumbers.length} (kept as TCGplayer has them; search and the scanner treat O as 0)`)
if (dupes.length) problems.push(`${dupes.length} duplicate ids`)
if (bad.name.length || bad.set.length) problems.push('cards without a name or set')

// ── 3. Prices ───────────────────────────────────────────────────────────────
console.log('\n3. Prices')
const priced = cards.filter((c) => c.marketPrice > 0)
console.log(`   ${priced.length} of ${cards.length} cards have a market price (${(priced.length / cards.length * 100).toFixed(1)}%)`)
const coverage = new Map()
for (const c of cards) {
  const s = coverage.get(c.setName) ?? { n: 0, p: 0 }
  s.n++; if (c.marketPrice > 0) s.p++
  coverage.set(c.setName, s)
}
const thin = [...coverage.entries()].filter(([, s]) => s.n >= 20 && s.p / s.n < 0.5)
console.log(`   sets (20+ cards) with under half their cards priced: ${thin.length}${thin.length ? ' — ' + thin.slice(0, 8).map(([n, s]) => `${n} ${s.p}/${s.n}`).join(' · ') : ''}`)
const outliers = cards.filter((c) => Object.values(c.variantPrices ?? {}).some((p) => p > 5000))
console.log(`   printings over $5,000 (each should be a real chase card): ${outliers.length}${outliers.length ? ' — ' + outliers.slice(0, 8).map((c) => `${c.name} [${c.rarity}] $${Math.max(...Object.values(c.variantPrices)).toFixed(0)}`).join(' · ') : ''}`)

// Existing cards (after the first sync): nothing a collector sees may change
let changed = 0
for (const c of cards) {
  const old = plan.existing.get(c.id)
  if (!old) continue
  for (const k of ['name', 'number', 'set', 'setName', 'rarity', 'variant']) {
    if ((old[k] ?? '') !== (c[k] ?? '')) { changed++; break }
  }
  if (old.imageUrl && old.imageUrl !== c.imageUrl) changed++
}
console.log(`   existing cards: ${plan.existing.size} · would change what collectors see: ${changed}`)
if (changed) problems.push(`${changed} existing cards would change`)

// ── The owner's spot check ──────────────────────────────────────────────────
console.log(`\nSpot check — ${SAMPLE} random cards (seeded, so the same list each run). Open each link and compare:`)
let seed = 20261110
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const picks = new Set()
while (picks.size < Math.min(SAMPLE, cards.length)) picks.add(Math.floor(rnd() * cards.length))
console.log('   #   name                                         number        rarity                 set                               price      TCGplayer')
let i = 0
for (const k of [...picks]) {
  const c = cards[k]
  const price = Object.entries(c.variantPrices ?? {}).map(([p, v]) => `${p.split(':')[0]} $${v}`).join(', ') || '—'
  console.log(`   ${String(++i).padStart(2)}  ${(c.name + (c.variant ? ` (${c.variant})` : '')).slice(0, 44).padEnd(44)} ${c.number.padEnd(13)} ${c.rarity.slice(0, 22).padEnd(22)} ${c.setName.slice(0, 32).padEnd(33)} ${price.padEnd(10)} https://www.tcgplayer.com/product/${c.tcgProductId}`)
}

console.log(problems.length ? `\n✗ ${problems.join('; ')}` : '\n✓ No problems that should stop a sync')
process.exit(problems.length ? 1 : 0)
