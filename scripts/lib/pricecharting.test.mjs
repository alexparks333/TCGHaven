// Offline tests for pricecharting.mjs — `npm run test:pricecharting`. A synthetic CSV shaped like
// PriceCharting's daily price list (column names from their API docs); no network, no Firestore.
import assert from 'node:assert/strict'
import {
  parsePcPrice, penniesToUsd, parsePcCsv, gradedFromRow, pickByTcgId, productIdOf, matchCatalog,
  gradedPriceKey, gradedPriceFor, pcProductUrl, pcIdUrl, pcVariantOf, gradedVariantKey,
  normPcNumber, pcNameParts, linkSlot, applyManualLinks, suggestLinks, backupMatch, validateBackup, backupAllowed,
  ungradedPrices,
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
assert.deepEqual(entries[0], { id: 'jp-42382', pc: '6910', u: zard.url, p: zard.prices, v: { '1st': { p: { g9: 9000 }, u: 'https://www.pricecharting.com/game/6911' } } }, 'the 1st Edition listing kept as a version')

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

// Versions PriceCharting lists separately under one TCGplayer id (seen 2026-11-19: Magic 1,862 and
// Lorcana 352 "[Foil]" rows, Yu-Gi-Oh! 8,253 "[1st Edition]" rows; Pokémon "[Holo]"/"[Reverse Holo]")
assert.equal(pcVariantOf('Alice - Savvy Sailor #161'), '')
assert.equal(pcVariantOf('Baymax - Armored Companion  [Foil] #157'), 'foil')
assert.equal(pcVariantOf('Blue-Eyes White Dragon [1ST Edition] LOB-001'), '1st')
assert.equal(pcVariantOf('Absol [Reverse Holo] #97'), 'reverse')
assert.equal(pcVariantOf('Absol [Holo] #97'), 'holo')
assert.equal(pcVariantOf('Accesscode Talker [Ultimate Rare] RA02-EN044'), null, 'a rarity version can not be matched')
assert.equal(pcVariantOf('X [Mosaic Rare 1st Edition]'), null)
{
  const mk = (id, name, psa10) => ({ id, 'console-name': 'Set', 'product-name': name, 'manual-only-price': String(psa10), 'tcg-id': '777' })
  const { byTcg, ambiguous } = pickByTcgId([mk('1', 'Elsa #1', 30), mk('2', 'Elsa [Foil] #1', 40), mk('3', 'Elsa [Extended Art] #1', 99)])
  assert.equal(ambiguous.length, 0)
  const e = byTcg.get(777)
  assert.equal(e.prices.psa10, 30, 'the plain listing is the card')
  assert.deepEqual(e.variants, { foil: { p: { psa10: 40 }, u: 'https://www.pricecharting.com/game/2' } }, 'its [Foil] kept beside it; unmatchable versions dropped')
  const holo = pickByTcgId([mk('4', 'Absol [Holo] #97', 10), mk('5', 'Absol [Reverse Holo] #97', 25)]).byTcg.get(777)
  assert.equal(holo.prices.psa10, 10, 'no plain listing: the [Holo] one is the card')
  assert.equal(holo.variants.reverse.p.psa10, 25)
  const { entries } = matchCatalog([{ id: 'c1', tcgProductId: 777 }], new Map([[777, e]]))
  assert.deepEqual(entries[0].v, e.variants, 'versions travel with the catalog entry')
}
// Versions filed under another TCGplayer id (Base Set's Shadowless product) join the card whose
// plain row has the same set, name and number
{
  const mk = (id, name, psa10, tcg, set = 'Pokemon Base Set') => ({ id, 'console-name': set, 'product-name': name, 'manual-only-price': String(psa10), 'tcg-id': String(tcg) })
  const { byTcg, ambiguous } = pickByTcgId([
    mk('1', 'Charizard #4', 32940, 42382),
    mk('2', 'Charizard [1st Edition] #4', 466431, 106999),   // both under the Shadowless product
    mk('3', 'Charizard [Shadowless] #4', 24808, 106999),
    mk('4', 'Alakazam #1', 3365, 42346),
    mk('5', 'Alakazam [1st Edition] #1', 23790, 42346),      // under the card's own product
    mk('6', 'Alakazam [Shadowless] #1', 9785, 106996),       // alone under its own
    mk('7', 'Alakazam [1st Edition] #1', 1, 555),            // a second 1st Edition row elsewhere: not used
    mk('8', 'Abra #43', 178, 42386),
    mk('9', 'Abra #43', 999, 1),                             // two plain rows → can't tell which
    mk('10', 'Abra [1st Edition] #43', 834, 107040),
    mk('11', 'Charizard [1st Edition] #4', 5, 2, 'Pokemon Base Set 2'),   // another set: never joins
  ])
  const zard = byTcg.get(42382)
  assert.equal(zard.prices.psa10, 32940)
  assert.deepEqual(zard.variants, {
    '1st': { p: { psa10: 466431 }, u: 'https://www.pricecharting.com/game/2' },
    shadowless: { p: { psa10: 24808 }, u: 'https://www.pricecharting.com/game/3' },
  })
  const ala = byTcg.get(42346)
  assert.equal(ala.variants['1st'].p.psa10, 23790, "the card's own 1st Edition row stays")
  assert.equal(ala.variants.shadowless.p.psa10, 9785)
  assert.equal(byTcg.get(42386).variants, undefined, 'two plain Abra rows: not attached')
  assert.ok(!ambiguous.some((a) => a.tcgId === 106999), 'a fully attached id is no longer reported')
}

const vars = { foil: { p: {} }, '1st': { p: {} }, reverse: { p: {} } }
assert.equal(gradedVariantKey({}, vars), '')
assert.equal(gradedVariantKey({ isFoil: true }, vars), 'foil')
assert.equal(gradedVariantKey({ isFoil: true }, {}), '', 'a foil with no [Foil] listing uses the plain one (foil-only product)')
assert.equal(gradedVariantKey({ edition: '1st' }, vars), '1st')
assert.equal(gradedVariantKey({ edition: 'shadowless' }, vars), null, 'a version with no listing gets no graded price')
assert.equal(gradedVariantKey({ edition: 'unlimited' }, vars), '')
assert.equal(gradedVariantKey({ finish: 'reverse' }, vars), 'reverse')
assert.equal(gradedVariantKey({ finish: 'reverse' }, {}), null)

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
    [{ id: 'a', p: { psa10: 100 }, v: { '1st': { p: { psa10: 900 } } } }, { id: 'b', p: { g9: 5 } }, { id: 'c', p: {} }],
    new Map([['a', { setCode: 'OP01' }], ['b', { setCode: 'OP02' }]]), when)
  assert.equal(day.day, '2026-11-18')
  assert.deepEqual(Object.keys(day.prices).sort(), ['a', 'a~1st', 'b'], 'cards with no graded price are not kept; versions kept as {id}~{version}')
  assert.deepEqual([...months.keys()].sort(), ['OP01__2026-11', 'OP02__2026-11'])
  const m = months.get('OP01__2026-11')
  assert.equal(m.dd, '18')
  assert.deepEqual(JSON.parse(await gunzip(m.gz)), { t: when.toISOString(), p: { a: gradedTuple({ psa10: 100 }), 'a~1st': gradedTuple({ psa10: 900 }) } })
}

// Graded links (2026-11-21): suggestions for rows with no TCGplayer id; links only from staff
assert.equal(normPcNumber('019/252'), '19')
assert.equal(normPcNumber('OP01-001'), '1')
assert.equal(normPcNumber('DPBC-EN039'), 'dpbc-en039', 'a code that isn\'t "letters+digits-digits" is kept whole')
assert.deepEqual(pcNameParts('Ursula - Deceiver [Foil] #90'), { base: 'ursula deceiver', number: '90', variant: 'foil' })
assert.deepEqual(pcNameParts('Bartolomeo OP07-031'), { base: 'bartolomeo', number: '31', variant: '' }, 'One Piece: the code at the end, no #')
assert.equal(pcNameParts('Booster Pack').number, '', 'no number → never suggested')
assert.equal(linkSlot('', 'Anna'), '')
assert.equal(linkSlot('foil', 'Anna - Ice Breaker'), 'foil', 'a [Foil] row on a plain card = its Foil version')
assert.equal(linkSlot('foil', 'Ursula - Deceiver (Foil)'), '', 'on a separate foil card = that card\'s own price')
{
  const rows = [
    { id: '1', 'console-name': 'Lorcana Test', 'product-name': 'A #1', 'tcg-id': '11', 'manual-only-price': '$10' },
    { id: '2', 'console-name': 'Lorcana Test', 'product-name': 'B #2', 'tcg-id': '12', 'manual-only-price': '$10' },
    { id: '3', 'console-name': 'Lorcana Test', 'product-name': 'C #3', 'tcg-id': '13', 'manual-only-price': '$10' },
    { id: '4', 'console-name': 'Lorcana Test', 'product-name': 'D #4', 'tcg-id': '', 'manual-only-price': '$50' },
    { id: '5', 'console-name': 'Lorcana Test', 'product-name': 'A [Foil] #1', 'tcg-id': '', 'manual-only-price': '$99' },
    { id: '6', 'console-name': 'Lorcana Other', 'product-name': 'Z #9', 'tcg-id': '', 'manual-only-price': '$5' },
  ]
  const cards = [
    { id: 'a', name: 'A', number: '1', set: 'T', tcgProductId: 11 }, { id: 'b', name: 'B', number: '2', set: 'T', tcgProductId: 12 },
    { id: 'c', name: 'C', number: '3', set: 'T', tcgProductId: 13 }, { id: 'd', name: 'D', number: '004', set: 'T' },
    { id: 'd2', name: 'D (Promo)', number: '4', set: 'T' }, { id: 'z', name: 'Z', number: '9', set: 'Q' },
  ]
  const out = suggestLinks(rows, { lorcana: cards }, new Set(['lorcana:a', 'lorcana:b', 'lorcana:c']))
  const items = out.lorcana
  assert.deepEqual(items.map((i) => i.pc), ['5', '4'], 'most valuable first; the unlearned set (Lorcana Other) gives nothing')
  assert.deepEqual(items[1].cards.map((c) => [c.id, c.exact]), [['d', true], ['d2', false]], 'every card with that number, exact name first — staff choose')
  assert.deepEqual(items[0].cards.map((c) => c.id), ['a'], 'a version row may go to a card already priced')
  assert.equal(suggestLinks(rows, { lorcana: cards }, new Set(), new Set(['4', '5'])).lorcana?.length ?? 0, 0, 'linked / dismissed rows are not suggested again')

  const entries = [{ id: 'a', pc: '1', u: 'u1', p: { psa10: 10 } }, { id: 'c', pc: '3', u: 'u3', p: { psa10: 10 } }]
  const got = applyManualLinks(entries, rows, { a: { foil: '5' }, d: { _: '4' }, c: { _: '4' }, x: { _: '404' } }, { b: true })
  assert.deepEqual(got.find((e) => e.id === 'a'), { id: 'a', pc: '1', u: 'u1', p: { psa10: 10 }, v: { foil: { p: { psa10: 99 }, u: 'https://www.pricecharting.com/game/5' } } },
    'a version link adds the version beside the card\'s own price')
  assert.deepEqual(got.find((e) => e.id === 'd'), { id: 'd', pc: '4', u: 'https://www.pricecharting.com/game/4', p: { psa10: 50 }, via: 'staff' })
  assert.equal(got.find((e) => e.id === 'c').pc, '4', 'a staff link replaces the matched one (redirect)')
  assert.deepEqual(applyManualLinks(entries, rows, {}, { a: true }).map((e) => e.id), ['c'], 'blocked: no graded price at all')
  assert.equal(got.some((e) => e.id === 'x'), false, 'a row gone from the list adds nothing')
}

{
  // Automatic matching: only unambiguous rows, only cards PriceCharting doesn't list by their own id
  const rows = [
    ...[1, 2, 3].map((n) => ({ id: `r${n}`, 'console-name': 'Pokemon Test', 'product-name': `Card${n} #${n}`, 'tcg-id': String(100 + n), 'manual-only-price': '$10' })),
    { id: 'n4', 'console-name': 'Pokemon Test', 'product-name': 'Card4 #4', 'tcg-id': '', 'manual-only-price': '$40' },
    { id: 'n5', 'console-name': 'Pokemon Test', 'product-name': 'Card5 #5', 'tcg-id': '', 'manual-only-price': '$50' },
    { id: 'n6', 'console-name': 'Pokemon Test', 'product-name': 'Card6 #6', 'tcg-id': '', 'manual-only-price': '$60' },
    { id: 'n6b', 'console-name': 'Pokemon Test', 'product-name': 'Card6 #6', 'tcg-id': '', 'manual-only-price': '$61' },
    { id: 'n7', 'console-name': 'Pokemon Test', 'product-name': 'Card7 #7', 'tcg-id': '', 'manual-only-price': '$70' },
    { id: 'r8', 'console-name': 'Pokemon Test', 'product-name': 'Other #9', 'tcg-id': '108', 'manual-only-price': '$1' },
  ]
  const cards = [
    ...[1, 2, 3].map((n) => ({ id: `c${n}`, name: `Card${n}`, number: String(n), set: 'T', tcgProductId: 100 + n })),
    { id: 'c4', name: 'Card4', number: '004', set: 'T' },
    { id: 'c5', name: 'Card5', number: '5', set: 'T' }, { id: 'c5b', name: 'Card5', number: '5', set: 'T' },
    { id: 'c6', name: 'Card6', number: '6', set: 'T' },
    { id: 'c7', name: 'Card7', number: '7', set: 'T', tcgProductId: 108 },
  ]
  const links = backupMatch(rows, { pokemon: cards })
  assert.deepEqual(links.map((l) => [l.id, l.pc]), [['c4', 'n4']],
    'two of our cards (5), two PriceCharting rows (6), or a card PriceCharting lists under its own id (7) → never matched')
  const check = validateBackup(rows, { pokemon: cards })
  assert.deepEqual([check.pokemon.right, check.pokemon.wrong], [2, 0], 'replayed with the id hidden: right, never wrong (with two ids hidden at once, too few are left to learn the set — silent, not wrong)')
  assert.equal(backupAllowed(check).has('pokemon'), false, 'too few checked to trust (needs 20)')
  assert.equal(backupAllowed({ a: { right: 2000, wrong: 1 }, b: { right: 2000, wrong: 3 } }).has('a'), true)
  assert.equal(backupAllowed({ b: { right: 2000, wrong: 3 } }).has('b'), false, 'more than 0.1% wrong → off')
}

// Ungraded prices for stagnant cards
{
  const rows = [
    { id: '900', 'product-name': 'Ahri #303a', 'tcg-id': '', 'loose-price': '$412.50' },
    { id: '901', 'product-name': 'Rengar #25a', 'tcg-id': '700001', 'loose-price': '80.00' },
    { id: '902', 'product-name': 'Rengar #25a [Foil]', 'tcg-id': '700001', 'loose-price': '120.00' },
    { id: '903', 'product-name': 'Jinx #1', 'tcg-id': '', 'loose-price': '10' },
    { id: '904', 'product-name': 'Vi #2', 'tcg-id': '700002', 'loose-price': '' },
  ]
  const cards = [
    { id: 'ahri' }, { id: 'rengar', tcgProductId: 700001 }, { id: 'jinx' }, { id: 'vi', tcgProductId: 700002 },
    { id: 'priced', tcgProductId: 700001 }, { id: 'gone', hidden: true }, { id: 'blocked' },
  ]
  const out = ungradedPrices(cards, rows, [{ id: 'jinx', pc: '903' }], { ahri: { _: '900' }, blocked: { _: '900' } }, { blocked: true },
    (c) => c.id !== 'priced')
  assert.deepEqual(out, {
    ahri: { r: 412.5, u: 'https://www.pricecharting.com/game/900', pc: '900' },     // staff link, no graded sales needed
    rengar: { r: 80, u: 'https://www.pricecharting.com/game/901', pc: '901' },      // by TCGplayer id, the plain row
    jinx: { r: 10, u: 'https://www.pricecharting.com/game/903', pc: '903' },        // its graded entry
  })
}

console.log('pricecharting: all tests passed')
