import { NextResponse } from 'next/server'

// Serves a badge's uploaded files (pin art, 3D model, normal map — uploaded from the staff portal's
// Badges page to Firebase Storage under badges/) from this site's own origin. WebGL textures, 3D
// model loads and CSS masks all need same-origin (or CORS) files, and the Storage bucket doesn't
// send CORS headers by default. Only our bucket's badges/ and creators/ (Creator Books) folders are
// ever fetched.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('u') ?? ''
  let target: URL
  try { target = new URL(raw) } catch { return NextResponse.json({ error: 'Bad url' }, { status: 400 }) }
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? ''
  const ok = target.protocol === 'https:'
    && target.hostname === 'firebasestorage.googleapis.com'
    && (target.pathname.startsWith(`/v0/b/${bucket}/o/badges%2F`) || target.pathname.startsWith(`/v0/b/${bucket}/o/creators%2F`))
  if (!ok) return NextResponse.json({ error: 'Not a badge file' }, { status: 400 })

  const res = await fetch(target, { cache: 'no-store' })
  if (!res.ok || !res.body) return NextResponse.json({ error: `Fetch failed (${res.status})` }, { status: 502 })
  // These files are uploaded by Creators, and this route serves them from OUR origin — so anything a
  // browser would run (HTML, SVG, XML, scripts) must never be served as itself: that would be script on
  // tcghaven.org, able to read the viewer's sign-in. Only the kinds badges really use pass through
  // (pictures, 3D models, JSON/binary kit data); anything else goes out as an inert download. The sandbox
  // CSP + nosniff stop a browser running it even if it's opened directly.
  const type = (res.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim()
  const safe = /^(image\/(png|jpe?g|webp|gif|avif)|model\/[a-z0-9.+-]+|application\/(octet-stream|json))$/.test(type)
  return new NextResponse(res.body, {
    headers: {
      'Content-Type': safe ? type : 'application/octet-stream',
      ...(safe ? {} : { 'Content-Disposition': 'attachment' }),
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      // Lets the 3D viewer show real download progress
      ...(res.headers.get('content-length') ? { 'Content-Length': res.headers.get('content-length')! } : {}),
      // Each upload gets a new file name (and token), so a URL's content never changes. s-maxage
      // lets Vercel's CDN keep it too (max-age alone is browser-only): after the first request in
      // a region, a file is served from the CDN without running this function or downloading it
      // from Storage again.
      'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
    },
  })
}
