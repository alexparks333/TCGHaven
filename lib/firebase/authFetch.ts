import type { Auth } from 'firebase/auth'
import { auth } from './config'
import { staffAuth } from './staff'

// fetch() that attaches the caller's Firebase ID token as `Authorization: Bearer <token>`, for
// routes that verify who's calling server-side. If nobody's signed in the request goes out without
// one and the server rejects it, rather than silently succeeding. GET reads of the registry/catalog
// stay plain fetch() — those are public-read.
async function withToken(from: Auth, input: string, init: RequestInit): Promise<Response> {
  const token = await from.currentUser?.getIdToken().catch(() => null)
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

// Signed-in collector routes (verifyUserRequest) — the collector app's own session.
export function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return withToken(auth, input, init)
}

// Staff-only routes (verifyAdminRequest: set-registry writes, admin/catalog/invalidate + lookup,
// sync/{game}) — the staff portal's separate session (lib/firebase/staff.ts).
export function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return withToken(staffAuth, input, init)
}
