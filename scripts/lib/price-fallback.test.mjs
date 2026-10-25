// Offline tests for the Pokémon backup-price layers (price-fallback.mjs) — every source is a fake
// fetch, nothing touches the network or Firestore. Run: npm run test:prices
import assert from 'node:assert/strict'
import * as F from './price-fallback.mjs'
import { buildDailyEntries } from './price-history.mjs'
const NOW = Date.parse('2026-10-25T12:00:00Z')
const day = 864e5
let t = 0; const test = (n, f) => Promise.resolve(f()).then(() => { t++; console.log('✓', n) })

await test('tcgplayer block: pokemontcg.io shape', () => {
  assert.deepEqual(F.fromTcgplayerBlock({ holofoil: { market: 237.26, mid: 266 } }), { m: 237.26, mf: 237.26 })
  assert.deepEqual(F.fromTcgplayerBlock({ normal: { market: 1.5 }, reverseHolofoil: { market: 3 } }), { m: 1.5, mf: 3 })
  assert.deepEqual(F.fromTcgplayerBlock({ normal: { mid: 2 } }), { m: 2, mf: 0 })
  assert.deepEqual(F.fromTcgplayerBlock(undefined), { m: 0, mf: 0 })
})
await test('tcgplayer block: tcgdex shape', () => {
  assert.deepEqual(F.fromTcgplayerBlock({ unit: 'USD', updated: 'x', holofoil: { productId: 1, marketPrice: 9.59, midPrice: 13.4 } }), { m: 9.59, mf: 9.59 })
})
await test('cardmarket spike guard + FX', () => {
  assert.equal(F.steadyCardmarketPrice(12.79, 12.81), 12.79)
  assert.equal(F.steadyCardmarketPrice(400, 20), 20)   // spike → avg30
  assert.equal(F.steadyCardmarketPrice(2, 20), 20)     // crash → avg30
  assert.equal(F.steadyCardmarketPrice(0, 5), 5)
  assert.deepEqual(F.fromCardmarketBlock({ trend: 10, avg30: 10, 'trend-holo': 0 }, 1.1), { m: 11, mf: 0 })
  assert.deepEqual(F.fromCardmarketBlock({ trend: 10 }, 0), { m: 0, mf: 0 }) // no FX → no price
})
await test('cardmarket: single-print rarities take the real (higher) price', () => {
  const ray = { trend: 33.24, avg30: 27.56, 'trend-holo': 511.42, 'avg30-holo': 210.11 }
  assert.deepEqual(F.fromCardmarketBlock(ray, 1, { rarity: 'Rare Holo Star' }), { m: 511.42, mf: 511.42 })
  const sec = { trend: 202.23, avg30: 76.56, 'trend-holo': 6.99, 'avg30-holo': 4.45 }
  assert.deepEqual(F.fromCardmarketBlock(sec, 1, { rarity: 'Rare Secret' }), { m: 202.23, mf: 202.23 })
  const energy = { trend: 0.07, avg30: 0.05, 'trend-holo': 1.53, 'avg30-holo': 1.26 }
  assert.deepEqual(F.fromCardmarketBlock(energy, 1, { rarity: 'Common' }), { m: 0.07, mf: 1.53 })
  assert.deepEqual(F.fromCardmarketBlock(energy, 1, { rarity: '' }), { m: 0.07, mf: 1.53 })
  assert.equal(F.isSinglePrintRarity('Illustration Rare'), true); assert.equal(F.isSinglePrintRarity('Rare'), false)
})
await test('normNum', () => {
  assert.equal(F.normNum('020'), '20'); assert.equal(F.normNum('20'), '20')
  assert.equal(F.normNum('GG04'), 'GG4'); assert.equal(F.normNum('GG4'), 'GG4'); assert.equal(F.normNum('TG01/TG30'), 'TG1')
})

// ── orchestration with a fake network ──
function fakeNet() {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const json = (d) => ({ ok: true, json: async () => d })
    if (url.includes('pokemontcg.io')) {
      const q = decodeURIComponent(url)
      const data = []
      if (q.includes('"cz-1"')) data.push({ id: 'cz-1', tcgplayer: { updatedAt: '2026/10/15', prices: { holofoil: { market: 50 } } } })
      if (q.includes('"cz-2"')) data.push({ id: 'cz-2', tcgplayer: { updatedAt: '2025/01/01', prices: { holofoil: { market: 99 } } } }) // stale
      return json({ data })
    }
    if (url.includes('frankfurter')) return json({ rates: { USD: 1.1 } })
    if (url.endsWith('/v2/en/sets')) return json([{ id: 'swsh12.5', name: 'Crown Zenith' }])
    if (url.includes('/sets/swsh12.5')) return json({ cards: [{ id: 'swsh12.5-002', localId: '002' }, { id: 'swsh12.5-003', localId: '003' }, { id: 'swsh12.5-004', localId: '004' }] })
    if (url.includes('/cards/swsh12.5-002')) return json({ pricing: { cardmarket: { updated: '2026-10-24T00:00:00Z', trend: 10, avg30: 10 } } })
    if (url.includes('/cards/swsh12.5-003')) return json({ pricing: { tcgplayer: { updated: '2026-10-20T00:00:00Z', normal: { marketPrice: 4 } }, cardmarket: { updated: '2026-10-24T00:00:00Z', trend: 3 } } })
    if (url.includes('/cards/swsh12.5-004')) return json({ pricing: { cardmarket: { updated: '2025-01-01T00:00:00Z', trend: 3 } } }) // stale
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { calls, fetchImpl }
}
const mk = () => [
  { id: 'cz-0', setName: 'Crown Zenith', number: '0', marketPrice: 5, marketPriceFoil: 0 },   // priced by TCGplayer
  { id: 'cz-1', setName: 'Crown Zenith', number: '1', marketPrice: 0, marketPriceFoil: 0 },   // L2 hit
  { id: 'cz-2', setName: 'Crown Zenith', number: '2', marketPrice: 0, marketPriceFoil: 0 },   // L2 stale → L3 cardmarket
  { id: 'cz-3', setName: 'Crown Zenith', number: '3', marketPrice: 0, marketPriceFoil: 0 },   // L3 tcgplayer block
  { id: 'cz-4', setName: 'Crown Zenith', number: '4', marketPrice: 0, marketPriceFoil: 0 },   // nothing fresh
  { id: 'x-9', setName: 'Unknown Set', number: '9', marketPrice: 0, marketPriceFoil: 0 },     // no tcgdex set
]
const store = { doc: null }
const io = { loadCache: async () => store.doc, saveCache: async (d) => { store.doc = JSON.parse(JSON.stringify(d)) } }

await test('first run fills gaps from the right layer', async () => {
  const net = fakeNet(); const cards = mk()
  const s = await F.fillPokemonPriceGaps(cards, { ...io, fetchImpl: net.fetchImpl, now: NOW })
  const by = Object.fromEntries(cards.map((c) => [c.id, c]))
  assert.equal(by['cz-0'].marketPrice, 5); assert.equal(by['cz-0'].priceSource, undefined)
  assert.deepEqual([by['cz-1'].marketPrice, by['cz-1'].marketPriceFoil, by['cz-1'].priceSource], [50, 50, 'tcgplayer-backup'])
  assert.deepEqual([by['cz-2'].marketPrice, by['cz-2'].priceSource], [11, 'cardmarket'])
  assert.deepEqual([by['cz-3'].marketPrice, by['cz-3'].priceSource], [4, 'tcgplayer-backup'])
  assert.equal(by['cz-4'].marketPrice, 0); assert.equal(by['cz-4'].priceSource, undefined)
  assert.equal(by['x-9'].marketPrice, 0)
  assert.equal(s.gaps, 5); assert.equal(s.applied, 3); assert.equal(s.estimated, 1)
  // never asks about the card TCGplayer already priced
  assert.ok(!net.calls.some((u) => decodeURIComponent(u).includes('cz-0')))
  // tcgdex only fetched for cards layer 2 didn't fill
  assert.ok(!net.calls.some((u) => u.includes('/cards/swsh12.5-001')))
  assert.equal(net.calls.filter((u) => u.includes('pokemontcg.io')).length, 1) // one batched request
  assert.equal(Object.keys(store.doc.entries).length, 5)
})
await test('second run same day: zero network calls, same prices', async () => {
  const net = fakeNet(); const cards = mk()
  const s = await F.fillPokemonPriceGaps(cards, { ...io, fetchImpl: net.fetchImpl, now: NOW + 6 * 3600e3 })
  assert.equal(net.calls.length, 0); assert.equal(s.checked, 0); assert.equal(s.applied, 3)
  assert.equal(cards.find((c) => c.id === 'cz-2').marketPrice, 11)
})
await test('next day: re-checks gaps; FX re-fetched', async () => {
  const net = fakeNet(); const cards = mk()
  const s = await F.fillPokemonPriceGaps(cards, { ...io, fetchImpl: net.fetchImpl, now: NOW + day + 1 })
  assert.equal(s.checked, 5); assert.ok(net.calls.some((u) => u.includes('frankfurter')))
})
await test('card priced by TCGplayer later drops out of cache, never looked up', async () => {
  const net = fakeNet(); const cards = mk(); cards.find((c) => c.id === 'cz-1').marketPrice = 60
  await F.fillPokemonPriceGaps(cards, { ...io, fetchImpl: net.fetchImpl, now: NOW + 2 * day + 2 })
  assert.equal(store.doc.entries['cz-1'], undefined)
  assert.ok(!net.calls.some((u) => decodeURIComponent(u).includes('"cz-1"')))
  assert.equal(cards.find((c) => c.id === 'cz-1').marketPrice, 60)
})
await test('maxLookups caps work; oldest-unchecked first', async () => {
  store.doc = { v: F.CACHE_VERSION, entries: { 'cz-2': { m: 0, mf: 0, src: '', at: 0, checkedAt: NOW - 3 * day }, 'cz-3': { m: 0, mf: 0, src: '', at: 0, checkedAt: NOW - 2 * day } } }
  const net = fakeNet(); const cards = mk()
  const s = await F.fillPokemonPriceGaps(cards, { ...io, fetchImpl: net.fetchImpl, now: NOW, maxLookups: 2 })
  assert.equal(s.checked, 2)
  const asked = decodeURIComponent(net.calls.find((u) => u.includes('pokemontcg.io')))
  // never-checked (cz-1, cz-4, x-9) come before old ones; only 2 taken
  assert.ok(!asked.includes('"cz-2"') && !asked.includes('"cz-3"'))
})
await test('network fully down: no throw, nothing marked checked, earlier backup price kept', async () => {
  store.doc = { v: F.CACHE_VERSION, entries: { 'cz-1': { m: 50, mf: 50, src: 'tcgplayer-backup', at: NOW - day, checkedAt: NOW - 2 * day } } }
  const cards = mk()
  const s = await F.fillPokemonPriceGaps(cards, { ...io, fetchImpl: async () => { throw new Error('offline') }, now: NOW, retryDelays: [] })
  assert.equal(cards.find((c) => c.id === 'cz-1').marketPrice, 50)
  assert.equal(s.applied, 1)
  assert.deepEqual(Object.keys(store.doc.entries), ['cz-1'])        // no negatives recorded
  assert.equal(store.doc.entries['cz-1'].checkedAt, NOW - 2 * day)   // still due next run
})
await test('one tcgdex card request failing leaves only that card unchecked', async () => {
  store.doc = null
  const net = fakeNet()
  const flaky = async (u) => (u.includes('/cards/swsh12.5-004') ? { ok: false, status: 500, json: async () => ({}) } : net.fetchImpl(u))
  await F.fillPokemonPriceGaps(mk(), { ...io, fetchImpl: flaky, now: NOW })
  assert.equal(store.doc.entries['cz-4'], undefined)                 // retried next sync
  assert.equal(store.doc.entries['x-9'].checkedAt, NOW)              // definitively "no tcgdex set"
  assert.equal(store.doc.entries['cz-2'].src, 'cardmarket')
})
await test('time budget exhausted: unreached cards not marked checked', async () => {
  store.doc = null
  const net = fakeNet()
  const s = await F.fillPokemonPriceGaps(mk(), { ...io, fetchImpl: net.fetchImpl, now: NOW, timeBudgetMs: -1 })
  assert.equal(net.calls.length <= 2, true)  // only FX / nothing — deadline already passed
  assert.equal(Object.keys(store.doc.entries).length, 0)
  assert.equal(s.applied, 0)
})
await test('pokemontcg.io: a 503 then success is retried and used', async () => {
  store.doc = null
  const net = fakeNet(); let n = 0
  const flaky = async (u) => (u.includes('pokemontcg.io') && n++ === 0 ? { ok: false, status: 503, json: async () => ({}) } : net.fetchImpl(u))
  const cards = mk()
  await F.fillPokemonPriceGaps(cards, { ...io, fetchImpl: flaky, now: NOW, retryDelays: [5] })
  assert.equal(cards.find((c) => c.id === 'cz-1').priceSource, 'tcgplayer-backup')
  assert.equal(n, 2)
})
await test('old cache version is discarded', async () => {
  store.doc = { v: 1, entries: { 'cz-2': { m: 999, mf: 999, src: 'cardmarket', at: NOW, checkedAt: NOW } } }
  const net = fakeNet(); const cards = mk()
  await F.fillPokemonPriceGaps(cards, { ...io, fetchImpl: net.fetchImpl, now: NOW })
  assert.equal(cards.find((c) => c.id === 'cz-2').marketPrice, 11)   // re-looked-up, not 999
  assert.equal(store.doc.v, F.CACHE_VERSION)
})
await test('price history skips Cardmarket estimates only', () => {
  const e = buildDailyEntries([
    { id: 'a', set: 's', marketPrice: 1 }, { id: 'b', set: 's', marketPrice: 2, priceSource: 'cardmarket' },
    { id: 'c', set: 's', marketPrice: 3, priceSource: 'tcgplayer-backup' }], new Date(NOW))
  const p = JSON.parse([...e.values()][0].value).p
  assert.deepEqual(Object.keys(p).sort(), ['a', 'c'])
})
console.log(`\n${t} tests passed`)
