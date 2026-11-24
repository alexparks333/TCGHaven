// npm run test:stagnant — which catalog cards are stagnant, and the sync keeping a hand price (stagnant.mjs)
import assert from 'node:assert/strict'
import { matchHandAdded, linkedHandCard, cardNumber } from './hand-added-tcgplayer.mjs'
import { stagnantReason, keepHandPrice, hasPrice, livePriceFromPriceCharting, wantsPriceChartingPrice } from './stagnant.mjs'

// Stagnant
assert.equal(stagnantReason({ id: 'rad-178-167', marketPrice: 0 }), 'no-price')
assert.equal(stagnantReason({ id: 'ckx-ogn-303a-298', source: 'manual', marketPrice: 0 }), 'hand-added')
assert.equal(stagnantReason({ id: 'custom-x', source: 'manual', marketPrice: 50 }), 'hand-added', 'a hand-added card stays stagnant even with a price')
assert.equal(stagnantReason({ id: 'x', marketPrice: 40, priceSource: 'manual' }), 'manual')
// Not stagnant
assert.equal(stagnantReason({ id: 'x', marketPrice: 2 }), null, 'priced by its sync')
assert.equal(stagnantReason({ id: 'x', marketPriceFoil: 2 }), null)
assert.equal(stagnantReason({ id: 'x', variantPrices: { normal: 0, '1st-holo': 300 } }), null)
assert.equal(stagnantReason({ id: 'x', marketPrice: 0, priceSource: 'cardmarket' }), 'no-price')
assert.equal(stagnantReason({ id: 'x', marketPrice: 3, priceSource: 'cardmarket' }), null, 'a backup price is still automatic')
assert.equal(stagnantReason({ id: 'tcg-123456', marketPrice: 0 }), null, 'a TCGplayer product that hasn’t sold yet')
assert.equal(stagnantReason({ id: 'x', tcgProductId: 9, marketPrice: 0 }), null)
assert.equal(stagnantReason({ id: 'x', marketPrice: 5, priceSource: 'pricecharting' }), null, 'priced from PriceCharting')
assert.equal(stagnantReason({ id: 'ckx-1', source: 'manual', tcgProductId: 700001 }), null, 'a hand-added card linked to TCGplayer')
assert.equal(stagnantReason({ id: 'x', marketPrice: 0, hidden: true }), null)

// The sync keeps a hand price while it has none…
const hand = { id: 'x', marketPrice: 40, marketPriceFoil: 0, priceSource: 'manual', manualPriceNote: 'eBay' }
const fresh = { id: 'x', name: 'New name', marketPrice: 0, marketPriceFoil: 0, lowPriceNM: 0 }
assert.deepEqual(keepHandPrice(hand, fresh), { id: 'x', name: 'New name' })
// …and takes over once it has one
const priced = keepHandPrice(hand, { ...fresh, marketPrice: 55 })
assert.equal(priced.marketPrice, 55)
assert.equal(priced.priceSource, '')
assert.equal(priced.manualPriceNote, '')
// Cards not priced by hand pass straight through
assert.equal(keepHandPrice({ id: 'x', marketPrice: 3 }, fresh), fresh)
assert.equal(hasPrice({ lowPriceNM: 1 }), true)
assert.equal(hasPrice({}), false)

// PriceCharting's ungraded price — only when the sync has none
const pc = { r: 450, u: 'https://www.pricecharting.com/game/123' }
assert.deepEqual(livePriceFromPriceCharting(undefined, { id: 'x', marketPrice: 0 }, pc),
  { id: 'x', marketPrice: 450, marketPriceFoil: 0, priceSource: 'pricecharting', pcUrl: 'https://www.pricecharting.com/game/123' })
assert.equal(livePriceFromPriceCharting(undefined, { id: 'x', marketPrice: 3 }, pc).marketPrice, 3, 'TCGplayer wins')
// …TCGplayer turns up: PriceCharting steps aside
assert.deepEqual(livePriceFromPriceCharting({ priceSource: 'pricecharting' }, { id: 'x', marketPrice: 3 }, pc), { id: 'x', marketPrice: 3, priceSource: '', pcUrl: '' })
// …or PriceCharting has no price any more
assert.deepEqual(livePriceFromPriceCharting({ priceSource: 'pricecharting' }, { id: 'x', marketPrice: 0 }, undefined), { id: 'x', marketPrice: 0, priceSource: '', pcUrl: '' })
// a hand price hands over to PriceCharting's (keepHandPrice sees a price)
assert.equal(keepHandPrice(hand, livePriceFromPriceCharting(hand, fresh, pc)).priceSource, 'pricecharting')
assert.equal(wantsPriceChartingPrice({ id: 'x', marketPrice: 0 }), true)
assert.equal(wantsPriceChartingPrice({ id: 'x', marketPrice: 9, priceSource: 'pricecharting' }), true)
assert.equal(wantsPriceChartingPrice({ id: 'x', marketPrice: 9 }), false)

// Hand-added cards → their TCGplayer product
{
  const hand = [
    { id: 'ckx-sfd-025a-221', name: 'Rengar (Chinese Promo)', number: '025a', publicCode: 'SFD-025a/221', source: 'manual' },
    { id: 'ckx-ogn-303a-298', name: 'Ahri, Nine-Tailed Fox (Gumiho, Korean)', number: '303a', publicCode: 'OGN-303a/298', source: 'manual' },
    { id: 'ckx-rad-174a-167', name: 'Seraphine, Starry-Eyed Songstress (Chinese)', number: '174a', publicCode: 'RAD-174a/167', source: 'manual' },
    { id: 'linked', name: 'Jinx', number: '1', publicCode: 'OGN-001/298', source: 'manual', tcgProductId: 5 },
  ]
  const rows = [
    { productId: '800001', groupId: 24600, name: 'Rengar, Pouncing (Chinese Exclusive)', extNumber: '025a/221', marketPrice: 900 },
    { productId: '800002', groupId: 24600, name: 'Rengar, Pouncing', extNumber: '025/221', marketPrice: 1 },        // wrong number
    { productId: '800003', groupId: 24600, name: 'Ahri, Nine-Tailed Fox', extNumber: '303a/298' },                 // two Ahris…
    { productId: '800004', groupId: 24601, name: 'Ahri, Nine-Tailed Fox (Gumiho)', extNumber: '303a/298' },
    { productId: '800005', groupId: 24600, name: 'Seraphine, Starry-Eyed Songstress', extNumber: '174a/167' },     // already a catalog card
    { productId: '800006', groupId: 24600, name: 'Jinx', extNumber: '001/298' },
  ]
  const { links, suggestions } = matchHandAdded(hand, rows, new Set([800005]))
  assert.deepEqual(links, [{ cardId: 'ckx-sfd-025a-221', productId: 800001, groupId: 24600 }])
  assert.deepEqual(suggestions.map((x) => [x.cardId, x.products.map((p) => p.productId)]), [['ckx-ogn-303a-298', [800003, 800004]]])
  assert.deepEqual(cardNumber({ publicCode: 'SFD-025a/221' }), { num: '25a', of: '221' })
  assert.deepEqual(linkedHandCard({ id: 'c' }, { productId: '9', groupId: 3, marketPrice: 12, lowPrice: 10 }),
    { id: 'c', tcgProductId: 9, tcgGroupId: 3, marketPrice: 12, marketPriceFoil: 0, lowPriceNM: 10, lowPriceNMFoil: 0 })
  assert.equal(linkedHandCard({ id: 'c' }, undefined), null)
}

console.log('stagnant prices: all tests passed')
