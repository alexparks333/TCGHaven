// Offline tests for pokemon-tcgplayer.mjs — `npm run test:pokemon-source`.
// Every case is a real one the source report found (names / numbers / prices from TCGplayer and
// pokemon-tcg-data, trimmed to the fields the build reads).
import assert from 'node:assert/strict'
import {
  cleanEnName, namesAgree, productsFromRows, buildPokemonCatalog, resolveIdCollisions, collidingIds,
  isNumberedSet, rarityTier, githubRarity, catalogNumber,
} from './pokemon-tcgplayer.mjs'

// ── Helpers ─────────────────────────────────────────────────────────────────
let nextProduct = 1000
const row = (groupId, name, extNumber, price = '', subTypeName = 'Normal', extra = {}) => ({
  productId: String(extra.productId ?? nextProduct++), groupId: String(groupId), name, extNumber,
  extRarity: extra.extRarity ?? 'Common', subTypeName, marketPrice: String(price), midPrice: '', lowPrice: '',
  imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${extra.productId ?? 1}_200w.jpg`, imageCount: '1',
})
const ghSet = (id, name, extra = {}) => ({ id, name, series: extra.series ?? 'Scarlet & Violet', releaseDate: extra.releaseDate ?? '2024/01/01', total: 0, images: {} })
const ghCard = (set, number, name, setName = set) => ({
  id: `${set}-${number}`, name, set, setName, number: String(number), rarity: 'Common', imageUrl: `gh/${set}/${number}`,
  marketPrice: 0, marketPriceFoil: 0, lowPriceNM: 0, lowPriceNMFoil: 0, variantPrices: {},
})
const group = (groupId, name, extra = {}) => ({ groupId, name, abbreviation: extra.abbreviation ?? '', publishedOn: extra.publishedOn ?? '2024-01-01T00:00:00' })
function build({ ghSets, ghCards, groups, rows, ...rest }) {
  const productsByGroup = new Map(groups.map((g) => [g.groupId, productsFromRows(rows.filter((r) => Number(r.groupId) === g.groupId))]))
  return buildPokemonCatalog({ ghSets, ghCards, groups, productsByGroup, ...rest })
}
const byId = (out) => new Map(out.cards.map((c) => [c.id, c]))

// ── Names ───────────────────────────────────────────────────────────────────
assert.equal(cleanEnName('Masquerain - 003/103'), 'Masquerain')
assert.equal(cleanEnName('Basic Grass Energy - 001'), 'Basic Grass Energy')
assert.equal(cleanEnName('Shiinotic - SM10 (Prerelease) [Staff]'), 'Shiinotic (Prerelease) [Staff]')
assert.equal(cleanEnName('Alolan Sandshrew - 19a/145'), 'Alolan Sandshrew')
assert.equal(cleanEnName('Pikachu (1)'), 'Pikachu')
assert.equal(cleanEnName('Porygon-Z'), 'Porygon-Z')
assert.equal(cleanEnName('Ho-Oh EX'), 'Ho-Oh EX')
for (const [a, b] of [
  ['Bubbly W Energy', 'Bubbly Water Energy'], ['Unit Energy FDY', 'Unit Energy FightingDarknessFairy'],
  ['Exeggutor', 'ナッシー[Exeggutor]'], ['Delta Rainbow Energy', 'δ Rainbow Energy'], ['Umbreon Star', 'Umbreon ★'],
  ['Nidoran F', 'Nidoran ♀'], ['Mewtwo EX', 'Mewtwo-EX'], ['Pikachu (Delta Species)', 'Pikachu δ'],
]) assert.ok(namesAgree(a, b), `${a} = ${b}`)
for (const [a, b] of [['Ivysaur', 'Pikachu δ'], ['Escavalier', 'Antique Cover Fossil'], ['Mew', 'Mewtwo']]) {
  assert.ok(!namesAgree(a, b), `${a} ≠ ${b}`)
}
assert.equal(catalogNumber('011/084'), '11')
assert.equal(catalogNumber('TG01/TG30'), 'TG01')
assert.equal(githubRarity('Holo Rare'), 'Rare Holo')
assert.equal(githubRarity('Illustration Rare'), 'Illustration Rare')
assert.equal(rarityTier('Rare Holo VMAX'), rarityTier('Ultra Rare'))
assert.notEqual(rarityTier('Common'), rarityTier('Uncommon'))

// Code cards and sealed product aren't cards
assert.equal(productsFromRows([row(1, 'Code Card - Pitch Black Booster Pack', '', '', '', { extRarity: 'Code Card' })]).length, 0)
assert.equal(productsFromRows([row(1, 'Delta Reign Booster Box', '', '', '', { extRarity: '' })]).length, 0)

// ── Linking: a Staff copy never prices the card (SM Black Star Promos #SM158) ──
{
  const out = build({
    ghSets: [ghSet('smp', 'SM Black Star Promos')],
    ghCards: [ghCard('smp', 'SM158', 'Charizard')],
    groups: [group(10, 'SM Promos', { abbreviation: 'SMP' })],
    rows: [
      row(10, 'Charizard - SM158 [Staff]', 'SM158', '1250', 'Holofoil', { productId: 2 }),
      row(10, 'Charizard - SM158', 'SM158', '121.95', 'Holofoil', { productId: 1 }),
    ],
  })
  // (matched by TCGplayer's abbreviation, SMP → smp)
  const c = byId(out)
  assert.equal(c.get('smp-SM158').marketPriceFoil, 121.95, 'priced by the plain card, not the $1,250 Staff copy')
  assert.equal(c.get('tcg-2').name, 'Charizard [Staff]', 'the Staff copy is its own card')
  assert.equal(c.get('tcg-2').set, 'smp')
}

// ── Gengar SWSH241: both names have "(Prerelease)" — the fewer qualifiers is the card ──
{
  const out = build({
    ghSets: [ghSet('swshp', 'SWSH Black Star Promos')],
    ghCards: [ghCard('swshp', 'SWSH241', 'Gengar')],
    groups: [group(11, 'SWSH: Sword & Shield Promo Cards')],
    rows: [
      row(11, 'Gengar - SWSH241 (Prerelease) (Staff)', 'SWSH241', '2199.99', 'Holofoil', { productId: 3 }),
      row(11, 'Gengar - SWSH241 (Prerelease)', 'SWSH241', '27.87', 'Holofoil', { productId: 4 }),
    ],
  })
  assert.equal(byId(out).get('swshp-SWSH241').marketPriceFoil, 27.87)
}

// ── Tropical Tidal Wave: the card's own copy is unpriced — it stays unpriced, never takes Staff's ──
{
  const out = build({
    ghSets: [ghSet('np', 'Nintendo Black Star Promos')],
    ghCards: [ghCard('np', 36, 'Tropical Tidal Wave')],
    groups: [group(12, 'Nintendo Promos')],
    rows: [
      row(12, 'Tropical Tidal Wave - 036 (2006 World Championships) [Participation]', '036', '', '', { productId: 5 }),
      row(12, 'Tropical Tidal Wave - 036 (2006 World Championships) [Staff]', '036', '6499.99', 'Normal', { productId: 6 }),
    ],
  })
  const c = byId(out)
  assert.deepEqual(c.get('np-36').variantPrices, {})
  assert.equal(c.get('tcg-6').marketPrice, 6499.99)
}

// ── Black Bolt: no plain reverse holo, so the patterns still price "Reverse Holo" (as before) ──
// ── Prismatic-style: the plain card HAS a reverse holo — the pattern never overrides it ──
{
  const out = build({
    ghSets: [ghSet('zsv10pt5', 'Black Bolt'), ghSet('sv8pt5', 'Prismatic Evolutions')],
    ghCards: [ghCard('zsv10pt5', 61, 'Klink', 'Black Bolt'), ghCard('sv8pt5', 1, 'Exeggcute', 'Prismatic Evolutions')],
    groups: [group(13, 'SV: Black Bolt'), group(14, 'SV: Prismatic Evolutions')],
    rows: [
      row(13, 'Klink - 061/086', '061/086', '0.10', 'Normal', { productId: 7 }),
      row(13, 'Klink (Poke Ball Pattern)', '061/086', '0.40', 'Reverse Holofoil', { productId: 8 }),
      row(13, 'Klink (Master Ball Pattern)', '061/086', '3.00', 'Reverse Holofoil', { productId: 9 }),
      row(14, 'Exeggcute - 001/131', '001/131', '0.05', 'Normal', { productId: 10 }),
      row(14, 'Exeggcute - 001/131', '001/131', '0.20', 'Reverse Holofoil', { productId: 10 }),
      row(14, 'Exeggcute (Poke Ball Pattern)', '001/131', '1.50', 'Reverse Holofoil', { productId: 11 }),
    ],
  })
  const c = byId(out)
  assert.deepEqual(c.get('zsv10pt5-61').variantPrices, { 'unlimited:normal': 0.1, 'unlimited:reverse': 0.4 }, 'lowest-id pattern fills the missing finish')
  assert.equal(c.get('tcg-8').name, 'Klink (Poke Ball Pattern)')
  assert.equal(c.get('tcg-9').setName, 'Black Bolt')
  assert.deepEqual(c.get('sv8pt5-1').variantPrices, { 'unlimited:normal': 0.05, 'unlimited:reverse': 0.2 })
  assert.equal(c.get('tcg-11').marketPriceFoil, 1.5)
}

// ── Same number, different Pokémon: never linked (Nintendo promos #35) ──
{
  const out = build({
    ghSets: [ghSet('np', 'Nintendo Black Star Promos')],
    ghCards: [ghCard('np', 35, 'Pikachu δ')],
    groups: [group(12, 'Nintendo Promos')],
    rows: [row(12, 'Ivysaur - 35/100 (Prerelease)', '35/100', '20', 'Normal', { productId: 12 })],
  })
  assert.deepEqual(byId(out).get('np-35').variantPrices, {})
  assert.equal(out.report.numberOnlyRejected.length, 1)
}

// ── Promo numbering drift: GitHub's #105 is TCGplayer's #125 — linked by unique name instead ──
{
  const out = build({
    ghSets: [ghSet('svp', 'Scarlet & Violet Black Star Promos')],
    ghCards: [ghCard('svp', 105, 'Armarouge ex'), ghCard('svp', 1, 'Sprigatito')],
    groups: [group(15, 'SV: Scarlet & Violet Promo Cards', { abbreviation: 'SVP' })],
    rows: [
      row(15, 'Sprigatito - 001', '001', '1', 'Holofoil', { productId: 13 }),
      row(15, 'Armarouge ex - 125', '125', '4.5', 'Holofoil', { productId: 14 }),
      row(15, 'Mew ex - 105', '105', '9', 'Holofoil', { productId: 15 }),
    ],
  })
  const c = byId(out)
  assert.equal(c.get('svp-105').marketPriceFoil, 4.5)
  assert.ok(!c.has('tcg-14'), 'not also a new card')
  assert.equal(c.get('tcg-15').name, 'Mew ex')
}

// ── A GitHub card TCGplayer files in a promo group (Best of Game in "Best of Promos") ──
{
  const out = build({
    ghSets: [ghSet('bp', 'Best of Game')],
    ghCards: [ghCard('bp', 1, 'Electabuzz', 'Best of Game')],
    groups: [group(16, 'Best of Promos')],
    rows: [
      row(16, 'Electabuzz - 1', '001/009', '12', 'Normal', { productId: 16 }),
      row(16, 'Electabuzz - 1 [Winner]', '001/009', '80', 'Normal', { productId: 17 }),
    ],
  })
  const c = byId(out)
  assert.equal(c.get('bp-1').marketPrice, 12)
  assert.ok(!c.has('tcg-16'))
  assert.equal(c.get('tcg-17')._review, true, 'the Winner stamp is a promo for Needs Review')
}

// ── A new numbered set GitHub doesn't have (Delta Reign) — added whole, never reviewed ──
const deltaRows = Array.from({ length: 25 }, (_, i) => row(24831, `Card ${i + 1} - ${String(i + 1).padStart(3, '0')}/103`, `${String(i + 1).padStart(3, '0')}/103`, '0.25', 'Normal', { productId: 5000 + i }))
{
  const groups = [group(24831, 'ME06: Delta Reign', { publishedOn: '2026-11-06T00:00:00' })]
  const out = build({ ghSets: [ghSet('me5', 'Pitch Black', { series: 'Mega Evolution' })], ghCards: [], groups, rows: deltaRows })
  const set = out.sets.find((s) => s.id === 'tcg-24831')
  assert.equal(set.name, 'Delta Reign')
  assert.equal(set.series, 'Mega Evolution')
  assert.equal(set.tcgplayerGroupId, 24831)
  assert.equal(out.placements.length, 0)
  assert.equal(out.cards.filter((c) => c.set === 'tcg-24831').length, 25)
  assert.ok(out.cards.every((c) => !c._review))
  assert.ok(isNumberedSet(groups[0], productsFromRows(deltaRows)))
  assert.ok(!isNumberedSet(group(1, 'Prize Pack Series Cards'), productsFromRows(deltaRows)), 'promo groups never count as a set')

  // …then GitHub catches up (me6, same name): ours stays, GitHub's set is left out — no duplicate
  const later = build({
    ghSets: [ghSet('me5', 'Pitch Black'), ghSet('me6', 'Delta Reign', { series: 'Mega Evolution' })],
    ghCards: Array.from({ length: 25 }, (_, i) => ghCard('me6', i + 1, `Card ${i + 1}`, 'Delta Reign')),
    groups, rows: deltaRows, previousSets: [ghSet('me5', 'Pitch Black'), set],
  })
  assert.ok(later.cards.every((c) => c.set !== 'me6'), 'no me6 cards')
  assert.ok(!later.sets.some((s) => s.id === 'me6'))
  assert.equal(later.cards.filter((c) => c.set === 'tcg-24831').length, 25)
  assert.deepEqual(later.report.shadowedGithubSets, ['me6'])
}

// ── GitHub's file for a set failed to download: its TCGplayer products are NOT built as new cards ──
{
  const out = build({
    ghSets: [ghSet('sv7', 'Stellar Crown')], ghCards: [],
    groups: [group(20, 'SV07: Stellar Crown')],
    rows: Array.from({ length: 30 }, (_, i) => row(20, `Card ${i}`, `${i + 1}/142`, '1')),
    unavailableSetIds: new Set(['sv7']),
  })
  assert.equal(out.cards.length, 0)
  assert.equal(out.report.skippedGroups.length, 1)
}

// ── A group's CSV failed: that set's GitHub cards are left out (keep today's prices, not $0) ──
{
  const out = build({
    ghSets: [ghSet('sv7', 'Stellar Crown')], ghCards: [ghCard('sv7', 1, 'Bulbasaur')],
    groups: [group(20, 'SV07: Stellar Crown')], rows: [],
    failedGroupIds: new Set([20]),
  })
  assert.equal(out.cards.length, 0)
  assert.deepEqual(out.report.stalePriceSets, ['sv7'])
}

// ── Base Set (Shadowless) only prices editions — never makes cards ──
{
  const out = build({
    ghSets: [ghSet('base1', 'Base')], ghCards: [ghCard('base1', 4, 'Charizard', 'Base')],
    groups: [group(30, 'Base Set'), group(31, 'Base Set (Shadowless)')],
    rows: [
      row(30, 'Charizard', '004/102', '400', 'Holofoil', { productId: 40 }),
      row(31, 'Charizard', '004/102', '9000', '1st Edition Holofoil', { productId: 41 }),
      row(31, 'Charizard', '004/102', '1500', 'Unlimited Holofoil', { productId: 41 }),
    ],
  })
  const c = byId(out)
  assert.deepEqual(c.get('base1-4').variantPrices, { 'unlimited:holofoil': 400, '1st:holofoil': 9000, 'shadowless:holofoil': 1500 })
  assert.ok(!c.has('tcg-41'))
}

// ── Wizards promo Pikachu (1): the plain card beats the misprint ──
{
  const out = build({
    ghSets: [ghSet('basep', 'Wizards Black Star Promos')], ghCards: [ghCard('basep', 1, 'Pikachu')],
    groups: [group(1418, 'WoTC Promo')],
    rows: [
      row(1418, 'Pikachu (1) (Misprint)', '01/53', '', '', { productId: 88065 }),
      row(1418, 'Pikachu (1)', '01/53', '42.76', 'Normal', { productId: 121772 }),
    ],
  })
  const c = byId(out)
  assert.equal(c.get('basep-1').marketPrice, 42.76)
  assert.equal(c.get('tcg-88065').name, 'Pikachu (Misprint)')
}

// ── GitHub cards sharing a number: the one the catalog shows keeps the id ──
{
  const cards = [
    { id: 'me55c-11', _ghId: 'me55c-11', name: 'Metagross' },
    { id: 'me55c-11', _ghId: 'me55c-11g', name: 'Genesect-EX' },
    { id: 'cel25c-15', _ghId: 'cel25c-15_A1', name: 'Venusaur' },
    { id: 'cel25c-15', _ghId: 'cel25c-15_A3', name: "Rocket's Zapdos" },
    { id: 'sv1-1', _ghId: 'sv1-1', name: 'Pineco' },
  ]
  assert.deepEqual(collidingIds(cards), ['me55c-11', 'cel25c-15'])
  resolveIdCollisions(cards, new Map([['me55c-11', 'Genesect-EX'], ['cel25c-15', "Rocket's Zapdos"]]))
  assert.deepEqual(cards.map((c) => c.id), ['me55c-11_metagross', 'me55c-11', 'cel25c-15_A1', 'cel25c-15', 'sv1-1'])
  assert.ok(cards.every((c) => !('_ghId' in c)))
}

// ── A group no name rule matches is matched by what's in it (no duplicate set) ──
{
  const ghCards = Array.from({ length: 10 }, (_, i) => ghCard('xy1', i + 1, `Mon ${i + 1}`, 'XY'))
  const out = build({
    ghSets: [ghSet('xy1', 'XY')], ghCards,
    groups: [group(50, 'Kalos Starter Set Renamed')],
    rows: ghCards.map((c, i) => row(50, `Mon ${i + 1}`, `${i + 1}/146`, '1', 'Normal', { productId: 6000 + i })),
  })
  assert.equal(out.report.contentMatched.length, 1)
  assert.ok(out.cards.every((c) => !c.id.startsWith('tcg-')))
}

console.log('pokemon-tcgplayer: all tests passed')
