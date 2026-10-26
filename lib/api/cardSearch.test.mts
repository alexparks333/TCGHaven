// Offline tests for lib/api/cardSearch.ts — `npm run test:search`.
// Fixtures are real catalog names/numbers (trimmed down), so each case is a search a collector
// actually makes.
import assert from 'node:assert/strict'
import { searchCatalog, rankCards, parseQuery, foldText, numberKey } from './cardSearch.ts'

type C = { id: string; name: string; number: string; set?: string; setCode?: string; setName: string; rarity?: string; tags?: string[]; publicCode?: string; marketPrice?: number }

const pokemon: C[] = [
  { id: 'gym2-29', name: "Sabrina's Gengar", number: '29', set: 'gym2', setName: 'Gym Challenge', rarity: 'Rare', marketPrice: 573 },
  { id: 'gym1-14', name: "Sabrina's Gengar", number: '14', set: 'gym1', setName: 'Gym Heroes', rarity: 'Rare Holo', marketPrice: 499 },
  { id: 'gym1-58', name: "Sabrina's Haunter", number: '58', set: 'gym1', setName: 'Gym Heroes', rarity: 'Uncommon', marketPrice: 64 },
  { id: 'gym1-117', name: "Sabrina's ESP", number: '117', set: 'gym1', setName: 'Gym Heroes', rarity: 'Uncommon', marketPrice: 3 },
  { id: 'base1-5', name: 'Gengar', number: '5', set: 'base3', setName: 'Fossil', rarity: 'Rare Holo', marketPrice: 374 },
  { id: 'swsh8-157', name: 'Gengar VMAX', number: '157', set: 'swsh8', setName: 'Fusion Strike', rarity: 'Rare Holo VMAX', marketPrice: 5 },
  { id: 'swsh8-271', name: 'Gengar VMAX', number: '271', set: 'swsh8', setName: 'Fusion Strike', rarity: 'Rare Secret', marketPrice: 410 },
  { id: 'sm9-165', name: 'Gengar & Mimikyu-GX', number: '165', set: 'sm9', setName: 'Team Up', rarity: 'Rare Ultra', marketPrice: 120 },
  { id: 'base1-4', name: 'Charizard', number: '4', set: 'base1', setName: 'Base', rarity: 'Rare Holo', marketPrice: 954 },
  { id: 'ecard2-146', name: 'Charizard', number: '146', set: 'ecard3', setName: 'Skyridge', rarity: 'Rare Secret', marketPrice: 10000 },
  { id: 'sm115-9', name: 'Charizard-GX', number: '9', set: 'sm115', setName: 'Hidden Fates', rarity: 'Rare Holo GX', marketPrice: 10 },
  { id: 'base5-4', name: 'Dark Charizard', number: '4', set: 'base5', setName: 'Team Rocket', rarity: 'Rare Holo', marketPrice: 75 },
  { id: 'sv3pt5-6', name: 'Charizard ex', number: '6', set: 'sv3pt5', setName: '151', rarity: 'Double Rare', marketPrice: 9 },
  { id: 'sv3pt5-199', name: 'Charizard ex', number: '199', set: 'sv3pt5', setName: '151', rarity: 'Special Illustration Rare', marketPrice: 294 },
  { id: 'base1-25', name: 'Charmander', number: '46', set: 'base1', setName: 'Base', rarity: 'Common', marketPrice: 5 },
  { id: 'neo3-7', name: 'Ho-oh', number: '7', set: 'neo3', setName: 'Neo Revelation', rarity: 'Rare Holo', marketPrice: 488 },
  { id: 'base2-6', name: 'Mr. Mime', number: '6', set: 'base2', setName: 'Jungle', rarity: 'Rare Holo', marketPrice: 165 },
  { id: 'base1-85', name: 'Pokémon Center', number: '85', set: 'base1', setName: 'Base', rarity: 'Uncommon', marketPrice: 2 },
  { id: 'swsh11tg-TG05', name: 'Pikachu', number: 'TG05', set: 'swsh11tg', setName: 'Lost Origin Trainer Gallery', rarity: 'Trainer Gallery Rare Holo', marketPrice: 40 },
  { id: 'swsh12pt5gg-GG30', name: 'Pikachu', number: 'GG30', set: 'swsh12pt5gg', setName: 'Crown Zenith Galarian Gallery', rarity: 'Trainer Gallery Rare Holo', marketPrice: 37 },
  { id: 'pop5-17', name: 'Umbreon ★', number: '17', set: 'pop5', setName: 'POP Series 5', rarity: 'Rare', marketPrice: 0 },
  { id: 'base3-57', name: 'Nidoran ♀', number: '57', set: 'base2', setName: 'Jungle', rarity: 'Common', marketPrice: 2 },
  { id: 'ex11-6', name: 'Gardevoir δ', number: '6', set: 'ex11', setName: 'Delta Species', rarity: 'Rare Holo', marketPrice: 121 },
  { id: 'ex8-107', name: "Farfetch'd", number: '107', set: 'ex6', setName: 'Emerald', rarity: 'Rare Secret', marketPrice: 107 },
  { id: 'neo3-12', name: 'Porygon2', number: '12', set: 'neo3', setName: 'Neo Revelation', rarity: 'Rare Holo', marketPrice: 135 },
  { id: 'gym1-97', name: "Blaine's Quiz #1", number: '97', set: 'gym1', setName: 'Gym Heroes', rarity: 'Rare', marketPrice: 26 },
]

const names = (cards: C[]) => cards.map((c) => `${c.name} #${c.number}`)
const top = (q: string, cards = pokemon) => rankCards(cards, q)[0]

// ── The owner's own examples ────────────────────────────────────────────────

// "sabrinas" (no apostrophe) finds every Sabrina's card
{
  const r = rankCards(pokemon, 'sabrinas')
  assert.equal(r.length, 4)
  assert.ok(r.every((c) => c.name.startsWith("Sabrina's")))
}
// …with any capitalization or apostrophe style
for (const q of ['SABRINAS GENGAR', "sabrina's gengar", 'Sabrina’s Gengar', 'sabrina gengar', 'sabrinas  gengar ']) {
  assert.deepEqual(names(rankCards(pokemon, q)), ["Sabrina's Gengar #29", "Sabrina's Gengar #14"], q)
}
// "Charizard 4": every Charizard, the #4s first (plain name before "Dark Charizard")
{
  const r = rankCards(pokemon, 'Charizard 4')
  assert.deepEqual(names(r.slice(0, 2)), ['Charizard #4', 'Dark Charizard #4'])
  assert.ok(r.some((c) => c.number === '146'), 'other Charizards still listed')
  assert.ok(!r.some((c) => c.name === 'Charmander'))
}
assert.equal(top('charizard 9').id, 'sm115-9')
assert.equal(top('charizard 004').id, 'base1-4')
assert.equal(top('charizard 4/102').id, 'base1-4')
assert.equal(top('charizard #4').id, 'base1-4')

// ── Normalization ───────────────────────────────────────────────────────────

assert.equal(foldText("Sabrina's Gengar"), 'sabrinas gengar')
assert.equal(foldText('Pokémon Center'), 'pokemon center')
assert.equal(foldText('Nidoran ♀'), 'nidoran female')
assert.equal(foldText('Æther Vial'), 'aether vial')
assert.equal(numberKey('009'), '9')
assert.equal(numberKey('TG05'), 'tg5')
assert.equal(numberKey('4/102'), '4')
assert.equal(numberKey('OP01-024'), 'op124')
assert.equal(numberKey('PRB02-009'), 'prb29')
assert.equal(top('hooh').name, 'Ho-oh')
assert.equal(top('ho oh').name, 'Ho-oh')
assert.equal(top('mrmime').name, 'Mr. Mime')
assert.equal(top('mr mime').name, 'Mr. Mime')
assert.equal(top('pokemon center').name, 'Pokémon Center')
assert.equal(top('farfetchd').name, "Farfetch'd")
assert.equal(top('umbreon star').name, 'Umbreon ★')
assert.equal(top('nidoran f').name, 'Nidoran ♀')
assert.equal(top('gardevoir delta').name, 'Gardevoir δ')
assert.equal(top('porygon2').name, 'Porygon2')
assert.equal(top('blaines quiz 1').name, "Blaine's Quiz #1")

// ── Item specifics: set, rarity ─────────────────────────────────────────────

assert.deepEqual(names(rankCards(pokemon, 'gengar fusion strike')), ['Gengar VMAX #271', 'Gengar VMAX #157'])
assert.deepEqual(rankCards(pokemon, 'charizard 151').slice(0, 2).map((c) => c.setName), ['151', '151'])
assert.equal(top('gengar secret').id, 'swsh8-271')
assert.equal(top('pikachu crown zenith').id, 'swsh12pt5gg-GG30')
// a name hit always outranks the same word only hitting a set name
assert.equal(top('gengar').name, 'Gengar')

// ── Ranking ─────────────────────────────────────────────────────────────────

{
  const r = names(rankCards(pokemon, 'gengar'))
  assert.equal(r[0], 'Gengar #5', 'exact name first')
  assert.ok(r.indexOf('Gengar & Mimikyu-GX #165') > r.indexOf('Gengar VMAX #271'), 'longer names later')
  assert.ok(r.indexOf("Sabrina's Gengar #29") > r.indexOf('Gengar VMAX #271'))
}
// ties go to the more valuable card
assert.deepEqual(names(rankCards(pokemon, 'sabrinas gengar')), ["Sabrina's Gengar #29", "Sabrina's Gengar #14"])

// ── Collector numbers ───────────────────────────────────────────────────────

assert.deepEqual(names(rankCards(pokemon, 'tg05')), ['Pikachu #TG05'])
assert.equal(top('pikachu gg30').number, 'GG30')
assert.equal(top('pikachu 30').number, 'GG30') // digits alone still find a prefixed number
assert.equal(rankCards(pokemon, '99999').length, 0)

// ── Typos, plurals ──────────────────────────────────────────────────────────

assert.deepEqual([...new Set(rankCards(pokemon, 'charzard').map((c) => c.name.split(' ')[0]))].sort(), ['Charizard', 'Charizard-GX', 'Dark'].sort())
assert.ok(!rankCards(pokemon, 'charzard').some((c) => c.name === 'Charmander'), 'closest correction only')
assert.deepEqual(names(rankCards(pokemon, 'gengr sabrina')), ["Sabrina's Gengar #29", "Sabrina's Gengar #14"])
assert.equal(top('charizards').name, 'Charizard')
// a correctly spelled prefix is never "corrected"
assert.ok(rankCards(pokemon, 'charm').every((c) => c.name === 'Charmander'))

// ── eBay operators, fallback ────────────────────────────────────────────────

assert.ok(!rankCards(pokemon, 'charizard -ex -gx').some((c) => /\bex\b|GX/.test(c.name)))
assert.deepEqual(names(rankCards(pokemon, '"dark charizard"')), ['Dark Charizard #4'])
// nothing has every word → "results matching fewer words" rather than nothing
assert.ok(rankCards(pokemon, 'gengar zzzzzz').length > 0)
assert.equal(searchCatalog(pokemon, 'gengar zzzzzz', { relax: false }).length, 0)
assert.equal(rankCards(pokemon, '').length, 0)
assert.equal(rankCards(pokemon, '!!').length, 0)

// ── Finish words ────────────────────────────────────────────────────────────

assert.deepEqual(parseQuery('charizard holo').words, ['charizard'])
assert.equal(parseQuery('charizard holo').finish, 'foil')
assert.equal(parseQuery('elsa nonfoil').finish, 'normal')
assert.equal(top('charizard holo 4').id, 'base1-4')

// ── Other games ─────────────────────────────────────────────────────────────

const riftbound: C[] = [
  { id: 'origins-007a', name: 'Fury Rune', number: '7', publicCode: 'OGN-007a/298', setCode: 'OGN', setName: 'Origins', rarity: 'Alt Art' },
  { id: 'origins-007', name: 'Fury Rune', number: '7', publicCode: 'OGN-007/298', setCode: 'OGN', setName: 'Origins', rarity: 'Common' },
  { id: 'origins-066', name: 'Deceiver', number: '66', publicCode: 'OGN-066/298', setCode: 'OGN', setName: 'Origins', rarity: 'Rare', tags: ['LeBlanc'] },
  { id: 'origins-299', name: 'Daughter of the Void (Signature)', number: '299', publicCode: 'OGN-299*/298', setCode: 'OGN', setName: 'Origins', rarity: 'Star', tags: ["Kai'Sa"] },
  { id: 'origins-039', name: "Kai'Sa", number: '39', publicCode: 'OGN-039/298', setCode: 'OGN', setName: 'Origins', rarity: 'Epic' },
]
assert.deepEqual(rankCards(riftbound, 'ogn-007a').map((c) => c.id), ['origins-007a'])
assert.equal(rankCards(riftbound, 'fury rune 7a')[0].id, 'origins-007a')
assert.equal(rankCards(riftbound, 'fury rune alt art')[0].id, 'origins-007a')
assert.equal(rankCards(riftbound, 'leblanc')[0].id, 'origins-066') // champion tag
assert.deepEqual(rankCards(riftbound, 'kaisa').map((c) => c.id), ['origins-039', 'origins-299'])

const onepiece: C[] = [
  { id: 'OP01-024', name: 'Monkey.D.Luffy', number: '024', set: 'OP01', setName: 'Romance Dawn', rarity: 'SR' },
  { id: 'OP01-024_p1', name: 'Monkey.D.Luffy', number: '024', set: 'OP01', setName: 'Romance Dawn', rarity: 'SR' },
  { id: 'OP01-061', name: 'Mr.2.Bon.Kurei(Bentham)', number: '061', set: 'OP01', setName: 'Romance Dawn', rarity: 'R' },
]
assert.deepEqual(rankCards(onepiece, 'OP01-024').map((c) => c.id), ['OP01-024', 'OP01-024_p1'])
assert.equal(rankCards(onepiece, 'monkey d luffy').length, 2)
assert.equal(rankCards(onepiece, 'luffy 24').length, 2)
assert.equal(rankCards(onepiece, 'mr 2')[0].id, 'OP01-061')
assert.equal(rankCards(onepiece, 'bon kurei')[0].id, 'OP01-061')
// extra per-game terms (what searchTerms.ts supplies)
assert.deepEqual(
  rankCards(onepiece.map((c) => ({ ...c })), 'luffy parallel', { extraTerms: (c) => (/_p\d+$/.test(c.id) ? 'parallel' : undefined) }).map((c) => c.id),
  ['OP01-024_p1'],
)

const mtg: C[] = [
  { id: 'a', name: 'Lightning Bolt', number: '161', set: 'lea', setName: 'Limited Edition Alpha', rarity: 'common', marketPrice: 626 },
  { id: 'b', name: 'Lightning Bolt', number: '146', set: 'm10', setName: 'Magic 2010', rarity: 'common', marketPrice: 2 },
  { id: 'c', name: 'Fire // Ice', number: '128', set: 'apc', setName: 'Apocalypse', rarity: 'uncommon', marketPrice: 3 },
  { id: 'd', name: 'Æther Vial', number: '91', set: 'dst', setName: 'Darksteel', rarity: 'uncommon', marketPrice: 4 },
  { id: 'e', name: 'Lim-Dûl the Necromancer', number: '22', set: 'all', setName: 'Alliances', rarity: 'rare', marketPrice: 1 },
]
assert.equal(rankCards(mtg, 'lightning bolt m10')[0].id, 'b')
assert.equal(rankCards(mtg, 'lightnig bolt').length, 2)
assert.equal(rankCards(mtg, 'fire ice')[0].id, 'c')
assert.equal(rankCards(mtg, 'aether vial')[0].id, 'd')
assert.equal(rankCards(mtg, 'limdul')[0].id, 'e')

const lorcana: C[] = [
  { id: '1-115', name: 'Mickey Mouse - Brave Little Tailor', number: '115', set: '1', setName: 'The First Chapter', rarity: 'Legendary' },
  { id: '1-208', name: 'Mickey Mouse - Wayward Sorcerer', number: '208', set: '1', setName: 'The First Chapter', rarity: 'Enchanted' },
  { id: '1-207', name: 'Elsa - Spirit of Winter', number: '207', set: '1', setName: 'The First Chapter', rarity: 'Enchanted' },
]
assert.equal(rankCards(lorcana, 'mickey tailor')[0].id, '1-115')
assert.equal(rankCards(lorcana, 'mickey enchanted')[0].id, '1-208')
assert.equal(rankCards(lorcana, 'elsa 207')[0].id, '1-207')

console.log('cardSearch: all tests passed')
