// Pin art on a plain white background → the same art with the white cut away (a see-through PNG).
// Used by the 3D pin (components/badges/pinRelief.ts) and by the Creator Studio's upload
// (BadgeMaker), so creators can upload art on white OR already cut out — the flat pin in the book,
// the shelf and the cover emblem draw the uploaded picture as is, so the cut happens once at upload.

/** True if the picture already has see-through pixels (sampled — fast) */
export function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4 * 97) if (rgba[i] < 250) return true
  return false
}

// Background removal for art on white: flood-fill near-white from the borders to transparent.
// Only white touching the edge goes, so white inside the pin (eyes, highlights) stays.
export function whiteToAlpha(ctx: CanvasRenderingContext2D) {
  const { width: w, height: h } = ctx.canvas
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const isBg = (i: number) => {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    return mn > 225 && mx - mn < 22
  }
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x) }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1) }
  while (stack.length) {
    const p = stack.pop()!
    if (seen[p] || !isBg(p * 4)) continue
    seen[p] = 1
    d[p * 4 + 3] = 0
    const x = p % w, y = (p / w) | 0
    if (x > 0) stack.push(p - 1)
    if (x < w - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - w)
    if (y < h - 1) stack.push(p + w)
  }
  ctx.putImageData(img, 0, 0)
}

/** An uploaded picture, ready to be pin art: already see-through → returned untouched; on white (or
 *  a JPG) → a PNG with the white around the pin cut away. `cut` says which happened. A picture
 *  whose edges aren't white comes back untouched too (nothing to cut — `cut: false`). */
export async function cutOutWhite(file: Blob): Promise<{ blob: Blob; cut: boolean }> {
  const bmp = await createImageBitmap(file)
  try {
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0)
    if (hasTransparency(ctx.getImageData(0, 0, c.width, c.height).data)) return { blob: file, cut: false }
    whiteToAlpha(ctx)
    if (!hasTransparency(ctx.getImageData(0, 0, c.width, c.height).data)) return { blob: file, cut: false }
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    return blob ? { blob, cut: true } : { blob: file, cut: false }
  } finally { bmp.close() }
}
