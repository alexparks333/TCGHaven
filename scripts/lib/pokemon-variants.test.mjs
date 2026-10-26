// Offline tests for pokemon-variants.mjs + its use in pricing/history — `npm run test:variants`.
// Rows are real TCGplayer (tcgcsv) rows, trimmed to the columns the sync reads.
import assert from 'node:assert/strict'
import {
  classifySubtype, newPriceEntry, addPriceRow, legacyFields, variantPrice, editionsOf, finishesOf,
  defaultEdition, defaultFinish, historyNeedsVariants,
} from './pokemon-variants.mjs'
import { priceTuple, tupleToFields } from './price-history.mjs'

const build = (rows, opts) => {
  const e = newPriceEntry()
  for (const r of rows) addPriceRow(e, r, opts)
  return legacyFields(e)
}

// ── Subtype classification ──────────────────────────────────────────────────
assert.deepEqual(classifySubtype('Normal'), { edition: 'unlimited', finish: 'normal', weak: false })
assert.deepEqual(classifySubtype('Holofoil'), { edition: 'unlimited', finish: 'holofoil', weak: false })
assert.deepEqual(classifySubtype('Reverse Holofoil'), { edition: 'unlimited', finish: 'reverse', weak: false })
assert.deepEqual(classifySubtype('1st Edition'), { edition: '1st', finish: 'normal', weak: false })
assert.deepEqual(classifySubtype('1st Edition Holofoil'), { edition: '1st', finish: 'holofoil', weak: false })
assert.deepEqual(classifySubtype('Unlimited'), { edition: 'unlimited', finish: 'normal', weak: false })
assert.deepEqual(classifySubtype('Unlimited Holofoil'), { edition: 'unlimited', finish: 'holofoil', weak: false })
assert.deepEqual(classifySubtype('Unlimited Holofoil', { unlimitedIs: 'shadowless' }), { edition: 'shadowless', finish: 'holofoil', weak: false })
assert.equal(classifySubtype('').weak, true)

// ── The bug this fixes: Jungle Snorlax showed its 1st Edition price ─────────
{
  const f = build([
    { name: 'Snorlax (11)', subTypeName: '1st Edition Holofoil', marketPrice: '445.14', lowPrice: '400' },
    { name: 'Snorlax (11)', subTypeName: 'Unlimited Holofoil', marketPrice: '164.03', lowPrice: '150' },
  ])
  assert.equal(f.marketPrice, 164.03, 'default = Unlimited')
  assert.equal(f.marketPriceFoil, 164.03, 'holo price lands in the foil slot too (it used to stay 0)')
  assert.deepEqual(f.variantPrices, { '1st:holofoil': 445.14, 'unlimited:holofoil': 164.03 })
  assert.equal(variantPrice(f.variantPrices, { edition: '1st' }), 445.14)
  assert.equal(variantPrice(f.variantPrices, {}), 164.03)
  assert.deepEqual(editionsOf(f.variantPrices), ['unlimited', '1st'])
  assert.deepEqual(finishesOf(f.variantPrices, '1st'), ['holofoil'])
}

// ── Base Set: Unlimited (group "Base Set") + 1st/Shadowless (group "Base Set (Shadowless)") ──
{
  const e = newPriceEntry()
  addPriceRow(e, { name: 'Pikachu', subTypeName: 'Normal', marketPrice: '11.72' })
  for (const r of [
    { name: 'Pikachu', subTypeName: '1st Edition', marketPrice: '192.77' },
    { name: 'Pikachu', subTypeName: 'Unlimited', marketPrice: '46.49' },
  ]) addPriceRow(e, r, { unlimitedIs: 'shadowless' })
  const f = legacyFields(e)
  assert.equal(f.marketPrice, 11.72)
  assert.deepEqual(f.variantPrices, { 'unlimited:normal': 11.72, '1st:normal': 192.77, 'shadowless:normal': 46.49 })
  assert.deepEqual(editionsOf(f.variantPrices), ['unlimited', 'shadowless', '1st'])
}

// ── Modern finishes ─────────────────────────────────────────────────────────
{
  // a common: normal + reverse
  const c = build([
    { name: 'Rookidee', subTypeName: 'Normal', marketPrice: '0.05' },
    { name: 'Rookidee', subTypeName: 'Reverse Holofoil', marketPrice: '0.25' },
  ])
  assert.equal(c.marketPrice, 0.05)
  assert.equal(c.marketPriceFoil, 0.25)
  assert.equal(historyNeedsVariants(c.variantPrices), false, 'the classic pair already expresses both')
  assert.equal(defaultFinish(c.variantPrices, 'unlimited', true), 'reverse')
  // a holo rare: holo + reverse — the old foil slot could only hold one
  const r = build([
    { name: 'Charizard', subTypeName: 'Holofoil', marketPrice: '899.99' },
    { name: 'Charizard', subTypeName: 'Reverse Holofoil', marketPrice: '4250' },
  ])
  assert.equal(r.marketPriceFoil, 899.99)
  assert.equal(variantPrice(r.variantPrices, { finish: 'reverse' }), 4250)
  assert.equal(historyNeedsVariants(r.variantPrices), true)
}

// ── Variant products never overwrite the plain product ──────────────────────
{
  const f = build([
    { name: 'Charizard', subTypeName: 'Holofoil', marketPrice: '954.65' },
    { name: 'Charizard (Black Dot Error)', subTypeName: 'Holofoil', marketPrice: '12000' },
  ])
  assert.equal(f.marketPrice, 954.65)
  // …but a variant row still fills a printing nothing plain priced
  const g = build([{ name: 'Pikachu (Stamped)', subTypeName: 'Reverse Holofoil', marketPrice: '3' }])
  assert.equal(g.marketPriceFoil, 3)
}

// ── Rows with no subtype: only when nothing else prices the card (old behavior) ──
assert.equal(build([{ name: 'X', subTypeName: '', marketPrice: '2' }]).marketPrice, 2)
assert.equal(build([{ name: 'X', subTypeName: '', marketPrice: '2' }, { name: 'X', subTypeName: 'Normal', marketPrice: '1' }]).marketPrice, 1)
assert.deepEqual(build([]).variantPrices, {})
assert.equal(build([]).marketPrice, 0)

// ── A 1st-Edition-only card defaults to 1st Edition (not $0) ────────────────
{
  const f = build([{ name: 'Y', subTypeName: '1st Edition Holofoil', marketPrice: '50' }])
  assert.equal(defaultEdition(f.variantPrices), '1st')
  assert.equal(f.marketPrice, 50)
}

// ── Price history keeps printings only where needed, and reads them back ─────
{
  const card = { marketPrice: 164.03, marketPriceFoil: 164.03, lowPriceNM: 0, lowPriceNMFoil: 0, variantPrices: { '1st:holofoil': 445.14, 'unlimited:holofoil': 164.03 } }
  const t = priceTuple(card)
  assert.equal(t.length, 5)
  assert.deepEqual(tupleToFields(t).variantPrices, card.variantPrices)
  const plain = priceTuple({ marketPrice: 1, marketPriceFoil: 2, lowPriceNM: 0, lowPriceNMFoil: 0, variantPrices: { 'unlimited:normal': 1, 'unlimited:reverse': 2 } })
  assert.equal(plain.length, 4)
  assert.equal(tupleToFields(plain).variantPrices, undefined)
  assert.equal(tupleToFields([1, 2, 0, 0]).variantPrices, undefined, 'old history days still parse')
}

console.log('pokemon-variants: all tests passed')
