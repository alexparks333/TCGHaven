/**
 * Full-catalog image health scan — checks every card's imageUrl with a HEAD request and seeds
 * catalog_meta/{game}.brokenImageIds with whatever doesn't actually resolve.
 *
 * The ongoing per-sync check (syncToFirestore(), scripts/lib/catalog-sync.mjs) only re-verifies
 * cards that are brand-new this run or already flagged broken from a previous run — cheap and
 * fully automatic, but it has nothing to check for a card that's been sitting in the catalog with
 * a broken image since before this feature existed. This script is the one-time (or occasional
 * re-run) full scan that gives the ongoing check a real baseline. Real example that motivated
 * this: Riftbound's Vendetta Alt Rune cards synced with a completely well-formed
 * tcgplayer-cdn.tcgplayer.com imageUrl that 403'd (TCGPlayer hadn't uploaded that specific
 * product's photo yet) — nothing about the synced *data* looked wrong, only an actual HTTP check
 * catches it.
 *
 * Usage: npm run check-images -- riftbound lorcana        (specific games)
 *        npm run check-images -- all                       (all 5)
 *
 * Requires ADMIN_EMAIL/ADMIN_PASSWORD + NEXT_PUBLIC_FIREBASE_* in .env.local, same as
 * download-card-catalog.mjs — see that file's header comment for why this parses .env.local
 * itself rather than using Node's --env-file.
 */
import fs from 'node:fs'

const ALL_GAMES = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg']
const args = process.argv.slice(2)
const games = args.includes('all') ? ALL_GAMES : args

if (games.length === 0) {
  console.error('Usage: node scripts/check-image-health.mjs <game> [game...] | all')
  console.error(`Games: ${ALL_GAMES.join(', ')}`)
  process.exit(1)
}
const unknown = games.filter((g) => !ALL_GAMES.includes(g))
if (unknown.length > 0) {
  console.error(`Unknown game(s): ${unknown.join(', ')} — expected one of ${ALL_GAMES.join(', ')}`)
  process.exit(1)
}

function loadEnvLocal() {
  const path = new URL('../.env.local', import.meta.url)
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const [, key, rawValue] = m
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/\\\$/g, '$')
  }
}
loadEnvLocal()

// Dynamic import, after env loading — ensureSignedIn() reads process.env.ADMIN_EMAIL/PASSWORD at
// call time (fine with a static import too), but catalog-sync.mjs's own module-level
// initializeApp() reads NEXT_PUBLIC_FIREBASE_* at import time, so this has to come after
// loadEnvLocal() the same way download-card-catalog.mjs's does.
const { ensureSignedIn } = await import('./lib/catalog-sync.mjs')
const { getFirestore, collection, getDocs, doc, setDoc } = await import('firebase/firestore')
const { getApp } = await import('firebase/app')

await ensureSignedIn()
console.log('Signed in as admin.\n')
const db = getFirestore(getApp())

async function findBrokenImageUrls(candidates, { concurrency = 25, timeoutMs = 6000 } = {}) {
  const broken = []
  let done = 0
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency)
    await Promise.all(batch.map(async ({ id, imageUrl }) => {
      if (!imageUrl) { broken.push(id); return }
      try {
        const res = await fetch(imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) })
        const contentType = res.headers.get('content-type') || ''
        if (!res.ok || !contentType.startsWith('image/')) broken.push(id)
      } catch {
        broken.push(id) // timeout/network error — treat as broken, next scan/sync will retry it
      }
    }))
    done += batch.length
    process.stdout.write(`   ${done}/${candidates.length}\r`)
  }
  return broken
}

for (const game of games) {
  console.log(`=== ${game} ===`)
  const snap = await getDocs(collection(db, 'catalog', game, 'cards'))
  const cards = snap.docs.map((d) => ({ id: d.id, imageUrl: d.data().imageUrl, name: d.data().name }))
  console.log(`   ${cards.length} cards to check`)
  const broken = await findBrokenImageUrls(cards)
  console.log(`\n   ${broken.length} broken images found`)
  if (broken.length > 0) {
    const byId = new Map(cards.map((c) => [c.id, c]))
    for (const id of broken.slice(0, 30)) console.log(`     ${id} — ${byId.get(id)?.name}`)
    if (broken.length > 30) console.log(`     ...and ${broken.length - 30} more`)
  }
  await setDoc(doc(db, 'catalog_meta', game), { brokenImageIds: broken }, { merge: true })
  console.log(`   Seeded catalog_meta/${game}.brokenImageIds — the next sync (or cron run) will keep rechecking these automatically.\n`)
}
process.exit(0)
