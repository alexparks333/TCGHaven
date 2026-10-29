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
// staff — callers do `const unauthorized = await verifyAdminRequest(request); if
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
  // Checked locally against Google's published signing keys (no round trip per request); the
  // REST lookup is only the fallback if those keys can't be fetched
  const local = await verifyLocally(idToken)
  const uid = local === undefined ? await lookupUid(idToken, apiKey) : local
  if (uid) {
    if (verified.size > 500) verified.clear()
    verified.set(idToken, { uid, at: Date.now() })
  }
  return uid
}

// ── Local ID-token verification ─────────────────────────────────────────────────────────────
// A Firebase ID token is a JWT signed (RS256) by one of Google's securetoken keys, published as
// X.509 certs and rotated every few hours (the response's max-age says how long to keep them).
// Returns the uid, null for a bad token, or undefined if the keys couldn't be fetched.
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
let certs: { keys: Record<string, string>; until: number } | null = null

async function signingCerts(): Promise<Record<string, string> | null> {
  if (certs && Date.now() < certs.until) return certs.keys
  try {
    const res = await fetch(CERTS_URL)
    if (!res.ok) return null
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600)
    certs = { keys: await res.json(), until: Date.now() + maxAge * 1000 }
    return certs.keys
  } catch {
    return null
  }
}

async function verifyLocally(idToken: string): Promise<string | null | undefined> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const parts = idToken.split('.')
  if (!projectId || parts.length !== 3) return null
  try {
    const decode = (x: string) => JSON.parse(Buffer.from(x, 'base64url').toString('utf8'))
    const header = decode(parts[0]), payload = decode(parts[1])
    if (header.alg !== 'RS256' || !header.kid) return null
    const keys = await signingCerts()
    if (!keys) return undefined
    const cert = keys[header.kid]
    if (!cert) return null
    const { createVerify } = await import('crypto')
    const ok = createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(cert, Buffer.from(parts[2], 'base64url'))
    const now = Math.floor(Date.now() / 1000)
    if (!ok || payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) return null
    if (!(payload.exp > now) || !(payload.iat <= now + 300) || typeof payload.sub !== 'string' || !payload.sub) return null
    return payload.sub
  } catch {
    return null
  }
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

// Is this uid on the staff list (firestore.rules' staff/{uid})? Read through Firestore's REST API
// with the CALLER's own ID token — the rules let a signed-in user read their own staff record —
// so the server needs no service account for this either. The Owner (ADMIN_UID) always passes,
// even before their record exists, matching the rules' hardcoded root of trust. Cached per token
// alongside the uid, for the same reason.
const staffChecked = new Map<string, { staff: boolean; at: number }>()

async function isStaff(uid: string, idToken: string): Promise<boolean> {
  if (ADMIN_UID && uid === ADMIN_UID) return true
  const hit = staffChecked.get(idToken)
  if (hit && Date.now() - hit.at < VERIFIED_TTL_MS) return hit.staff
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  if (!projectId) return false
  let staff = false
  try {
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/staff/${encodeURIComponent(uid)}`,
      { headers: { Authorization: `Bearer ${idToken}` } },
    )
    staff = res.ok
  } catch {
    return false // a network blip isn't cached
  }
  if (staffChecked.size > 500) staffChecked.clear()
  staffChecked.set(idToken, { staff, at: Date.now() })
  return staff
}

// Staff-only routes: the caller must be signed in (to the staff portal — lib/firebase/authFetch.ts's
// adminFetch sends that session's token) AND be on the staff list.
export async function verifyAdminRequest(request: Request): Promise<NextResponse | null> {
  const authHeader = request.headers.get('authorization') || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const uid = await callerUid(request)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isStaff(uid, idToken))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

// Same check, but any signed-in user passes — for routes that aren't admin-only but call a
// paid/rate-limited outside API on the caller's behalf (e.g. the eBay price lookup), so an
// anonymous visitor can't burn that quota just by finding the URL.
export async function verifyUserRequest(request: Request): Promise<NextResponse | null> {
  return (await callerUid(request)) ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// The Owner only (ADMIN_UID) — the collector app's dev tools (app/api/dev/*). Returns the
// Owner's uid, or an error response to send back.
export async function verifyOwnerRequest(request: Request): Promise<{ uid: string } | NextResponse> {
  const uid = await callerUid(request)
  if (!uid || uid !== ADMIN_UID) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return { uid }
}
