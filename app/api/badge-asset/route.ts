import { NextResponse } from 'next/server'

// Serves a badge's uploaded files (pin art, 3D model, normal map — uploaded from the staff portal's
// Badges page to Firebase Storage under badges/) from this site's own origin. WebGL textures, 3D
// model loads and CSS masks all need same-origin (or CORS) files, and the Storage bucket doesn't
// send CORS headers by default. Only our bucket's badges/ folder is ever fetched.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('u') ?? ''
  let target: URL
  try { target = new URL(raw) } catch { return NextResponse.json({ error: 'Bad url' }, { status: 400 }) }
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? ''
  const ok = target.protocol === 'https:'
    && target.hostname === 'firebasestorage.googleapis.com'
    && target.pathname.startsWith(`/v0/b/${bucket}/o/badges%2F`)
  if (!ok) return NextResponse.json({ error: 'Not a badge file' }, { status: 400 })

  const res = await fetch(target, { cache: 'no-store' })
  if (!res.ok || !res.body) return NextResponse.json({ error: `Fetch failed (${res.status})` }, { status: 502 })
  return new NextResponse(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      // Lets the 3D viewer show real download progress
      ...(res.headers.get('content-length') ? { 'Content-Length': res.headers.get('content-length')! } : {}),
      // Each upload gets a new file name (and token), so a URL's content never changes.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
