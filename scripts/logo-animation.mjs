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
// .logo-sprite): the sidebar logo's hover (backwards then forwards) and the Sign In / Sign Up logo.
for (const [file, size] of [['public/logo-sprite-sm.webp', 144], ['public/logo-sprite.webp', 240]]) {
  const cells = await Promise.all(files.map((f) => sharp(path.join(dir, f)).resize(size, size).png().toBuffer()))
  await sharp({ create: { width: size * cells.length, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells.map((input, i) => ({ input, left: i * size, top: 0 })))
    .webp({ quality: 74, alphaQuality: 85, effort: 6 })
    .toFile(file)
  console.log(`${file}: ${cells.length} frames at ${size}px, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}

// public/splash/frame-NN.webp: the phone splash's big logo (SplashIntro), one 720px picture per
// frame — sharp on a 3× screen at ~18rem, ~1.1MB in all. Separate pictures, not one sheet: a slice
// of a sheet has to be cut out and drawn the first time it shows, mid-animation (the splash lagged,
// 2026-11-20); a plain decoded picture goes on screen as it is. On the splash's tan (#d9c6a0, not
// see-through) so each frame can blend into the next; the tan comes out within 1/255 of the page's.
const TAN = { r: 0xd9, g: 0xc6, b: 0xa0 }
fs.mkdirSync('public/splash', { recursive: true })
let splashBytes = 0
for (const [i, f] of files.entries()) {
  const out = `public/splash/frame-${String(i).padStart(2, '0')}.webp`
  await sharp(path.join(dir, f)).resize(720, 720).flatten({ background: TAN }).webp({ quality: 70, effort: 6, smartSubsample: true }).toFile(out)
  splashBytes += fs.statSync(out).size
}
console.log(`public/splash: ${files.length} frames at 720px, ${(splashBytes / 1024).toFixed(0)} KB`)

// public/logo-card-back.webp: the zoom view's card back (CardexPage) — the last frame, grey, 720px
await sharp(path.join(dir, files[files.length - 1])).resize(720, 720).grayscale().webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile('public/logo-card-back.webp')
