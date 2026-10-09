import { NextResponse } from 'next/server'
import { ADMIN_UID } from './config'

// Every route that performs an admin-only write (the registry, cache invalidation, the per-game
// catalog syncs) used to trust ANY caller who knew the URL — ensureAdminAuth() only signs the
// *server process* in as the admin bot account so the Firestore write itself is allowed; it
// never checked who actually sent the request. This closes that gap by verifying the caller's
// own Firebase ID token (sent as `Authorization: Bearer <token>` — the browser already has one
// from being signed in, see lib/firebase/authFetch.ts) against Firebase's Identity Toolkit REST
// API, matching this codebase's existing "no firebase-admin SDK / no service account" pattern
// (see adminAuth.ts's header comment) rather than adding one just for this check.
//
// Returns an error NextResponse to send back immediately, or null if the caller is verified as
// the admin — callers do `const unauthorized = await verifyAdminRequest(request); if
// (unauthorized) return unauthorized`.
// Tokens this server process has already verified, so a page making several signed-in requests
// doesn't pay Google's lookup round trip (~200-300ms) on every one. Short TTL (well inside a
// Firebase ID token's own 1-hour life) and bounded size.
const VERIFIED_TTL_MS = 5 * 60 * 1000
const verified = new Map<string, { uid: string; at: number }>()

// Verifies the caller's Firebase ID token and returns their uid, or null if missing/invalid.
async function callerUid(request: Request): Promise<string | null> {
  const authHeader = request.headers.get('authorization') || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  if (!idToken || !apiKey) return null
  const hit = verified.get(idToken)
  if (hit && Date.now() - hit.at < VERIFIED_TTL_MS) return hit.uid
  const uid = await lookupUid(idToken, apiKey)
  if (uid) {
    if (verified.size > 500) verified.clear()
    verified.set(idToken, { uid, at: Date.now() })
  }
  return uid
}

async function lookupUid(idToken: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.users?.[0]?.localId ?? null
  } catch {
    return null
  }
}

export async function verifyAdminRequest(request: Request): Promise<NextResponse | null> {
  if (!ADMIN_UID) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const uid = await callerUid(request)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (uid !== ADMIN_UID) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

// Same check, but any signed-in user passes — for routes that aren't admin-only but call a
// paid/rate-limited outside API on the caller's behalf (e.g. the eBay price lookup), so an
// anonymous visitor can't burn that quota just by finding the URL.
export async function verifyUserRequest(request: Request): Promise<NextResponse | null> {
  return (await callerUid(request)) ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
