import assert from 'node:assert/strict'
import { applyRarityOverride, rarityPatch, applySetOverride, setPatch, applyHandOverrides } from './rarity-override.mjs'

// sync: no override → the sync's card unchanged
assert.deepEqual(applyRarityOverride({ rarity: 'Rare' }, { id: 'a', rarity: 'Epic' }), { id: 'a', rarity: 'Epic' })
assert.deepEqual(applyRarityOverride(undefined, { id: 'a', rarity: 'Epic' }), { id: 'a', rarity: 'Epic' })
// sync: an override survives, and the sync's latest rarity is noted
assert.deepEqual(
  applyRarityOverride({ rarity: 'Rune', rarityOverride: 'Rune', rarityAuto: 'Showcase' }, { id: 'a', rarity: 'Epic' }),
  { id: 'a', rarity: 'Rune', rarityOverride: 'Rune', rarityAuto: 'Epic' },
)
// sync: a source card without a rarity keeps the noted one
assert.equal(applyRarityOverride({ rarityOverride: 'Rune', rarityAuto: 'Showcase' }, { id: 'a' }).rarityAuto, 'Showcase')

// staff: first move remembers the automatic rarity
assert.deepEqual(rarityPatch({ rarity: 'Showcase' }, 'Rune'), { rarity: 'Rune', rarityOverride: 'Rune', rarityAuto: 'Showcase' })
// staff: a second move keeps the original automatic rarity
assert.deepEqual(rarityPatch({ rarity: 'Rune', rarityOverride: 'Rune', rarityAuto: 'Showcase' }, 'Epic'), { rarity: 'Epic', rarityOverride: 'Epic', rarityAuto: 'Showcase' })
// staff: moving back to the automatic rarity clears the override
assert.deepEqual(rarityPatch({ rarity: 'Rune', rarityOverride: 'Rune', rarityAuto: 'Showcase' }, 'Showcase'), { rarity: 'Showcase', rarityOverride: null, rarityAuto: null })

// ── sets ──
// sync: no set override → unchanged
assert.deepEqual(applySetOverride({ setName: 'Spiritforged' }, { id: 'r', setName: 'Spiritforged', setCode: 'SFD' }), { id: 'r', setName: 'Spiritforged', setCode: 'SFD' })
// sync: the override wins, the sync's set noted
assert.deepEqual(
  applySetOverride({ setOverride: { setName: 'Unleashed', setCode: 'UNL' } }, { id: 'r', setName: 'Spiritforged', setCode: 'SFD', rarity: 'Promo' }),
  { id: 'r', setName: 'Unleashed', setCode: 'UNL', rarity: 'Promo', setOverride: { setName: 'Unleashed', setCode: 'UNL' }, setAuto: { setName: 'Spiritforged', setCode: 'SFD' } },
)
// staff: a move remembers where the sync had it; moving back clears it
assert.deepEqual(setPatch({ setName: 'Spiritforged', setCode: 'SFD' }, { setName: 'Unleashed', setCode: 'UNL' }),
  { setName: 'Unleashed', setCode: 'UNL', setOverride: { setName: 'Unleashed', setCode: 'UNL' }, setAuto: { setName: 'Spiritforged', setCode: 'SFD' } })
assert.deepEqual(setPatch({ setName: 'Unleashed', setCode: 'UNL', setOverride: { setName: 'Unleashed', setCode: 'UNL' }, setAuto: { setName: 'Spiritforged', setCode: 'SFD' } }, { setName: 'Spiritforged', setCode: 'SFD' }),
  { setName: 'Spiritforged', setCode: 'SFD', setOverride: null, setAuto: null })
// other games' set code field is `set`
assert.equal(applySetOverride({ setOverride: { setName: 'B', set: 'b1' } }, { id: 'x', setName: 'A', set: 'a1' }).set, 'b1')
// both at once
const both = applyHandOverrides({ rarityOverride: 'Rune', setOverride: { setName: 'Unleashed', setCode: 'UNL' } }, { id: 'r', rarity: 'Promo', setName: 'Spiritforged', setCode: 'SFD' })
assert.equal(both.rarity, 'Rune'); assert.equal(both.setName, 'Unleashed')

console.log('rarity-override: all tests passed')
