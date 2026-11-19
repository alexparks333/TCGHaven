import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db, ADMIN_UID } from './firebase/config'
import { ensureAdminAuth } from './firebase/adminAuth'
import { callerUid } from './firebase/verifyAdminRequest'
import { entitlementActive, toEntitlement, toLaunch, scanMonth, FREE_SCANS_PER_MONTH } from './premiumRules'

// Haven Premium on the server: the real lock (lib/premiumAccess.ts is the app's friendly half).
// Reads go through the sync bot's session (ensureAdminAuth) — firestore.rules let it read
// entitlements and write scan_usage; nobody's app can.
//
// PREMIUM_GATES=off (env) unlocks everything regardless of the launch switch — CI's real-scan
// check runs with it, and it's an emergency off switch.

export interface CallerAccess { uid: string | null; gatesOn: boolean; unlocked: boolean }

const LAUNCH_TTL_MS = 30_000
let launchCache: { gatesOn: boolean; at: number } | null = null

export async function gatesOn(): Promise<boolean> {
  if (process.env.PREMIUM_GATES === 'off') return false
  if (launchCache && Date.now() - launchCache.at < LAUNCH_TTL_MS) return launchCache.gatesOn
  let on = false
  try { on = toLaunch((await getDoc(doc(db, 'premium', 'launch'))).data()).gatesOn } catch { on = launchCache?.gatesOn ?? false }
  launchCache = { gatesOn: on, at: Date.now() }
  return on
}

/** Has this account got Premium — by title (Premium / Creator / Staff, not banned) or by paying? */
export async function uidHasPremium(uid: string): Promise<boolean> {
  if (ADMIN_UID && uid === ADMIN_UID) return true
  await ensureAdminAuth()
  const [role, ent] = await Promise.all([
    getDoc(doc(db, 'account_roles', uid)).then((s) => s.data()).catch(() => undefined),
    getDoc(doc(db, 'entitlements', uid)).then((s) => s.data()).catch(() => undefined),
  ])
  const titled = !!role && ['premium', 'creator', 'staff'].includes(String(role.role)) && role.banned !== true
  return titled || entitlementActive(toEntitlement(ent))
}

export async function callerAccess(request: Request): Promise<CallerAccess> {
  const on = await gatesOn()
  const uid = await callerUid(request)
  if (!on) return { uid, gatesOn: false, unlocked: true }
  return { uid, gatesOn: true, unlocked: uid ? await uidHasPremium(uid) : false }
}

/** A free account's scan: counts it (once per scanId) against this month's allowance.
 *  Returns how many are left after it, or -1 when the allowance is used up. */
export async function countFreeScan(uid: string, scanId: string): Promise<number> {
  await ensureAdminAuth()
  const month = scanMonth()
  const ref = doc(db, 'scan_usage', uid)
  return runTransaction(db, async (tx) => {
    const d = (await tx.get(ref)).data()
    const ids: string[] = d?.month === month && Array.isArray(d.scanIds) ? d.scanIds : []
    if (ids.includes(scanId)) return FREE_SCANS_PER_MONTH - ids.length // a retry of a scan already counted
    if (ids.length >= FREE_SCANS_PER_MONTH) return -1
    const next = [...ids, scanId]
    tx.set(ref, { month, scanIds: next, used: next.length, updatedAt: serverTimestamp() })
    return FREE_SCANS_PER_MONTH - next.length
  })
}

/** The signed-in caller's uid and email. The token is verified by callerUid first; only then is its
 *  email read from it (promo codes count per email as well as per account). */
export async function callerIdentity(request: Request): Promise<{ uid: string; email: string | null } | null> {
  const uid = await callerUid(request)
  if (!uid) return null
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '')
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))
    return { uid, email: payload.sub === uid && typeof payload.email === 'string' && payload.email ? payload.email : null }
  } catch {
    return { uid, email: null }
  }
}
