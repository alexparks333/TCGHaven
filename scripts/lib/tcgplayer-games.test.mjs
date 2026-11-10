// Tests for the TCGplayer-sourced catalogs (tcgplayer-games.mjs) — `npm run test:tcgplayer-games`.
// Fixtures are real TCGplayer products (tcgcsv categories 62, 63, 79, 86, 91 — 2026-11-10), trimmed.
import assert from 'node:assert/strict'
import {
  TCGPLAYER_GAMES, TCGPLAYER_GAME_IDS, splitName, setCodeOf, cleanNumber, dropNumberSuffix, setTypeOf, printingKeyOf,
  isFoilSubtype, priceFieldsOf, productsFromRows, isSingle, cardFromProduct, mergePrices, buildTcgplayerCatalog,
} from './tcgplayer-games.mjs'

assert.deepEqual(TCGPLAYER_GAME_IDS, ['swu', 'gundam', 'fab', 'digimon', 'palworld'])
for (const cfg of Object.values(TCGPLAYER_GAMES)) {
  for (const t of [...cfg.setTypes.map(([t]) => t), cfg.fallbackType]) assert.ok(cfg.setTypeLabels[t], `${cfg.label}: label for ${t}`)
}

// ── Names: the printed name + the version TCGplayer appends ──
assert.deepEqual(splitName('swu', 'Grogu -  Yes. Yes. Yes. (Top 8)'), { name: 'Grogu - Yes. Yes. Yes.', variant: 'Top 8' })
assert.deepEqual(splitName('swu', 'Orbiting K-Wing (Hyperspace Foil)'), { name: 'Orbiting K-Wing', variant: 'Hyperspace Foil' })
assert.deepEqual(splitName('fab', 'Rising Energy (Red)'), { name: 'Rising Energy (Red)', variant: '' }, 'pitch is part of the name')
assert.deepEqual(splitName('fab', 'Staunch Response (Blue) (Marvel)'), { name: 'Staunch Response (Blue)', variant: 'Marvel' })
assert.deepEqual(splitName('digimon', 'Omnimon (X Antibody)'), { name: 'Omnimon (X Antibody)', variant: '' })
assert.deepEqual(splitName('digimon', 'BeelStarmon (X Antibody) (Textured)'), { name: 'BeelStarmon (X Antibody)', variant: 'Textured' })
assert.deepEqual(splitName('digimon', 'Agumon (Alternate Art)'), { name: 'Agumon', variant: 'Alternate Art' })
assert.deepEqual(splitName('gundam', 'Full Armor Unicorn Gundam (Destroy Mode)'), { name: 'Full Armor Unicorn Gundam (Destroy Mode)', variant: '' }, 'a form is part of the name')
assert.deepEqual(splitName('gundam', 'The-O (LR+)'), { name: 'The-O', variant: 'LR+' })
assert.deepEqual(splitName('gundam', 'Chaos Gundam (MA Mode) (R+)'), { name: 'Chaos Gundam (MA Mode)', variant: 'R+' })
assert.deepEqual(splitName('gundam', 'Gundam Exia (ST07-001)'), { name: 'Gundam Exia', variant: 'ST07-001' })
assert.deepEqual(splitName('gundam', 'Dra-C (Store Tournament Winner Pack 01)'), { name: 'Dra-C', variant: 'Store Tournament Winner Pack 01' })
assert.deepEqual(splitName('palworld', 'Pengullet - Frequent Flyer(TSR)'), { name: 'Pengullet - Frequent Flyer', variant: 'TSR' })
assert.deepEqual(splitName('palworld', 'Digtoise - Seismic Drillback (SP) (2nd Edition)'), { name: 'Digtoise - Seismic Drillback', variant: 'SP · 2nd Edition' })

assert.deepEqual(splitName('gundam', 'EX Base (EXBP-028) (1st Anniversary Event) (Serialized)'), { name: 'EX Base', variant: 'EXBP-028 · 1st Anniversary Event · Serialized' })
assert.deepEqual(splitName('gundam', 'Freedom Gundam (Newtype Challenge 2026 Mission 1)'), { name: 'Freedom Gundam', variant: 'Newtype Challenge 2026 Mission 1' })
assert.deepEqual(splitName('gundam', 'Gundam Heavyarms Custom (EW)'), { name: 'Gundam Heavyarms Custom (EW)', variant: '' })
assert.equal(setCodeOf({ abbreviation: 'SOR' }, '010/252'), 'SOR')
assert.equal(setCodeOf({ abbreviation: '' }, 'SFC001'), 'SFC', 'no abbreviation: the number\'s letters')
assert.equal(setCodeOf({ abbreviation: '' }, 'GD01-118'), 'GD01')
assert.equal(setCodeOf({ abbreviation: '', name: 'Gamegenic Promos' }, '1/0'), 'Gamegenic Promos', 'else the set name')
assert.equal(dropNumberSuffix('Graphene Chelicera - GEM008', 'GEM008'), 'Graphene Chelicera')
assert.equal(dropNumberSuffix('MetalTyrannomon - BT2-046', 'BT2-046'), 'MetalTyrannomon')
assert.equal(dropNumberSuffix('Han Solo - I Got a Really Good Feeling', '17/264'), 'Han Solo - I Got a Really Good Feeling')
assert.equal(dropNumberSuffix('Dash I/O - HER156', 'HER0156'), 'Dash I/O - HER156', 'only the card\'s own number is dropped')

// ── Numbers ──
assert.equal(cleanNumber('digimon', 'BT26-066 C'), 'BT26-066', 'Digimon: rarity letter dropped')
assert.equal(cleanNumber('digimon', 'ST17-01 U'), 'ST17-01')
assert.equal(cleanNumber('fab', 'WTR040//WTR001'), 'WTR040 // WTR001')
assert.equal(cleanNumber('swu', '228/262'), '228/262')
assert.equal(cleanNumber('gundam', ''), '')

// ── Cardex groups ──
assert.equal(setTypeOf('swu', 'Spark of Rebellion'), 'booster')
assert.equal(setTypeOf('swu', 'Jump to Lightspeed: Weekly Play Promos'), 'promo')
assert.equal(setTypeOf('swu', 'Intro Battle: Hoth'), 'starter')
assert.equal(setTypeOf('gundam', 'Starter Deck 01: Heroic Beginnings'), 'starter')
assert.equal(setTypeOf('gundam', 'Promotional EX Base Tokens'), 'promo')
assert.equal(setTypeOf('gundam', 'Newtype Rising'), 'booster')
assert.equal(setTypeOf('fab', 'Blitz Deck: Monarch - Boltyn'), 'deck')
assert.equal(setTypeOf('fab', 'History Pack Vol.1'), 'special')
assert.equal(setTypeOf('fab', 'Usurp the Shadow Throne Pre-release Cards'), 'promo')
assert.equal(setTypeOf('fab', 'Monarch'), 'booster')
assert.equal(setTypeOf('digimon', 'Starter Deck 25: Rubeusdramon Release Event Cards'), 'promo', 'event cards, not the deck')
assert.equal(setTypeOf('digimon', 'Starter Deck 25: Rubeusdramon'), 'starter')
assert.equal(setTypeOf('digimon', 'Limited Card Pack -Final Crest-'), 'special')
assert.equal(setTypeOf('digimon', 'Ignition of X'), 'booster')
assert.equal(setTypeOf('palworld', 'TD01: Dawn of Palpagos Red•Blue'), 'starter')
assert.equal(setTypeOf('palworld', 'BP02: Legends Awaken'), 'booster')

// ── Prices ──
assert.equal(printingKeyOf('1st Edition Rainbow Foil'), '1st:rainbow')
assert.equal(printingKeyOf('Unlimited Edition Normal'), 'unlimited:normal')
assert.equal(printingKeyOf('Cold Foil'), 'unlimited:cold')
assert.equal(printingKeyOf('Normal'), 'unlimited:normal', 'no edition (newer sets) = the one printing')
assert.equal(isFoilSubtype('Holofoil'), true)
assert.equal(isFoilSubtype('Normal'), false)
assert.deepEqual(priceFieldsOf('swu', [{ subTypeName: 'Normal', marketPrice: 0.07, lowPrice: 0.01 }, { subTypeName: 'Foil', marketPrice: 2.12, lowPrice: 1 }]),
  { marketPrice: 0.07, marketPriceFoil: 2.12, lowPriceNM: 0.01, lowPriceNMFoil: 1 })
assert.deepEqual(priceFieldsOf('gundam', [{ subTypeName: 'Holofoil', marketPrice: 6.81 }]),
  { marketPrice: 0, marketPriceFoil: 6.81, lowPriceNM: 0, lowPriceNMFoil: 0 }, 'a parallel is foil-only')
const fab = priceFieldsOf('fab', [
  { subTypeName: '1st Edition Rainbow Foil', marketPrice: 4.78 },
  { subTypeName: 'Unlimited Edition Normal', marketPrice: 0.43, lowPrice: 0.1 },
  { subTypeName: 'Unlimited Edition Rainbow Foil', marketPrice: 1.74 },
])
assert.deepEqual(fab.variantPrices, { '1st:rainbow': 4.78, 'unlimited:normal': 0.43, 'unlimited:rainbow': 1.74 })
assert.equal(fab.marketPrice, 0.43, 'default printing: Unlimited Normal')
assert.equal(fab.marketPriceFoil, 1.74)
assert.equal(priceFieldsOf('fab', [{ subTypeName: 'Cold Foil', marketPrice: 22.64 }]).marketPrice, 22.64, 'a cold-foil-only card is priced by its one printing')

// ── Products → cards ──
const rows = [
  { productId: '183145', name: 'Orbiting K-Wing (Hyperspace)', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/183145_200w.jpg', imageCount: '1', groupId: '24000', extNumber: '428', extRarity: 'Common', extCardType: 'Unit', extAspect: 'Villainy', extArenaType: 'Space', subTypeName: 'Normal', marketPrice: '0.10', lowPrice: '0.02' },
  { productId: '500', name: 'Spark of Rebellion Booster Box', imageUrl: 'x', imageCount: '1', groupId: '24000', subTypeName: 'Normal', marketPrice: '99' },
  { productId: '501', name: 'Secret Promo', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/501_200w.jpg', imageCount: '0', groupId: '24000', extRarity: 'Special', subTypeName: 'Foil', marketPrice: '' },
]
const products = productsFromRows(rows)
assert.equal(products.length, 3)
assert.equal(isSingle(products[0]), true)
assert.equal(isSingle(products[1]), false, 'sealed: no number, no rarity')
assert.equal(isSingle(products[2]), true, 'a numberless promo with a rarity is a card')
const group = { groupId: 24000, name: 'Jump to Lightspeed', abbreviation: 'JTL', publishedOn: '2025-03-14T00:00:00' }
const card = cardFromProduct('swu', products[0], group)
assert.deepEqual(card, {
  id: 'tcg-183145', name: 'Orbiting K-Wing', number: '428', set: 'JTL', setName: 'Jump to Lightspeed', rarity: 'Common',
  imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/183145_200w.jpg', tcgProductId: 183145, tcgGroupId: 24000,
  variant: 'Hyperspace', cardType: 'Unit', aspect: 'Villainy', arena: 'Space',
  marketPrice: 0.1, marketPriceFoil: 0, lowPriceNM: 0.02, lowPriceNMFoil: 0,
})
assert.equal(cardFromProduct('swu', products[2], group).imageUrl, '', 'no photo yet → empty, not a broken link')

// ── Existing cards never change what they show; prices refresh, a missing price keeps the last ──
assert.deepEqual(mergePrices('swu', { marketPrice: 1, marketPriceFoil: 5 }, { marketPrice: 2, marketPriceFoil: 0 }),
  { marketPrice: 2, marketPriceFoil: 5, lowPriceNM: 0, lowPriceNMFoil: 0 })
assert.deepEqual(mergePrices('fab', { variantPrices: { '1st:normal': 3, 'unlimited:normal': 1 } }, { variantPrices: { 'unlimited:normal': 1.5 } }).variantPrices,
  { '1st:normal': 3, 'unlimited:normal': 1.5 })

const productsByGroup = new Map([[24000, products]])
const existing = new Map([['tcg-183145', { ...card, name: 'Orbiting K-Wing (old name)', variant: undefined, imageUrl: 'https://old/photo.jpg', marketPrice: 0.5 }]])
const built = buildTcgplayerCatalog('swu', { groups: [group], productsByGroup, existing })
assert.equal(built.cards.length, 2)
assert.equal(built.report.sealed, 1)
assert.equal(built.report.existingCards, 1)
const kept = built.cards.find((c) => c.id === 'tcg-183145')
assert.equal(kept.name, 'Orbiting K-Wing (old name)', 'name kept as logged')
assert.equal(kept.variant, undefined, 'no version added to an existing card')
assert.equal(kept.imageUrl, 'https://old/photo.jpg', 'photo kept')
assert.equal(kept.marketPrice, 0.1, 'price refreshed')
assert.deepEqual(built.sets, [{ id: 'tcg-24000', code: 'JTL', name: 'Jump to Lightspeed', releaseDate: '2025-03-14', cardCount: 2, setType: 'booster', tcgplayerGroupId: 24000 }])

// A photo-less existing card picks up TCGplayer's photo once there is one
const later = buildTcgplayerCatalog('swu', {
  groups: [group], productsByGroup: new Map([[24000, productsFromRows([{ ...rows[2], imageCount: '1' }])]]),
  existing: new Map([['tcg-501', { id: 'tcg-501', name: 'Secret Promo', imageUrl: '' }]]),
})
assert.equal(later.cards[0].imageUrl, 'https://tcgplayer-cdn.tcgplayer.com/product/501_200w.jpg')

// A failed set download is skipped (its cards keep last time's data in Firestore)
assert.equal(buildTcgplayerCatalog('swu', { groups: [group], productsByGroup, failedGroupIds: new Set([24000]) }).cards.length, 0)

console.log('tcgplayer-games: all tests passed')
