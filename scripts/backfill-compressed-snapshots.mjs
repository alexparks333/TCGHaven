// One-off (2026-10-26): builds each catalog's compressed snapshot (snapshot-codec.mjs) from its
// existing plain snapshot, so cold server instances get the fast path before the next sync writes
// one anyway. Reads the snapshot chunk docs plus the cards changed since
// they were written; writes ~30 small docs.
//
//   node scripts/backfill-compressed-snapshots.mjs

import fs from 'node:fs'

for (const line of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/\\\$/g, '$')
}
const { ensureSignedIn } = await import('./lib/catalog-sync.mjs')
const { getFirestore, collection, getDocs, query, where, Timestamp } = await import('firebase/firestore')
const { getApps } = await import('firebase/app')
const { writeCompressedSnapshot, readCompressedSnapshot } = await import('./lib/snapshot-codec.mjs')

const db = getFirestore(getApps()[0])
await ensureSignedIn()

for (const game of ['pokemon', 'pokemon-jp', 'lorcana', 'riftbound', 'onepiece', 'mtg']) {
  const chunks = await getDocs(collection(db, 'catalog_snapshot', game, 'chunks'))
  const cards = chunks.docs.sort((x, y) => +x.id - +y.id).flatMap((d) => (d.data().cards ? JSON.parse(d.data().cards) : []))
  if (!cards.length) { console.log(`${game}: no snapshot, skipped`); continue }
  // Bring the cards up to date, then stamp the snapshot with when that was. Each card in the plain
  // snapshot carries an updatedAt, but a sync writes the snapshot from its in-memory copies, which
  // keep the timestamp from before the sync changed them — so "newest updatedAt" lags (by 31k
  // cards for MTG). Pulling everything changed since then once, here, means the app's cold start
  // pulls almost nothing. (lastBulkSyncAt doesn't work either: it's stamped before a sync writes.)
  const newest = Math.max(0, ...cards.map((c) => (c.updatedAt?.seconds ?? 0) * 1000))
  const asOf = new Date()
  const changed = await getDocs(query(collection(db, 'catalog', game, 'cards'), where('updatedAt', '>', Timestamp.fromMillis(newest - 60_000))))
  const byId = new Map(cards.map((c) => [c.id, c]))
  for (const d of changed.docs) byId.set(d.id, { ...d.data(), id: d.id })
  cards.length = 0
  cards.push(...byId.values())
  console.log(`${game}: merged ${changed.size} card(s) changed since the plain snapshot`)
  const n = await writeCompressedSnapshot(db, game, cards, asOf)
  const back = await readCompressedSnapshot(db, game)
  const ok = back && back.cards.length === cards.length && back.cards.every((c, i) => c.id === cards[i].id && c.marketPrice === cards[i].marketPrice)
  console.log(`${game}: ${cards.length} cards → ${n} compressed chunk(s), as of ${asOf.toISOString()} — read-back ${ok ? 'OK' : 'MISMATCH'}`)
}
process.exit(0)
