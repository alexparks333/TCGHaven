import assert from 'node:assert/strict'
import { applyRarityOverride, rarityPatch } from './rarity-override.mjs'

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

console.log('rarity-override: all tests passed')
