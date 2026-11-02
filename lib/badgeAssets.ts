// A badge file's URL as the app should load it: uploaded files (Firebase Storage) go through this
// site's /api/badge-asset so WebGL, 3D-model loads and CSS masks can read them (see that route).
// Anything else (e.g. a file in /public) is used as-is.
export function badgeAsset(url: string | undefined): string | undefined {
  if (!url) return url
  return url.startsWith('https://firebasestorage.googleapis.com/') ? `/api/badge-asset?u=${encodeURIComponent(url)}` : url
}

/** Pin art for the books and shelves — through Next's image optimizer (same origin, so canvas can
 *  read it; resized to `width` and re-encoded as WebP/AVIF, cached by Vercel's CDN): ~1MB PNGs
 *  become tens of KB. The 3D view keeps using badgeAsset() for the full picture. */
export function badgeArt(url: string | undefined, width = 1080): string | undefined {
  if (!url || !url.startsWith('https://firebasestorage.googleapis.com/')) return badgeAsset(url)
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=85`
}
