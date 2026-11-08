// Offline tests for onepiece-tcgplayer.mjs — `npm run test:onepiece-source`.
// Every case is a real one from the 2026-11-08 source report (names, products and prices from
// TCGplayer and apitcg, trimmed to the fields the build reads).
import assert from 'node:assert/strict'
import {
  cleanOpName, productsFromRows, buildOnePieceCatalog, linkApitcgVersions, groupSetName, promoEvent,
  productIdFromImage, finishOf, versionTier,
} from './onepiece-tcgplayer.mjs'

// ── Helpers ─────────────────────────────────────────────────────────────────
const row = (groupId, productId, name, extNumber, price, subTypeName = 'Normal', extRarity = 'R') => ({
  productId: String(productId), groupId: String(groupId), name, extNumber, extRarity, subTypeName,
  marketPrice: String(price), midPrice: '', lowPrice: '',
  imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`, imageCount: '1',
})
const photo = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`
const api = (id, setName, name = 'Card', rarity = 'R') => ({ id, code: id.split('_')[0], name, rarity, set: { name: setName } })
const G = (groupId, name) => ({ groupId, name })
function build({ apiCards = [], groups, rows, existing = [], ...rest }) {
  const productsByGroup = new Map(groups.map((g) => [g.groupId, productsFromRows(rows.filter((r) => Number(r.groupId) === g.groupId))]))
  return buildOnePieceCatalog({ apiCards, groups, productsByGroup, existing: new Map(existing.map((c) => [c.id, c])), ...rest })
}
const byId = (out) => new Map(out.cards.map((c) => [c.id, c]))

// ── Names and small helpers ────────────────────────────────────────────────
assert.equal(cleanOpName('Kid & Killer - EB01-003 (SP)'), 'Kid & Killer (SP)')
assert.equal(cleanOpName('Blueno (017)'), 'Blueno')
assert.equal(cleanOpName('Tony Tony.Chopper - ST01-006 (Treasure Cup)'), 'Tony Tony.Chopper (Treasure Cup)')
assert.equal(groupSetName('ST-29: Starter Deck 29 Egghead'), 'Egghead')
assert.equal(groupSetName('ST-10: Ultra Deck The Three Captains'), 'The Three Captains')
assert.equal(groupSetName('Extra Booster: Memorial Collection'), 'Memorial Collection')
assert.equal(groupSetName('Romance Dawn'), 'Romance Dawn')
assert.equal(promoEvent({ rawName: 'Tony Tony.Chopper (3-on-3 Cup) [Winner]' }), '3-on-3 Cup', 'a [placing] is not the event')
assert.equal(promoEvent({ rawName: 'Uta (Gift Collection 2023)' }), 'Gift Collection 2023')
assert.equal(promoEvent({ rawName: 'Kaido (Alternate Art)' }), null)
assert.equal(productIdFromImage(photo(544530)), 544530)
assert.ok(versionTier('Chopper (Alternate Art)') < versionTier('Chopper (Alternate Art) (Manga)'))
assert.ok(versionTier('Chopper (Alternate Art) (Manga)') < versionTier('Chopper (SP)'))

// Sealed product and odd numbers aren't cards
assert.equal(productsFromRows([row(1, 9, 'Romance Dawn Booster Box', '', 100)]).length, 0)

// ── apitcg's version descriptions → products ────────────────────────────────
{
  const groups = { 1: 'Extra Booster: Memorial Collection', 2: 'One Piece Promotion Cards', 3: 'Premium Booster -The Best-' }
  const products = productsFromRows([
    row(1, 544530, 'Tony Tony.Chopper', 'EB01-006', 20.87),
    row(1, 544531, 'Tony Tony.Chopper (Alternate Art)', 'EB01-006', 106.74),
    row(1, 544532, 'Tony Tony.Chopper (Alternate Art) (Manga)', 'EB01-006', 2999.99),
    row(3, 587962, 'Tony Tony.Chopper (EB01-006) (Manga)', 'EB01-006', 3000),
    row(2, 590986, 'Tony Tony.Chopper (Treasure Cup 2024)', 'EB01-006', ''),
  ])
  const versions = [
    api('EB01-006', '-Memorial Collection- [EB-01]'), api('EB01-006_p1', '-Memorial Collection- [EB-01]'),
    api('EB01-006_p2', '-Memorial Collection- [EB-01]'), api('EB01-006_p3', 'Treasure Cup November-December'),
    api('EB01-006_p5', '-ONE PIECE CARD THE BEST- [PRB-01]'),
  ]
  const links = linkApitcgVersions(versions, products, (g) => groups[g])
  assert.equal(links.get('EB01-006'), 544530)
  assert.equal(links.get('EB01-006_p1'), 544531, 'Alternate Art before Manga')
  assert.equal(links.get('EB01-006_p2'), 544532)
  assert.equal(links.get('EB01-006_p3'), 590986, 'the Treasure Cup promo, not the $3,000 PRB-01 Manga')
  assert.equal(links.get('EB01-006_p5'), 587962)
}

// ── THE PROMISE: an existing card never changes what it shows ───────────────
// EB01-006_p3 says "Treasure Cup" but has shown the PRB-01 Manga photo (the old position pairing).
// It keeps that photo and that product's price; the real Treasure Cup promo is added as a new card
// and the disagreement is reported.
{
  const groups = [G(1, 'Extra Booster: Memorial Collection'), G(2, 'One Piece Promotion Cards'), G(3, 'Premium Booster -The Best-')]
  const out = build({
    apiCards: [api('EB01-006', '-Memorial Collection- [EB-01]', 'Tony Tony.Chopper', 'SR'), api('EB01-006_p3', 'Treasure Cup November-December', 'Tony Tony.Chopper', 'SR')],
    groups,
    rows: [
      row(1, 544530, 'Tony Tony.Chopper', 'EB01-006', 20.87),
      row(3, 587962, 'Tony Tony.Chopper (EB01-006) (Manga)', 'EB01-006', 3100),
      row(2, 590986, 'Tony Tony.Chopper (Treasure Cup 2024)', 'EB01-006', 410),
    ],
    existing: [
      { id: 'EB01-006', name: 'Tony Tony.Chopper', setName: 'Memorial Collection', imageUrl: photo(544530), marketPrice: 20 },
      { id: 'EB01-006_p3', name: 'Tony Tony.Chopper', setName: 'Treasure Cup November-december', imageUrl: photo(587962), marketPrice: 3000 },
    ],
  })
  const c = byId(out)
  assert.equal(c.get('EB01-006_p3').tcgProductId, 587962, 'keeps the product it shows')
  assert.equal(c.get('EB01-006_p3').marketPrice, 3100, 'priced by that product, as today')
  assert.ok(!('imageUrl' in c.get('EB01-006_p3')), 'its photo is never rewritten')
  assert.equal(c.get('EB01-006_p3').setName, 'Treasure Cup November-december', 'same set name as before')
  assert.equal(c.get('tcg-590986').marketPrice, 410, 'the real Treasure Cup promo is a new card')
  assert.equal(c.get('tcg-590986')._review, true, 'from the promo bucket → Needs Review')
  assert.equal(out.report.mismatches.length, 1)
  assert.equal(out.report.mismatches[0].id, 'EB01-006_p3')
}

// ── No TCGplayer price right now → the card keeps its last price ────────────
{
  const out = build({
    groups: [G(5, 'One Piece Promotion Cards')],
    rows: [row(5, 700001, 'Portgas.D.Ace (Large Scale Extra Grand Battle 2026)', 'OP13-002', '')],
    existing: [{ id: 'OP13-002_p4', name: 'Portgas.D.Ace (Large Scale Extra Grand Battle 2026)', setName: 'X', imageUrl: photo(700001), marketPrice: 1500 }],
  })
  const card = byId(out).get('OP13-002_p4')
  assert.ok(!('marketPrice' in card), 'no $0 overwrite')
  assert.equal(card.tcgProductId, 700001)
}

// ── A product sold in two finishes: each card keeps its own (P-066 Boa Hancock) ──
{
  const rows = [row(6, 552138, 'Boa Hancock (Sealed Battle 2024 Vol. 2)', 'P-066', 180.42, 'Foil', 'PR'), row(6, 552138, 'Boa Hancock (Sealed Battle 2024 Vol. 2)', 'P-066', 7.99, 'Normal', 'PR')]
  const existing = [
    { id: 'P-066', name: 'Boa Hancock (Sealed Battle 2024 Vol. 2)', setName: 'P', imageUrl: photo(552138), marketPrice: 175 },
    { id: 'P-066_p1', name: 'Boa Hancock (Sealed Battle 2024 Vol. 2)', setName: 'P', imageUrl: photo(552138), marketPrice: 8.5 },
  ]
  const out = build({ groups: [G(6, 'One Piece Promotion Cards')], rows, existing })
  const c = byId(out)
  assert.equal(c.get('P-066').tcgSubType, 'Foil')
  assert.equal(c.get('P-066').marketPrice, 180.42)
  assert.equal(c.get('P-066_p1').tcgSubType, 'Normal')
  assert.equal(c.get('P-066_p1').marketPrice, 7.99)
  assert.equal(out.cards.length, 2, 'no new card — both finishes are already cards')
  // …and next sync the saved finish decides, whatever the prices do
  const [p] = productsFromRows(rows)
  assert.equal(finishOf(p, { tcgSubType: 'Normal', marketPrice: 999 }), 'Normal')
}

// ── New cards: placed in the set their group's cards are in; promos by their event ──
{
  const groups = [G(10, 'Romance Dawn'), G(11, 'ST-29: Starter Deck 29 Egghead'), G(12, 'One Piece Promotion Cards'), G(13, 'Romance Dawn Pre-Release Cards')]
  const out = build({
    apiCards: [api('OP01-001', '-ROMANCE DAWN- [OP01]', 'Roronoa Zoro', 'L')],
    groups,
    rows: [
      row(10, 1, 'Roronoa Zoro', 'OP01-001', 1),
      row(10, 2, 'Roronoa Zoro (Alternate Art)', 'OP01-001', 30),
      row(11, 3, 'Franky', 'ST29-002', 0.2),
      row(12, 4, 'Roronoa Zoro (Winner Pack 2025 Vol. 1) [Winner]', 'OP01-001', 12),
      row(13, 5, 'Roronoa Zoro (Pre-Release)', 'OP01-001', 4),
    ],
    existing: [{ id: 'OP01-001', name: 'Roronoa Zoro', setName: 'Romance Dawn', imageUrl: photo(1), marketPrice: 1 }],
  })
  const c = byId(out)
  assert.equal(c.get('tcg-2').setName, 'Romance Dawn', 'joins its booster')
  assert.ok(!c.get('tcg-2')._review, 'booster cards are never reviewed')
  assert.equal(c.get('tcg-3').setName, 'Egghead')
  assert.equal(c.get('tcg-4').setName, 'Winner Pack 2025 Vol. 1')
  assert.equal(c.get('tcg-4')._review, true)
  assert.equal(c.get('tcg-5')._review, true, 'Pre-Release bucket → review')
  assert.equal(out.setCodesBySetName['Egghead'], 'ST29', 'a numbered product set keeps its code (Cardex)')
  assert.equal(out.setCodesBySetName['Winner Pack 2025 Vol. 1'], null)
}

// ── apitcg catches up on a version that's already a card → nothing new ─────
{
  const out = build({
    apiCards: [api('OP13-118', '-THE AZURE SEA- [OP13]', 'Monkey.D.Luffy', 'SEC')],
    groups: [G(20, "The Azure Sea's Seven")],
    rows: [row(20, 800001, 'Monkey.D.Luffy', 'OP13-118', 50)],
    existing: [{ id: 'OP13-118_p1', name: 'Monkey.D.Luffy', setName: "The Azure Sea's Seven", imageUrl: photo(800001), marketPrice: 45 }],
  })
  assert.ok(!byId(out).has('OP13-118'))
  assert.equal(out.report.apitcgAlreadyCards.length, 1)
  assert.equal(out.cards.length, 1)
}

// ── A link saved by an earlier sync is final ──────────────────────────────
{
  const out = build({
    groups: [G(21, 'Romance Dawn')],
    rows: [row(21, 1, 'Uta', 'OP01-005', 0.3), row(21, 2, 'Uta (Alternate Art)', 'OP01-005', 9)],
    existing: [{ id: 'OP01-005_p1', name: 'Uta', setName: 'Romance Dawn', imageUrl: photo(1), tcgProductId: 2, marketPrice: 8 }],
  })
  assert.equal(byId(out).get('OP01-005_p1').marketPrice, 9)
  assert.equal(byId(out).get('tcg-1').name, 'Uta', 'the unclaimed plain card is added')
}

// ── A group whose CSV failed: its cards stay as they are, nothing new from it ──
{
  const out = build({
    groups: [G(30, 'Romance Dawn')],
    rows: [row(30, 1, 'Uta', 'OP01-005', 0.3), row(30, 2, 'Uta (Alternate Art)', 'OP01-005', 9)],
    existing: [{ id: 'OP01-005', name: 'Uta', setName: 'Romance Dawn', imageUrl: photo(1), marketPrice: 0.25 }],
    failedGroupIds: new Set([30]),
  })
  assert.equal(out.cards.length, 0)
}

console.log('onepiece-tcgplayer: all tests passed')
