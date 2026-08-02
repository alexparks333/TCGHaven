// Generates solid-color PNG icons for the PWA manifest
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dir, '..', 'public')

function crc32(buf) {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type)
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crcVal])
}

function makePNG(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)
  ihdrData.writeUInt32BE(size, 4)
  ihdrData[8] = 8; ihdrData[9] = 2 // 8-bit RGB

  // Build raw scanlines: 1 filter byte + RGB per pixel
  const row = Buffer.alloc(1 + size * 3)
  row[0] = 0 // filter None
  for (let x = 0; x < size; x++) {
    // Draw a rounded-ish violet square with a subtle card icon
    const cx = x - size / 2, cy = 0
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }

  const rows = []
  for (let y = 0; y < size; y++) {
    const scanline = Buffer.alloc(1 + size * 3)
    scanline[0] = 0
    for (let x = 0; x < size; x++) {
      // Violet background (#7c3aed)
      let pr = 0x7c, pg = 0x3a, pb = 0xed
      // Inner card shape (white rectangle, centered)
      const margin = size * 0.22
      const cardW = size * 0.56, cardH = size * 0.68
      const cx = (size - cardW) / 2, cy = (size - cardH) / 2
      if (x >= cx && x <= cx + cardW && y >= cy && y <= cy + cardH) {
        pr = 0xff; pg = 0xff; pb = 0xff
        // Card top colored band
        if (y < cy + cardH * 0.28) { pr = 0x7c; pg = 0x3a; pb = 0xed }
        // Lines on card
        const lineY = [0.42, 0.54, 0.66, 0.78]
        const lx = cx + cardW * 0.12, lw = cardW * 0.76
        for (const ly of lineY) {
          if (y >= cy + cardH * ly - 1 && y <= cy + cardH * ly + 1 && x >= lx && x <= lx + lw) {
            pr = 0xc4; pg = 0xb5; pb = 0xfd
          }
        }
      }
      scanline[1 + x * 3] = pr
      scanline[2 + x * 3] = pg
      scanline[3 + x * 3] = pb
    }
    rows.push(scanline)
  }

  const raw = Buffer.concat(rows)
  const compressed = deflateSync(raw)

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(publicDir, { recursive: true })
writeFileSync(join(publicDir, 'icon-192.png'), makePNG(192, 0x7c, 0x3a, 0xed))
writeFileSync(join(publicDir, 'icon-512.png'), makePNG(512, 0x7c, 0x3a, 0xed))
console.log('✅ Generated icon-192.png and icon-512.png')
