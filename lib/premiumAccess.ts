'use client'

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase/config'
import { hasPremium, useAccountRole } from './accountRoles'
import { entitlementActive, toEntitlement, toLaunch, FREE_SCANS_PER_MONTH, type Entitlement, type PremiumLaunch } from './premiumRules'

export { FREE_SCANS_PER_MONTH }

// Who has Haven Premium, in the collector app (docs/premium-business.md "Decided 2026-11-19").
//
//   premium/launch        { gatesOn } — the Owner's launch switch (staff portal → Haven Premium).
//                         While it's off nothing is locked: every feature works for everyone.
//   entitlements/{uid}    the paid state, written only by the server from RevenueCat's webhook
//                         (or a promo code). Readable by its own account.
//
// `unlocked` is what features check: true while the gates are off, or for anyone with Premium
// (the Premium / Creator / Staff title, or an active entitlement). The server checks the same
// thing again (lib/premiumServer.ts) — the app's lock is only the friendly half.

export interface PremiumAccess {
  loaded: boolean
  gatesOn: boolean
  /** Has Premium — by title or by paying */
  member: boolean
  /** May use Premium features right now */
  unlocked: boolean
  entitlement: Entitlement | null
}

export function usePremiumLaunch(): PremiumLaunch | null {
  const [launch, setLaunch] = useState<PremiumLaunch | null>(null)
  useEffect(() => onSnapshot(doc(db, 'premium', 'launch'), (s) => setLaunch(toLaunch(s.data())), () => setLaunch(toLaunch(undefined))), [])
  return launch
}

export function usePremium(uid: string | null | undefined): PremiumAccess {
  const launch = usePremiumLaunch()
  const { record, loaded: roleLoaded } = useAccountRole(uid)
  const [ent, setEnt] = useState<{ uid: string; e: Entitlement | null } | null>(null)
  useEffect(() => {
    if (!uid) return
    return onSnapshot(doc(db, 'entitlements', uid), (s) => setEnt({ uid, e: s.exists() ? toEntitlement(s.data()) : null }), () => setEnt({ uid, e: null }))
  }, [uid])
  const entitlement = uid && ent?.uid === uid ? ent.e : null
  // Dev server only: localStorage 'haven:premium-preview' = 'free' shows the app as a free account
  // with the locks on (this device's screens only — the server still decides what it sends)
  const previewFree = process.env.NODE_ENV === 'development' && readPreview() === 'free'
  const gatesOn = previewFree || (launch?.gatesOn ?? false)
  const member = !previewFree && (hasPremium(record) || entitlementActive(entitlement))
  return {
    loaded: !!launch && roleLoaded && (!uid || ent?.uid === uid),
    gatesOn,
    member,
    unlocked: !gatesOn || member,
    entitlement,
  }
}

function readPreview(): string | null {
  try { return localStorage.getItem('haven:premium-preview') } catch { return null }
}
