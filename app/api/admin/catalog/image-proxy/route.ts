import { NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 10 * 1024 * 1024 // 10MB — generous over the 8MB upload cap elsewhere

// Lets the admin re-crop a card's already-set image (Admin Catalog's "Resize image" button,
// EditCardForm) without re-uploading a file. The crop tool draws the photo onto a <canvas> to
// let the admin pan/zoom it, but `ctx.drawImage()` of a cross-origin <img> taints the canvas
// unless the image response carries an Access-Control-Allow-Origin header — which none of this
// app's real image sources do (Firebase Storage's own getDownloadURL() response has none, easily
// confirmed with `curl -I`; TCGPlayer/lorcast/the official galleries don't either). Fetching the
// bytes server-side and re-serving them from this app's own origin sidesteps that entirely — the
// browser sees a same-origin response, so the canvas is never tainted. Admin-gated for the same
// reason admin/catalog/lookup is: it proxies a live fetch to an arbitrary URL on the caller's
// behalf, which would otherwise be a free SSRF/fetch proxy for anyone who found the route.
export async function GET(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized

  const url = new URL(request.url).searchParams.get('url') || ''
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid or missing url' }, { status: 400 })
  }
  if (target.protocol !== 'https:') {
    return NextResponse.json({ error: 'Only https:// image URLs are supported' }, { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(target.toString())
  } catch (err) {
    return NextResponse.json({ error: `Fetch failed: ${(err as Error).message}` }, { status: 502 })
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 })
  }
  const contentType = upstream.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: `Upstream did not return an image (got "${contentType}")` }, { status: 415 })
  }
  const buf = await upstream.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Image too large to re-crop' }, { status: 413 })
  }

  return new NextResponse(buf, { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } })
}
