/**
 * One-off cleanup (2026-11-16): hides the Lorcana catalog's TCGplayer copies (`tcg-{productId}`) of cards
 * Lorcast already has. A past sync ran while Lorcast was failing, so every numbered set's TCGplayer group
 * looked "unknown" and was added a second time — every Cardex slot showed the card twice. The sync now
 * skips that step when Lorcast answers short (downloadLorcana's LORCAST_HEALTHY_MIN).
 *
 * A copy is hidden only when it's an exact twin: same set, same name (TCGplayer's "(Epic)" / "(Enchanted)" / "(Iconic)"
 * ending aside), same collector number as a Lorcast
 * card. Anything less certain is listed, never touched (Needs Review / Admin Catalog can decide those).
 * Hidden, not deleted: price lookups read hidden cards too (lib/api/catalog.ts loadCatalog), so anyone who
 * added one of the copies keeps its price; Admin Catalog → Unhide brings any back.
 *
 * Usage:
 *   node scripts/hide-lorcana-duplicates.mjs           # dry run — lists what it would hide
 *   node scripts/hide-lorcana-duplicates.mjs --apply   # hides them (signs in as the sync bot)
 */

import fs from 'node:fs'

// .env.local, read the same way download-card-catalog.mjs does (a `\$` in a value is a literal `$`)
function loadEnvLocal() {
  const path = new URL('../.env.local', import.meta.url)
  if (!fs.existsSync(path)) return
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/\r$/, '').replace(/\\\$/g, '$')
  }
}
loadEnvLocal()

const { initializeApp } = await import('firebase/app')
const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth')
const { getFirestore, collection, getDocs, writeBatch, serverTimestamp } = await import('firebase/firestore')

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
})
const db = getFirestore(app)

const apply = process.argv.includes('--apply')
// TCGplayer names a card's Epic / Enchanted / Iconic version 'Elsa - Snow Queen (Epic)'; Lorcast calls that same #210
// card just 'Elsa - Snow Queen' — so that one ending is ignored. Other endings (Oversized, Promo…) are different products.
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/ \((epic|enchanted|iconic)\)$/, '')
// The full collector number, letter kept: "4a" ≠ "4b" (Dalmatian Puppy 4a–4e are five different arts);
// "0/204" and "007" read as "0" and "7"
const num = (n) => String(n ?? '').split('/')[0].trim().toLowerCase().replace(/^0+(?=\w)/, '')
// TCGplayer puts a lettered card's number in its name — "Dalmatian Puppy - Tail Wagger (4a/204)", number "4" —
// so that ending is the real number, and comes off the name
const parts = (c) => {
  const m = String(c.name ?? '').match(/^(.*) \((\d+[a-z]?)\/\d+\)$/i)
  return m ? { name: m[1], number: m[2] } : { name: c.name, number: c.number }
}

const snap = await getDocs(collection(db, 'catalog', 'lorcana', 'cards'))
const all = snap.docs.map((d) => ({ ref: d.ref, ...d.data(), id: d.id }))
const lorcast = all.filter((c) => !c.id.startsWith('tcg-'))
const twinKey = (c) => { const p = parts(c); return `${c.setName}|${norm(p.name)}|${num(p.number)}` }
const lorcastKeys = new Set(lorcast.map(twinKey))

const copies = all.filter((c) => c.id.startsWith('tcg-') && !c.hidden)
// --ids <file.json>: hide exactly these tcg- cards instead (checked by hand — e.g. the same card spelled
// differently, "Te Ka" / "Te Kā", or a "(Foil)" product whose Lorcast twin already carries the foil price)
const idsFile = process.argv.includes('--ids') ? process.argv[process.argv.indexOf('--ids') + 1] : null
const listed = idsFile ? new Set(JSON.parse(fs.readFileSync(idsFile, 'utf8'))) : null
const twins = listed ? copies.filter((c) => listed.has(c.id)) : copies.filter((c) => lorcastKeys.has(twinKey(c)))
if (listed) console.log(`Hiding a hand-checked list: ${listed.size} ids, ${twins.length} of them visible tcg- cards.`)
const lorcastSets = new Set(lorcast.map((c) => c.setName))
const leftInRealSets = copies.filter((c) => !lorcastKeys.has(twinKey(c)) && lorcastSets.has(c.setName))

console.log(`Lorcana catalog: ${all.length} cards — ${lorcast.length} from Lorcast, ${copies.length} visible TCGplayer (tcg-) cards.`)
const bySet = (list) => Object.entries(list.reduce((m, c) => ((m[c.setName] = (m[c.setName] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1])
console.log(`\nExact twins of a Lorcast card (to hide): ${twins.length}`)
for (const [s, n] of bySet(twins)) console.log(`  ${s}: ${n}`)
console.log(`\nOther tcg- cards in Lorcast's own sets — not exact twins, left alone for review: ${leftInRealSets.length}`)
for (const [s, n] of bySet(leftInRealSets)) console.log(`  ${s}: ${n}`)
console.log('  e.g.', leftInRealSets.slice(0, 8).map((c) => `${c.name} #${c.number} (${c.rarity})`).join(' · '))

if (!apply) {
  console.log('\nDry run — nothing changed. Re-run with --apply to hide the exact twins.')
  process.exit(0)
}

if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL / ADMIN_PASSWORD missing from .env.local')
await signInWithEmailAndPassword(getAuth(app), process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
for (let i = 0; i < twins.length; i += 400) {
  const batch = writeBatch(db)
  // updatedAt: every server's catalog cache picks the change up from its delta pull (lib/api/catalog.ts)
  for (const c of twins.slice(i, i + 400)) batch.update(c.ref, { hidden: true, updatedAt: serverTimestamp() })
  await batch.commit()
}
console.log(`\nHid ${twins.length} duplicate cards. Servers pick it up within ~2 minutes; the next Lorcana sync rewrites the snapshot.`)
process.exit(0)
