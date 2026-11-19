// Offline tests for pricecharting.mjs — `npm run test:pricecharting`. A synthetic CSV shaped like
// PriceCharting's daily price list (column names from their API docs); no network, no Firestore.
import assert from 'node:assert/strict'
import {
  parsePcPrice, penniesToUsd, parsePcCsv, gradedFromRow, pickByTcgId, productIdOf, matchCatalog,
  gradedPriceKey, gradedPriceFor, pcProductUrl, pcIdUrl,
} from './pricecharting.mjs'
import { GRADED_ORDER, gradedTuple, tupleToGraded, buildGradedHistory } from './graded-history.mjs'
import { gunzip } from './price-history.mjs'

// Prices: CSV is dollars (maybe with "$" and commas), API is pennies
assert.equal(parsePcPrice('$1,234.56'), 1234.56)
assert.equal(parsePcPrice('17.32'), 17.32)
assert.equal(parsePcPrice(''), 0)
assert.equal(parsePcPrice('0.00'), 0)
assert.equal(parsePcPrice('n/a'), 0)
assert.equal(penniesToUsd(1732), 17.32)
assert.equal(penniesToUsd(null), 0)

// CSV: header by name, quoted commas / quotes / line breaks, BOM, CRLF
const header = 'id,console-name,product-name,loose-price,graded-price,manual-only-price,bgs-10-price,condition-20-price,box-only-price,tcg-id'
const csv = '﻿' + [
  header,
  '6910,Pokemon Base Set,Charizard #4,$350.00,"$1,500.00","$12,000.00",$20000.00,,$4000.00,42382',
  '6911,Pokemon Base Set,Charizard [1st Edition] #4,,"$9,000.00",,,,,42382',
  '7000,Pokemon Base Set,"Blastoise, ""Shiny"" #2",$100.00,,,,,,42383',          // no graded price → dropped
  '7001,Pokemon Base Set,"Venusaur\n#15",$80.00,$300.00,,,,,',                  // no tcg-id → dropped
  '8000,One Piece Romance Dawn,Luffy [Alt Art] OP01-003,$50,$90,,,,,500001',
  '8001,One Piece Romance Dawn,Luffy [Manga] OP01-003,$500,$900,,,,,500001',  // two bracketed → ambiguous
  '9000,YuGiOh LOB,Blue-Eyes White Dragon LOB-001,$40,$400,$2500,,$9999,,600001',
].join('\r\n')
const rows = parsePcCsv(csv)
assert.equal(rows.length, 7)
assert.equal(rows[0]['product-name'], 'Charizard #4')
assert.equal(rows[2]['product-name'], 'Blastoise, "Shiny" #2')
assert.equal(rows[3]['product-name'], 'Venusaur\n#15')

const zard = gradedFromRow(rows[0])
assert.deepEqual(zard.prices, { g9: 1500, psa10: 12000, bgs10: 20000, g95: 4000 }, 'only graded columns, only real prices')
assert.equal(zard.tcgId, 42382)
assert.equal(zard.url, 'https://www.pricecharting.com/game/6910', 'the citation links by product id (exact page, never a search)')
assert.equal(pcIdUrl('5399964'), 'https://www.pricecharting.com/game/5399964')
assert.equal(pcIdUrl(''), null)
assert.equal(gradedFromRow({ ...rows[0], id: '' }).url, 'https://www.pricecharting.com/game/pokemon-base-set/charizard-4', 'no id → the name-built guess')
assert.equal(gradedFromRow(rows[2]), null, 'no graded price')
assert.equal(gradedFromRow(rows[3]), null, 'no TCGplayer id')
assert.equal(pcProductUrl('Pokémon Japanese Promo', 'Pikachu (Illustrator)'), 'https://www.pricecharting.com/game/pokemon-japanese-promo/pikachu-illustrator')

// Several rows per TCGplayer id: the plain-named one wins; none / several plain = ambiguous
const { byTcg, ambiguous } = pickByTcgId(rows)
assert.equal(byTcg.get(42382).pcId, '6910')
assert.ok(!byTcg.has(500001))
assert.deepEqual(ambiguous.map((a) => a.tcgId), [500001])
assert.equal(byTcg.get(600001).prices.bgs10bl, 9999)

// Catalog product ids
assert.equal(productIdOf({ id: 'OP01-003', tcgProductId: 500001 }), 500001)
assert.equal(productIdOf({ id: 'tcg-600001' }), 600001)
assert.equal(productIdOf({ id: 'jp-42382' }), 42382)
assert.equal(productIdOf({ id: 'base1-4' }), null, 'Pokémon EN does not carry one yet')
assert.equal(productIdOf({ id: 'rwb-670598', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/670598_in_1000x1000.jpg' }), 670598, 'from a TCGplayer image')
assert.equal(productIdOf({ id: 'x', imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png' }), null)

// Matching: one card per product id; hidden cards and shared ids skipped
const catalog = [
  { id: 'jp-42382' },
  { id: 'tcg-600001' },
  { id: 'OP01-003', tcgProductId: 500001 },
  { id: 'hidden-1', tcgProductId: 42383, hidden: true },
  { id: 'dup-a', tcgProductId: 777 }, { id: 'dup-b', tcgProductId: 777 },
]
const shared = new Map([...byTcg, [777, { pcId: '1', url: 'x', prices: { g9: 1 } }]])
const { entries, sharedProductIds } = matchCatalog(catalog, shared)
assert.deepEqual(entries.map((e) => e.id), ['jp-42382', 'tcg-600001'])
assert.equal(sharedProductIds, 1)
assert.deepEqual(entries[0], { id: 'jp-42382', pc: '6910', u: zard.url, p: zard.prices })

// Grade → column
const cases = [
  ['PSA', '10', null, 'psa10'], ['PSA', '9', null, 'g9'], ['PSA', '8.5', null, 'g8'], ['PSA', '7.5', null, 'g7'],
  ['PSA', '6', null, 'g6'], ['PSA', '1.5', null, 'g1'], ['PSA', 'Authentic', null, null],
  ['BGS', '10', 'pristine', 'bgs10'], ['BGS', '10', 'black', 'bgs10bl'], ['BGS', '9.5', null, 'g95'],
  ['CGC', '10', null, 'cgc10'], ['CGC', '10', 'pristine', 'cgc10p'], ['SGC', '10', 'pristine', 'sgc10'],
  ['TAG', '10', null, 'tag10'], ['ace', '10', null, 'ace10'], ['HGA', '10', null, null], ['HGA', '9', null, 'g9'],
  ['', '9', null, null], ['PSA', '', null, null],
]
for (const [company, grade, tier, want] of cases) {
  assert.equal(gradedPriceKey(company, grade, tier), want, `${company} ${grade} ${tier ?? ''}`)
}
assert.equal(gradedPriceFor(zard.prices, { company: 'PSA', grade: '10' }), 12000)
assert.equal(gradedPriceFor(zard.prices, { company: 'CGC', grade: '10' }), 0, 'no CGC 10 sales → 0 (raw fallback)')
assert.equal(gradedPriceFor(undefined, { company: 'PSA', grade: '10' }), 0)

// Graded history (graded-history.mjs): the slot order is append-only — stored history depends on it
assert.deepEqual(GRADED_ORDER.slice(0, 3), ['g1', 'g2', 'g3'], 'GRADED_ORDER must never be reordered')
assert.equal(GRADED_ORDER.indexOf('psa10'), 10)
assert.equal(gradedTuple({}), null)
const tuple = gradedTuple({ g9: 310, psa10: 1025.014 })
assert.equal(tuple.length, 11, 'trailing zeros dropped')
assert.deepEqual(tupleToGraded(tuple), { g9: 310, psa10: 1025.01 })
assert.deepEqual(tupleToGraded(undefined), {})
{
  const when = new Date('2026-11-18T10:30:00Z')
  const { day, months } = await buildGradedHistory(
    [{ id: 'a', p: { psa10: 100 } }, { id: 'b', p: { g9: 5 } }, { id: 'c', p: {} }],
    new Map([['a', { setCode: 'OP01' }], ['b', { setCode: 'OP02' }]]), when)
  assert.equal(day.day, '2026-11-18')
  assert.deepEqual(Object.keys(day.prices).sort(), ['a', 'b'], 'cards with no graded price are not kept')
  assert.deepEqual([...months.keys()].sort(), ['OP01__2026-11', 'OP02__2026-11'])
  const m = months.get('OP01__2026-11')
  assert.equal(m.dd, '18')
  assert.deepEqual(JSON.parse(await gunzip(m.gz)), { t: when.toISOString(), p: { a: gradedTuple({ psa10: 100 }) } })
}

console.log('pricecharting: all tests passed')
