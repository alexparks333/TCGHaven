// Offline round-trip test for snapshot-codec.mjs — `npm run test:snapshot`. Uses a synthetic
// catalog shaped like the real ones (no Firestore).
import assert from 'node:assert/strict'
import { encodeSnapshot, decodeChunk } from './snapshot-codec.mjs'

const cards = Array.from({ length: 20000 }, (_, i) => ({
  id: `set${i % 170}-${i}`,
  name: `Card ${i} – Pokémon ★ δ`,
  set: `set${i % 170}`, setName: `Set Name ${i % 170}`, number: String(i % 300),
  rarity: ['Common', 'Rare Holo', 'Special Illustration Rare'][i % 3],
  imageUrl: `https://images.pokemontcg.io/set${i % 170}/${i}_hires.png`,
  marketPrice: (i % 997) / 7, marketPriceFoil: 0, lowPriceNM: 0, lowPriceNMFoil: 0, hidden: false,
  variantPrices: i % 5 ? { 'unlimited:normal': 1.5 } : { 'unlimited:holofoil': 164.03, '1st:holofoil': 445.14 },
  updatedAt: { seconds: 1793037481, nanoseconds: 847000000 },
}))

const chunks = await encodeSnapshot(cards)
assert.ok(chunks.every((c) => c.length < 800_000), 'every chunk under the size cap')
const back = (await Promise.all(chunks.map(decodeChunk))).flat()
assert.equal(back.length, cards.length)
const { updatedAt, ...expected } = cards[123] // eslint-disable-line no-unused-vars
assert.deepEqual(back[123], expected, 'cards round-trip exactly, minus updatedAt')
assert.ok(back.every((c) => !('updatedAt' in c)))
assert.deepEqual((await Promise.all((await encodeSnapshot([])).map(decodeChunk))).flat(), [], 'empty catalog')
const raw = JSON.stringify(cards).length
const packed = chunks.reduce((s, c) => s + c.length, 0)
console.log(`snapshot-codec: all tests passed (${(raw / 1e6).toFixed(1)}MB → ${(packed / 1e6).toFixed(2)}MB in ${chunks.length} chunks)`)
