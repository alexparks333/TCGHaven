import { auth } from './config'

// Drop-in replacement for fetch() on every admin-only write call (set-registry PUT/POST/DELETE,
// admin/catalog/invalidate, admin/catalog/lookup, sync/{game}) now that those routes verify the
// caller server-side via verifyAdminRequest() instead of trusting any caller who knows the URL.
// Attaches the signed-in user's own Firebase ID token as a Bearer header; if nobody's signed in
// (shouldn't happen — every call site here is already behind an isAdmin-gated UI) the request
// goes out without one and the server correctly rejects it as unauthorized rather than silently
// succeeding. GET reads of the registry/catalog stay plain fetch() — those are public-read.
export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await auth.currentUser?.getIdToken().catch(() => null)
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}
