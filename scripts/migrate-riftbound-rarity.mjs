/**
 * One-off migration: fixes Riftbound cards whose `rarity` doesn't match the "Alt Art" /
 * "Overnumbered" / "Star" scheme scripts/lib/catalog-sync.mjs's downloadRiftbound() now assigns
 * from `publicCode` alone (see lib/utils.ts's riftboundVariantFlags() for the same rule). Two
 * distinct cases, both caught by re-classifying every card from publicCode and comparing:
 *   1. The old flattened `rarity: 'Showcase'` value (covered both Alt Art and Overnumbered).
 *   2. Alt-art prints on sets (UNL, VEN) where Riot's own gallery never reports a distinct
 *      rarity at all — it just keeps the base card's rarity (Rare, Epic, etc.) — so these were
 *      never 'Showcase' to begin with and case 1 alone doesn't find them.
 * Idempotent — safe to re-run; already-correct cards are left untouched.
 *
 * Usage:
 *   node scripts/migrate-riftbound-rarity.mjs            # dry run — prints what would change
 *   node scripts/migrate-riftbound-rarity.mjs --apply     # actually writes to Firestore
 */

import { initializeApp, getApps } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import {
  getFirestore, collection, doc, getDocs, setDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore'

const firebaseApp = getApps().length === 0
  ? initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    })
  : getApps()[0]
const auth = getAuth(firebaseApp)
const db = getFirestore(firebaseApp)

async function ensureSignedIn() {
  if (auth.currentUser) return
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local to run this migration.')
  }
  await signInWithEmailAndPassword(auth, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
}

// Same rule scripts/lib/catalog-sync.mjs's downloadRiftbound() now applies to fresh scrapes.
// Returns null for a card that isn't a Signature/Alt Art/Overnumbered variant at all (in which
// case its existing rarity — Common/Uncommon/Rare/Epic/Promo/etc. — is left alone).
function classify(card) {
  const pubCode = card.publicCode ?? ''
  const isSig = pubCode.includes('*/')
  const isSameNumAlt = !isSig && pubCode.includes('a/')
  const pubNums = pubCode.match(/-(\d+)\*?\/(\d+)$/)
  const isOvernumber = !isSig && !isSameNumAlt && !!pubNums && parseInt(pubNums[1], 10) > parseInt(pubNums[2], 10)
  if (isSig) return 'Star'
  if (isSameNumAlt) return 'Alt Art'
  if (isOvernumber) return 'Overnumbered'
  return null
}

const SNAPSHOT_CHUNK_SIZE = 1500

async function writeSnapshot(finalCards) {
  const chunkCount = Math.max(1, Math.ceil(finalCards.length / SNAPSHOT_CHUNK_SIZE))
  for (let i = 0; i < chunkCount; i++) {
    const slice = finalCards.slice(i * SNAPSHOT_CHUNK_SIZE, (i + 1) * SNAPSHOT_CHUNK_SIZE)
    await setDoc(doc(db, 'catalog_snapshot', 'riftbound', 'chunks', String(i)), { cards: JSON.stringify(slice) })
  }
  const existingChunks = await getDocs(collection(db, 'catalog_snapshot', 'riftbound', 'chunks'))
  const toDelete = existingChunks.docs.filter((d) => parseInt(d.id, 10) >= chunkCount)
  if (toDelete.length > 0) {
    const batch = writeBatch(db)
    for (const d of toDelete) batch.delete(d.ref)
    await batch.commit()
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  await ensureSignedIn()

  const snap = await getDocs(collection(db, 'catalog', 'riftbound', 'cards'))
  const all = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
  console.log(`Read ${all.length} Riftbound catalog cards.`)

  const toMigrate = all
    .map((c) => ({ card: c, correct: classify(c) }))
    .filter(({ card, correct }) => correct && card.rarity !== correct)
  console.log(`Found ${toMigrate.length} card(s) whose rarity doesn't match their publicCode-derived variant.`)

  const bySet = {}
  for (const { card, correct } of toMigrate) {
    bySet[card.setCode] = bySet[card.setCode] ?? {}
    const k = `${card.rarity || '(empty)'} → ${correct}`
    bySet[card.setCode][k] = (bySet[card.setCode][k] ?? 0) + 1
  }
  console.log('By set:', JSON.stringify(bySet, null, 2))

  if (!apply) {
    console.log('\nDry run only — no writes made. Re-run with --apply to write these changes.')
    return
  }

  const writes = toMigrate.map(({ card, correct }) => ({ ref: card.ref, rarity: correct }))
  for (let i = 0; i < writes.length; i += 450) {
    const batchOps = writes.slice(i, i + 450)
    const batch = writeBatch(db)
    for (const { ref, rarity } of batchOps) batch.set(ref, { rarity, updatedAt: serverTimestamp() }, { merge: true })
    await batch.commit()
  }
  console.log(`Wrote ${writes.length} card(s).`)

  // Rebuild the snapshot from the now-updated full catalog so a cold app instance sees the
  // change immediately, same as any other catalog write (see lib/api/catalog.ts).
  const finalSnap = await getDocs(collection(db, 'catalog', 'riftbound', 'cards'))
  const finalCards = finalSnap.docs.map((d) => d.data())
  await writeSnapshot(finalCards)
  console.log('Regenerated catalog_snapshot/riftbound.')
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
