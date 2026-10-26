// Compressed catalog snapshot — what a cold server instance downloads to load a game's whole
// catalog (lib/api/catalog.ts loadCatalog()). The original format (catalog_snapshot/{game}/chunks,
// a plain JSON string of 1,500 cards per doc) made a cold Pokémon search download 8.7MB — ~2–3s
// before the first search could answer, on every new server instance. This one gzips the cards
// (~9× smaller) and leaves out each card's `updatedAt` (22% of the old size, never read from a
// snapshot), so the same catalog is ~1MB in a few docs.
//
// Stored at catalog_snapshot/{game}_gz/chunks/{n} = { gz: Bytes, asOf: Timestamp } — alongside
// the original format, which is still written for any older deployment reading it. `asOf` is when
// the card list was read: the loader then pulls only cards changed after it, so a snapshot that's
// behind (e.g. a one-off script that rewrote only the old format) still ends up current.
//
// Plain .mjs so the sync script (Node) and the app (server + the staff portal in the browser)
// share it. CompressionStream/DecompressionStream exist in both Node 18+ and every browser.

import { collection, doc, getDocs, setDoc, writeBatch, Bytes, Timestamp } from 'firebase/firestore'

export const GZ_SUFFIX = '_gz'
const MAX_CHUNK_BYTES = 800_000          // compressed; Firestore's limit is 1MiB per doc
const CARDS_PER_CHUNK = 6000

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function stripForSnapshot(card) {
  const { updatedAt, ...rest } = card // eslint-disable-line no-unused-vars
  return rest
}

/** Card list → compressed chunks, each under MAX_CHUNK_BYTES. */
export async function encodeSnapshot(cards) {
  const out = []
  const slim = cards.map(stripForSnapshot)
  async function add(slice) {
    const gz = await gzip(JSON.stringify(slice))
    if (gz.length > MAX_CHUNK_BYTES && slice.length > 1) {
      const mid = Math.ceil(slice.length / 2)
      await add(slice.slice(0, mid))
      await add(slice.slice(mid))
    } else {
      out.push(gz)
    }
  }
  for (let i = 0; i < slim.length; i += CARDS_PER_CHUNK) await add(slim.slice(i, i + CARDS_PER_CHUNK))
  if (!out.length) out.push(await gzip('[]'))
  return out
}

export async function decodeChunk(bytes) {
  return JSON.parse(await gunzip(bytes))
}

/**
 * Writes the compressed snapshot for `game` from `cards` (the full catalog, as read at `asOf`)
 * and removes leftover chunks from a previous, larger one.
 * @param {import('firebase/firestore').Firestore} firestore
 * @param {string} game
 * @param {Array<Record<string, unknown>>} cards
 * @param {Date} asOf
 */
export async function writeCompressedSnapshot(firestore, game, cards, asOf) {
  const chunks = await encodeSnapshot(cards)
  const key = `${game}${GZ_SUFFIX}`
  const stamp = Timestamp.fromDate(asOf)
  for (let i = 0; i < chunks.length; i++) {
    await setDoc(doc(firestore, 'catalog_snapshot', key, 'chunks', String(i)), {
      gz: Bytes.fromUint8Array(chunks[i]), asOf: stamp, chunk: i, of: chunks.length,
    })
  }
  const existing = await getDocs(collection(firestore, 'catalog_snapshot', key, 'chunks'))
  const stale = existing.docs.filter((d) => parseInt(d.id, 10) >= chunks.length)
  if (stale.length) {
    const batch = writeBatch(firestore)
    for (const d of stale) batch.delete(d.ref)
    await batch.commit()
  }
  return chunks.length
}

/**
 * Reads the compressed snapshot, or null if there isn't a complete one (never written yet, or a
 * write was interrupted mid-way — then the caller falls back to the original format).
 * @param {import('firebase/firestore').Firestore} firestore
 * @param {string} game
 * @returns {Promise<{ cards: Array<Record<string, unknown> & { id: string }>, asOf: Date } | null>}
 */
export async function readCompressedSnapshot(firestore, game) {
  const snap = await getDocs(collection(firestore, 'catalog_snapshot', `${game}${GZ_SUFFIX}`, 'chunks'))
  if (snap.empty) return null
  // Doc ids sort as text ("10" before "2"), so order by the chunk number.
  const docs = snap.docs.map((d) => d.data()).sort((a, b) => a.chunk - b.chunk)
  const of = docs[0].of
  const asOfMs = docs[0].asOf?.toMillis?.()
  // All chunks must come from the same write: same count, same asOf.
  if (docs.length !== of || docs.some((d) => d.of !== of || d.asOf?.toMillis?.() !== asOfMs)) return null
  const parts = await Promise.all(docs.map((d) => decodeChunk(d.gz.toUint8Array())))
  return { cards: parts.flat(), asOf: new Date(asOfMs) }
}
