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
export async function verifyAdminRequest(request: Request): Promise<NextResponse | null> {
  const authHeader = request.headers.get('authorization') || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY

  if (!idToken || !apiKey || !ADMIN_UID) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    })
    if (!res.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const data = await res.json()
    const uid = data?.users?.[0]?.localId
    if (uid !== ADMIN_UID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return null
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
