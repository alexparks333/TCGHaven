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
// screen at ~18rem, ~1.3MB (quality 66 keeps it there; the other two stay small for their small spots)
for (const [file, size, quality] of [['public/logo-sprite-sm.webp', 144, 74], ['public/logo-sprite.webp', 240, 74], ['public/logo-splash.webp', 720, 66]]) {
  const cells = await Promise.all(files.map((f) => sharp(path.join(dir, f)).resize(size, size).png().toBuffer()))
  await sharp({ create: { width: size * cells.length, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells.map((input, i) => ({ input, left: i * size, top: 0 })))
    .webp({ quality, alphaQuality: 85, effort: 6 })
    .toFile(file)
  console.log(`${file}: ${cells.length} frames at ${size}px, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}
