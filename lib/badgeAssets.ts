// A badge file's URL as the app should load it: uploaded files (Firebase Storage) go through this
// site's /api/badge-asset so WebGL, 3D-model loads and CSS masks can read them (see that route).
// Anything else (e.g. a file in /public) is used as-is.
export function badgeAsset(url: string | undefined): string | undefined {
  if (!url) return url
  return url.startsWith('https://firebasestorage.googleapis.com/') ? `/api/badge-asset?u=${encodeURIComponent(url)}` : url
}
