import { initializeApp, getApps } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Google sign-in's helper page on our own address (www.tcghaven.org/__/auth/…, forwarded to Firebase
// by next.config.js rewrites) instead of tcghaven-85a34.firebaseapp.com — the pop-up's address bar
// and Google's "continue to …" line then show tcghaven.org, not a Firebase address that looks like a
// scam. Switched on by NEXT_PUBLIC_AUTH_ON_SITE=on, only once Google Cloud lists
// https://<host>/__/auth/handler as a redirect URI for the web client (or Google sign-in breaks).
// Any other host (localhost, Vercel previews) keeps the Firebase address. docs/user-data.md.
const ownSite = typeof window !== 'undefined' && process.env.NEXT_PUBLIC_AUTH_ON_SITE === 'on'
  && /(^|\.)tcghaven\.org$/.test(window.location.hostname)

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: ownSite ? window.location.host : process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()

// Anyone signed in whose uid matches this is treated as the catalog admin (Admin Catalog page,
// nav link visibility). Real enforcement is Firestore/Storage security rules, not this check —
// this only controls what the UI shows; someone bypassing the UI still can't write without
// matching the same uid server-side.
// The Owner: alexparks@tcghaven.org (2026-11-21). Not a secret (firestore.rules names it too), so
// it lives here rather than in NEXT_PUBLIC_ADMIN_UID, which named the old account that was both the
// Owner and the sync bot. The sync bot (ADMIN_EMAIL) is a separate account now.
export const ADMIN_UID: string = 'gTjTFDy9wLWiptuFxhiCLOv8kEa2'
// The Owner's personal collecting account (alexhparks@gmail.com — their own cards; where they test).
// The Owner in the app (lib/accountRoles.ts APP_OWNER_UIDS) and on a LOCAL dev server's dev tools
// (DevPanel, app/api/dev/*) — never for admin routes or security rules, which stay with ADMIN_UID.
export const PERSONAL_OWNER_UID: string = 'kOVse5dvMDOSkxlitTAh1Q99sJD3'
