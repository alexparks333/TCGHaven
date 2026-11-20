// Builds public/logo-anim.webp (the loading screen's animated logo) from the After Effects PNG render.
//   node scripts/logo-animation.mjs "<folder with 'TCGHaven Animation00.png'…>"
// Plays forward, holds, plays back (the render isn't a seamless loop), 30 fps, alpha kept.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const dir = process.argv[2]
if (!dir) { console.error('Pass the folder holding the PNG frames.'); process.exit(1) }
const files = fs.readdirSync(dir).filter((f) => /^TCGHaven Animation\d+\.png$/.test(f)).sort()
const SIZE = 240, FRAME = 33, HOLD_END = 500, HOLD_START = 300
const frames = await Promise.all(files.map((f) => sharp(path.join(dir, f)).resize(SIZE, SIZE).png().toBuffer()))
const order = [...frames.keys(), ...[...frames.keys()].reverse().slice(1, -1)]
const delay = order.map((i, n) => (n === frames.length - 1 ? HOLD_END : i === 0 ? HOLD_START : FRAME))
await sharp(order.map((i) => frames[i]), { join: { animated: true } })
  .webp({ loop: 0, delay, quality: 68, alphaQuality: 80, effort: 6 })
  .toFile('public/logo-anim.webp')
console.log(`${files.length} frames → ${order.length} in the loop, ${(fs.statSync('public/logo-anim.webp').size / 1024).toFixed(0)} KB`)

// Frame strips (all frames side by side) for animations the page steers itself (app/globals.css
// .logo-sprite): the sidebar logo's hover (backwards then forwards) and the phone intro (SplashIntro).
// public/logo-splash.webp: the phone splash's big logo (SplashIntro), 720px frames — sharp on a 3×
// screen at ~18rem, ~1.3MB (quality 66). A GRID of 7 columns (not one strip): a 15,120px-wide strip
// is past what an iPhone keeps as one image, and the splash hitched at the same frame every time.
// Its frames sit on the splash's tan (#d9c6a0, not see-through), so the splash can blend each frame
// into the next; the tan comes out within 1/255 of the page's. The other two stay single, see-through rows.
const TAN = { r: 0xd9, g: 0xc6, b: 0xa0 }
for (const [file, size, quality, cols, flat] of [['public/logo-sprite-sm.webp', 144, 74, 0, false], ['public/logo-sprite.webp', 240, 74, 0, false], ['public/logo-splash.webp', 720, 70, 7, true]]) {
  const cells = await Promise.all(files.map((f) => {
    const img = sharp(path.join(dir, f)).resize(size, size)
    return (flat ? img.flatten({ background: TAN }) : img).png().toBuffer()
  }))
  const perRow = cols || cells.length, rows = Math.ceil(cells.length / perRow)
  await sharp({ create: { width: size * perRow, height: size * rows, channels: flat ? 3 : 4, background: flat ? TAN : { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells.map((input, i) => ({ input, left: (i % perRow) * size, top: Math.floor(i / perRow) * size })))
    .webp(flat ? { quality, effort: 6, smartSubsample: true } : { quality, alphaQuality: 85, effort: 6 })
    .toFile(file)
  console.log(`${file}: ${cells.length} frames at ${size}px (${perRow}×${rows}), ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}
