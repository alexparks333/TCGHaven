'use client'

import { useEffect, useState } from 'react'
import { badgeArt, badgeAsset } from '@/lib/badgeAssets'

// Pin art cropped to the pin itself. Uploaded art is usually a big square with the pin somewhere
// inside a transparent margin — some wide, some narrow — and drawn whole into a slot, every pin
// came out a different size (the margin, not the pin, filled the slot). Cropped to its visible
// pixels, every pin fills its slot at 100% Display size. Made once per picture in the browser
// (cached for the session), as a smaller image: pins on a page are a few hundred pixels at most.

export interface TrimmedArt { src: string; aspect: number } // aspect = height / width of the cropped pin

const MAX = 1024 // the cropped image's longer side
const made = new Map<string, TrimmedArt>()
const making = new Map<string, Promise<TrimmedArt>>()

// `fallback`: the full picture, tried if the resized one can't be made (say, the image optimizer
// is unavailable on this host).
function trim(src: string, fallback?: string): Promise<TrimmedArt> {
  let p = making.get(src)
  if (p) return p
  p = new Promise<TrimmedArt>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => {
      if (fallback && fallback !== src) trim(fallback).then(resolve, reject)
      else reject(new Error('couldn’t load the pin art'))
    }
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight
      // find the visible pixels on a small copy (fast), then crop the full picture
      const k = Math.min(1, 512 / Math.max(W, H))
      const sw = Math.max(1, Math.round(W * k)), sh = Math.max(1, Math.round(H * k))
      const probe = document.createElement('canvas')
      probe.width = sw; probe.height = sh
      const pctx = probe.getContext('2d', { willReadFrequently: true })!
      pctx.drawImage(img, 0, 0, sw, sh)
      const a = pctx.getImageData(0, 0, sw, sh).data
      let x0 = sw, y0 = sh, x1 = -1, y1 = -1
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        if (a[(y * sw + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      }
      if (x1 < 0 || (x0 <= 1 && y0 <= 1 && x1 >= sw - 2 && y1 >= sh - 2)) return resolve({ src, aspect: H / W }) // nothing to crop
      // back to the full picture's pixels, a pixel of slack all round
      const cx = Math.max(0, Math.floor((x0 - 1) / k)), cy = Math.max(0, Math.floor((y0 - 1) / k))
      const cw = Math.min(W, Math.ceil((x1 + 2) / k)) - cx, ch = Math.min(H, Math.ceil((y1 + 2) / k)) - cy
      const s = Math.min(1, MAX / Math.max(cw, ch))
      const out = document.createElement('canvas')
      out.width = Math.round(cw * s); out.height = Math.round(ch * s)
      out.getContext('2d')!.drawImage(img, cx, cy, cw, ch, 0, 0, out.width, out.height)
      out.toBlob((b) => (b ? resolve({ src: URL.createObjectURL(b), aspect: ch / cw }) : resolve({ src, aspect: H / W })), 'image/png')
    }
    img.src = src
  })
  p.then((t) => made.set(src, t)).catch(() => making.delete(src))
  making.set(src, p)
  return p
}

/** A badge's art cropped to the pin (TrimmedArt), or null for none. Until it's ready: the art as
 *  it is (aspect unknown → square), then the cropped version once made. */
export function useTrimmedArt(imageUrl?: string): TrimmedArt | null {
  // The resized art (badgeArt): MAX px is plenty for a page, and it's a fraction of the download.
  const src = imageUrl ? badgeArt(imageUrl) : undefined
  const [, redraw] = useState(0)
  useEffect(() => {
    if (src && !made.has(src)) trim(src, badgeAsset(imageUrl)).then(() => redraw((n) => n + 1)).catch(() => {})
  }, [src, imageUrl])
  if (!src) return null
  return made.get(src) ?? { src, aspect: 1 }
}
