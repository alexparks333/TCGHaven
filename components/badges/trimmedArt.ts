'use client'

import { useEffect, useState } from 'react'
import { badgeArt, badgeAsset } from '@/lib/badgeAssets'

// Pin art made square for its slot. Square art is drawn exactly as uploaded — the pin where the
// artist put it in the square, margin and all (Display size evens out sizes). Anything else is
// centred in a square. (Until 2026-11-14 it was cropped to its visible pixels, which re-centred
// every pin and threw the artist's framing away.) Made once per picture in the browser
// (cached for the session), as a smaller image: pins on a page are a few hundred pixels at most.
// The cropped image is also kept on the device (Cache Storage), so later visits skip the download
// and the crop; and a book's art is made ahead of time (preloadTrimmedArt) — from the shelf, its
// pins are ready by the time it opens.

export interface TrimmedArt { src: string; aspect: number } // aspect = height / width of the cropped pin

const MAX = 1024 // the cropped image's longer side
const made = new Map<string, TrimmedArt>()
const making = new Map<string, Promise<TrimmedArt>>()
const CACHE = 'tcghaven-pin-art-v2' // bump to drop every device's copies (v2, 2026-11-14: square art kept as uploaded, not cropped)

async function fromCache(src: string): Promise<TrimmedArt | null> {
  try {
    if (typeof caches === 'undefined') return null
    const hit = await (await caches.open(CACHE)).match(src)
    if (!hit) return null
    const aspect = Number(hit.headers.get('x-aspect'))
    return aspect > 0 ? { src: URL.createObjectURL(await hit.blob()), aspect } : null
  } catch { return null } // blocked (private window) — just make it
}

function toCache(src: string, blob: Blob, aspect: number) {
  if (typeof caches === 'undefined') return
  caches.open(CACHE)
    .then((c) => c.put(src, new Response(blob, { headers: { 'content-type': blob.type || 'image/png', 'x-aspect': String(aspect) } })))
    .catch(() => {}) // full or blocked — it's made again next time
}

// `fallback`: the full picture, tried if the resized one can't be made (say, the image optimizer
// is unavailable on this host).
function trim(src: string, fallback?: string): Promise<TrimmedArt> {
  let p = making.get(src)
  if (p) return p
  p = fromCache(src).then((hit) => hit ?? crop(src, fallback))
  p.then((t) => made.set(src, t)).catch(() => making.delete(src))
  making.set(src, p)
  return p
}

function crop(src: string, fallback?: string): Promise<TrimmedArt> {
  return new Promise<TrimmedArt>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => {
      if (fallback && fallback !== src) trim(fallback).then(resolve, reject)
      else reject(new Error('couldn’t load the pin art'))
    }
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight
      // Square art (within 1%) is drawn exactly as uploaded — where the pin sits in the square is the
      // artist's framing, kept (it used to be cropped to its visible pixels, which re-centred it)
      if (Math.abs(W - H) <= Math.max(W, H) * 0.01) return resolve({ src, aspect: 1 })
      // Anything else is centred in a square (the whole picture, its longer side across it)
      const side = Math.max(W, H), s = Math.min(1, MAX / side)
      const out = document.createElement('canvas')
      out.width = out.height = Math.round(side * s)
      out.getContext('2d')!.drawImage(img, Math.round(((side - W) / 2) * s), Math.round(((side - H) / 2) * s), Math.round(W * s), Math.round(H * s))
      out.toBlob((b) => {
        if (!b) return resolve({ src, aspect: H / W })
        toCache(src, b, 1)
        resolve({ src: URL.createObjectURL(b), aspect: 1 })
      }, 'image/png')
    }
    img.src = src
  })
}

// Art made ahead of time, a few at a time (each is a download and a crop on the main thread)
const queue: { src: string; fallback?: string }[] = []
let running = 0
function pump() {
  while (running < 3 && queue.length) {
    const { src, fallback } = queue.shift()!
    if (made.has(src) || making.has(src)) continue
    running++
    trim(src, fallback).catch(() => {}).finally(() => { running--; pump() })
  }
}

/** Start making these badges' art now (before their pins are drawn). `first`: ahead of anything
 *  already waiting — the book about to open. */
export function preloadTrimmedArt(imageUrls: (string | undefined)[], first = false) {
  const items = imageUrls.filter((u): u is string => !!u).map((u) => ({ src: badgeArt(u)!, fallback: badgeAsset(u) }))
    .filter((it) => !made.has(it.src) && !making.has(it.src))
  for (const it of items) {
    const i = queue.findIndex((q) => q.src === it.src)
    if (i >= 0) queue.splice(i, 1)
  }
  if (first) queue.unshift(...items)
  else queue.push(...items)
  pump()
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
