// Tests for the Yu-Gi-Oh! catalog planner (yugioh-tcgplayer.mjs) — `npm run test:yugioh-source`.
// Fixtures are real TCGplayer products (tcgcsv category 2, 2026-11-10), trimmed.
import assert from 'node:assert/strict'
import {
  isExcludedGroup, isEnglishCard, splitName, setCodeOf, printingKeyOf, pricesOf, setTypeOf,
  productsFromRows, buildYugiohCatalog,
} from './yugioh-tcgplayer.mjs'

// ── Scope ──
assert.equal(isExcludedGroup('Speed Duel: Battle City Box'), true)
assert.equal(isExcludedGroup('Rush Duel: Mighty Booster'), true)
assert.equal(isExcludedGroup('Magnificent Maestros'), false)
assert.equal(isEnglishCard({ number: 'MAMS-EN001', name: 'Blue-Eyes White Dragon, the White Phantom Beast' }), true)
assert.equal(isEnglishCard({ number: 'LOB-001', name: 'Blue-Eyes White Dragon' }), true, 'old codes without a region are English')
assert.equal(isEnglishCard({ number: 'LOB-E001', name: 'Blue-Eyes White Dragon' }), true, 'European English')
assert.equal(isEnglishCard({ number: 'SDK-DE001', name: 'Blue-Eyes White Dragon' }), false, 'German')
assert.equal(isEnglishCard({ number: 'LOB-001', name: 'Blue-Eyes White Dragon (German)' }), false)
assert.equal(isEnglishCard({ number: '', name: 'Magnificent Maestros Display' }), false, 'sealed')

// ── Names: the name as printed + the variant TCGplayer appends ──
assert.deepEqual(splitName('Blue-Eyes White Dragon (Quarter Century Secret Rare)'), { name: 'Blue-Eyes White Dragon', variant: 'Quarter Century Secret Rare' })
assert.deepEqual(splitName('Dark Magician (Arkana) (UTR)'), { name: 'Dark Magician', variant: 'Arkana · UTR' })
assert.deepEqual(splitName('Number 39: Utopia'), { name: 'Number 39: Utopia', variant: '' })
assert.deepEqual(splitName('Mr.3(Test)'), { name: 'Mr.3(Test)', variant: '' }, 'a bracket without a space is part of the name')
assert.equal(setCodeOf('MAMS-EN001'), 'MAMS')
assert.equal(setCodeOf('LOB-001'), 'LOB')

// ── Prices: edition rows are printings of one card ──
assert.equal(printingKeyOf('1st Edition'), '1st:normal')
assert.equal(printingKeyOf('Unlimited'), 'unlimited:normal')
assert.equal(printingKeyOf('Limited'), 'limited:normal')
assert.deepEqual(pricesOf([{ subTypeName: '1st Edition', marketPrice: 0.15, lowPrice: 0.05 }, { subTypeName: 'Unlimited', marketPrice: 0.22, lowPrice: 0.01 }]).variantPrices,
  { '1st:normal': 0.15, 'unlimited:normal': 0.22 })
assert.deepEqual(pricesOf([{ subTypeName: 'Unlimited', marketPrice: 3 }, { subTypeName: 'Normal', marketPrice: 9 }]).variantPrices, { 'unlimited:normal': 3 },
  'a plain Normal row never overrides a real edition row')
assert.deepEqual(pricesOf([{ subTypeName: '1st Edition', marketPrice: null }]).variantPrices, {}, 'no price → no printing price (kept from before on sync)')

// ── Cardex groups by set name ──
assert.equal(setTypeOf('Magnificent Maestros'), 'booster')
assert.equal(setTypeOf('Structure Deck: Blue-Eyes White Destiny'), 'structure')
assert.equal(setTypeOf('2021 Tin of Ancient Battles'), 'tin')
assert.equal(setTypeOf('OTS Tournament Pack 10'), 'promo')
assert.equal(setTypeOf("Winner's Pack 2026-2027"), 'promo')
assert.equal(setTypeOf('Rarity Collection 5'), 'special')
assert.equal(setTypeOf('Starter Deck: Yugi'), 'starter')

// ── The catalog ──
const row = (o) => ({ productId: o.id, name: o.name, imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${o.id}_200w.jpg`, groupId: o.g, extNumber: o.num ?? '', extRarity: o.rar ?? '', extCardType: 'Effect Monster', extAttribute: 'LIGHT', subTypeName: o.sub ?? '1st Edition', marketPrice: o.price, lowPrice: o.low })
const rows = [
  row({ id: 731469, g: 24808, name: 'Blue-Eyes White Dragon, the White Phantom Beast', num: 'MAMS-EN001', rar: 'Ultra Rare', price: 35.33, low: 33.75 }),
  row({ id: 731470, g: 24808, name: 'Blue-Eyes White Dragon, the White Phantom Beast (Extended Art)', num: 'MAMS-EN001', rar: 'Ultra Rare', price: 60 }),
  row({ id: 731471, g: 24808, name: 'Blue-Eyes White Dragon, the White Phantom Beast (Starlight Rare)', num: 'MAMS-EN001', rar: 'Starlight Rare', price: 900 }),
  row({ id: 711214, g: 24808, name: 'Magnificent Maestros Display', price: 239.58, sub: 'Normal' }),
  row({ id: 70876, g: 1142, name: 'Xyz Reversal', num: 'JOTL-EN078', rar: 'Common', price: 0.15, sub: '1st Edition' }),
  row({ id: 70876, g: 1142, name: 'Xyz Reversal', num: 'JOTL-EN078', rar: 'Common', price: 0.22, sub: 'Unlimited' }),
  row({ id: 900001, g: 7777, name: 'Some Speed Duel Card', num: 'SBCB-EN001', rar: 'Common', price: 1 }),
]
const groups = [
  { groupId: 24808, name: 'Magnificent Maestros', abbreviation: 'MAMS', publishedOn: '2026-11-13T00:00:00' },
  { groupId: 1142, name: 'Judgment of the Light', abbreviation: 'JOTL', publishedOn: '2013-02-15T00:00:00' },
  { groupId: 7777, name: 'Speed Duel: Battle City Box', abbreviation: 'SBCB', publishedOn: '2020-10-01T00:00:00' },
]
const byGroup = new Map()
for (const p of productsFromRows(rows)) { if (!byGroup.has(p.groupId)) byGroup.set(p.groupId, []); byGroup.get(p.groupId).push(p) }
const first = buildYugiohCatalog({ groups, productsByGroup: byGroup })
const ids = first.cards.map((c) => c.id).sort()
assert.deepEqual(ids, ['tcg-70876', 'tcg-731469', 'tcg-731470', 'tcg-731471'], 'sealed and Speed Duel left out; each rarity version its own card')
const blue = first.cards.find((c) => c.id === 'tcg-731471')
assert.equal(blue.name, 'Blue-Eyes White Dragon, the White Phantom Beast')
assert.equal(blue.variant, 'Starlight Rare')
assert.equal(blue.rarity, 'Starlight Rare')
assert.equal(blue.set, 'MAMS')
const xyz = first.cards.find((c) => c.id === 'tcg-70876')
assert.deepEqual(xyz.variantPrices, { '1st:normal': 0.15, 'unlimited:normal': 0.22 })
assert.equal(xyz.marketPrice, 0.22, 'the default printing is Unlimited when it has a price')
assert.ok(first.cards.every((c) => Object.values(c).every((v) => v !== undefined)), 'nothing undefined (Firestore rejects it)')
assert.deepEqual(first.sets.map((s) => s.code), ['MAMS', 'JOTL'])
assert.equal(first.sets[0].cardCount, 3)

// Second run, against what the first wrote: same ids; a renamed product and a moved photo don't
// change what collectors see; prices refresh; a printing with no price today keeps its last one
const existing = new Map(first.cards.map((c) => [c.id, c]))
const rows2 = rows.map((r) => (r.productId === 731469 ? { ...r, name: 'Blue-Eyes White Dragon, the White Phantom Beast (Renamed)', marketPrice: 40, imageUrl: 'https://x/new.jpg' }
  : r.productId === 70876 && r.subTypeName === 'Unlimited' ? { ...r, marketPrice: null } : r))
const byGroup2 = new Map()
for (const p of productsFromRows(rows2)) { if (!byGroup2.has(p.groupId)) byGroup2.set(p.groupId, []); byGroup2.get(p.groupId).push(p) }
const second = buildYugiohCatalog({ groups, productsByGroup: byGroup2, existing })
const blue2 = second.cards.find((c) => c.id === 'tcg-731469')
assert.equal(blue2.name, 'Blue-Eyes White Dragon, the White Phantom Beast')
assert.equal(blue2.variant, undefined)
assert.equal(blue2.imageUrl, first.cards.find((c) => c.id === 'tcg-731469').imageUrl, 'the photo stays')
assert.equal(blue2.marketPrice, 40, 'the price refreshes')
const xyz2 = second.cards.find((c) => c.id === 'tcg-70876')
assert.equal(xyz2.variantPrices['unlimited:normal'], 0.22, 'no price today → keeps the last')
assert.equal(xyz2.variantPrices['1st:normal'], 0.15)
assert.equal(second.report.newCards, 0)

console.log('yugioh-tcgplayer: all tests passed')
