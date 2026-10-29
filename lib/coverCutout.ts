// Turn a photo of a book cover on a plain light backdrop into a cut-out (staff portal → a pin
// book's cover image), cropped to the book and returned as a WebP. Art that already has
// transparency is only cropped.
//
// A book is a convex shape, so rather than flood-filling the backdrop (which also eats light,
// colourless parts of the book that touch its edge — silver corner pieces), this finds the solid
// "core" of the book (anything that isn't light and colourless) and keeps everything inside the
// convex outline around it: silver corners and pale highlights inside that outline stay, while
// the backdrop and the soft shadow outside it go.

export async function cutOutCover(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const W = bitmap.width, H = bitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  let hasAlpha = false
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) { hasAlpha = true; break }

  if (!hasAlpha) {
    const isCore = (p: number) => {
      const r = d[p * 4], g = d[p * 4 + 1], b = d[p * 4 + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      return !(mx - mn < 26 && mx > 140) // not the light, colourless backdrop or its shadow
    }
    // Outline points: per row, the first and last solid run of core pixels (runs of ≥ 8, so specks
    // of noise in the backdrop are ignored). Rows with little core are skipped.
    const pts: [number, number][] = []
    const RUN = 8
    for (let y = 0; y < H; y++) {
      let first = -1, last = -1, run = 0, count = 0
      for (let x = 0; x < W; x++) {
        if (isCore(y * W + x)) { run++; count++; if (run === RUN && first < 0) first = x - RUN + 1; if (run >= RUN) last = x } else run = 0
      }
      if (first >= 0 && count > W * 0.05) { pts.push([first, y], [last, y]) }
    }
    const hull = convexHull(pts)
    if (hull.length >= 3) {
      // Keep the inside of the outline (pulled in a pixel), clear the rest
      const mask = document.createElement('canvas')
      mask.width = W; mask.height = H
      const m = mask.getContext('2d', { willReadFrequently: true })!
      m.beginPath()
      hull.forEach(([x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y)))
      m.closePath()
      m.fill()
      const md = m.getImageData(0, 0, W, H).data
      for (let p = 0; p < W * H; p++) d[p * 4 + 3] = Math.min(d[p * 4 + 3], md[p * 4 + 3])
      ctx.putImageData(img, 0, 0)
    }
  }

  // Crop to what's left
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1 }
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t encode the cover'))), 'image/webp', 0.88))
}

// Andrew's monotone chain
function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q) }
  const upper: [number, number][] = []
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q) }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}
