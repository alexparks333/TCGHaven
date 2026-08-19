import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from './config'

// Server-side routes (set-registry writes, the sync routes) run through this same client SDK
// `auth`/`db` instance as the browser does — but unlike a real browser session, a Next.js
// server process has no signed-in user by default, so a write that requires Firestore's
// isAdmin() rule (see firestore.rules) would be rejected with permission-denied. This signs the
// process-wide `auth` instance in as the same dedicated email/password "sync" account
// scripts/download-card-catalog.mjs already uses (ADMIN_EMAIL/ADMIN_PASSWORD), once per process,
// so any server route that needs to write admin-only Firestore data can just await this first.
let signedInPromise: Promise<void> | null = null

export function ensureAdminAuth(): Promise<void> {
  if (auth.currentUser) return Promise.resolve()
  if (!signedInPromise) {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      signedInPromise = null
      throw new Error(
        'ADMIN_EMAIL and ADMIN_PASSWORD must be set (in .env.local locally, or as Vercel project ' +
        'env vars in production) for server-side catalog/registry writes to authenticate.'
      )
    }
    signedInPromise = signInWithEmailAndPassword(auth, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
      .then(() => undefined)
      .catch((err) => { signedInPromise = null; throw err })
  }
  return signedInPromise
}
