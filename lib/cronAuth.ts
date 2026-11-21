import { createHash, timingSafeEqual } from 'crypto'

/** The cron routes' secret (app/api/cron/*): only from the x-cron-secret header — never the URL,
 *  where it would end up in logs — and compared in constant time (security review 2026-11-21).
 *  Refuses everything when CRON_SECRET isn't set: better a broken cron than an open one. */
export function cronAuthorized(req: Request): boolean {
  const want = process.env.CRON_SECRET
  const got = req.headers.get('x-cron-secret')
  if (!want || !got) return false
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(got), h(want))
}
