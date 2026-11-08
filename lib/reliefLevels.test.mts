// node --experimental-strip-types lib/reliefLevels.test.mts
// A tilted plate (depth rising toward the bottom, the way depth models see most pins) with two
// identical raised squares, one near the top and one near the bottom. Ranked by median depth over
// the pin, the bottom square sits higher than the top one (the tilt); ranked by borders, the two
// match and both stand above the plate.
import assert from 'node:assert/strict'
import { pieceHeights } from './reliefLevels.ts'

const size = 256
const n = size * size
const layers = new Float32Array(n), detail = new Float32Array(n), pieces = new Int32Array(n)
const inSquare = (x: number, y: number, y0: number) => x >= 96 && x < 160 && y >= y0 && y < y0 + 48
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = y * size + x
    if (x < 16 || x >= 240 || y < 16 || y >= 240) continue // outside the pin
    const tilt = 0.6 * (y / size)
    const top = inSquare(x, y, 40), bottom = inSquare(x, y, 168)
    pieces[i] = top ? 2 : bottom ? 3 : 1
    layers[i] = tilt + (top || bottom ? 0.15 : 0)
    detail[i] = top || bottom ? 0.5 : 0
  }
}
const h = pieceHeights({ size, layers, detail, pieces, pieceCount: 3 })

// the old rule, for contrast: the bottom square's median depth is well above the top one's
const medianOf = (p: number) => { const v: number[] = []; for (let i = 0; i < n; i++) if (pieces[i] === p) v.push(layers[i]); v.sort((a, b) => a - b); return v[v.length >> 1] }
assert.ok(medianOf(3) - medianOf(2) > 0.25, 'the test plate should be tilted')

assert.ok(h[2] > h[1] && h[3] > h[1], `both squares stand above the plate (${h[1].toFixed(3)} / ${h[2].toFixed(3)} / ${h[3].toFixed(3)})`)
// the two squares are ranked by spread, so ties still land a rank apart; their values stay close
// together compared with the step down to the plate
assert.ok(Math.abs(h[3] - h[2]) < 0.5 * (Math.min(h[2], h[3]) - h[1]), `the squares match (${h[2].toFixed(3)} vs ${h[3].toFixed(3)})`)
assert.equal(h[0], 0)
for (const v of h) assert.ok(v >= 0 && v <= 1)

// with no detail at all, the depth alone still finds the steps
const h2 = pieceHeights({ size, layers, detail: new Float32Array(n), pieces, pieceCount: 3 })
assert.ok(h2[2] > h2[1] && h2[3] > h2[1], 'depth alone: both squares above the plate')

// a single piece (nothing to compare) doesn't fail
const one = new Int32Array(n).fill(1)
assert.equal(pieceHeights({ size, layers, detail, pieces: one, pieceCount: 1 }).length, 2)

console.log('reliefLevels: ok', Array.from(h).map((v) => v.toFixed(3)).join(' '))
