// Where to go after signing in or up: the page that sent the visitor to /login (AuthGuard adds
// ?next=…, e.g. a friend's invite link), else home. Only same-site paths are honoured.
function nextParam(): string | null {
  if (typeof window === 'undefined') return null
  const next = new URLSearchParams(window.location.search).get('next')
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : null
}

export function afterSignIn(): string {
  return nextParam() ?? '/'
}

/** "?next=…" to carry the destination between /login and /signup, or "". */
export function nextQuery(): string {
  const next = nextParam()
  return next ? `?next=${encodeURIComponent(next)}` : ''
}
