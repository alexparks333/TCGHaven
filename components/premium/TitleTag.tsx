'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { getAccountRole, titleColor, titleLabel, type AccountRoleRecord } from '@/lib/accountRoles'

// The account's title tag beside a name — "Premium", "Creator", "Staff" / "Owner" — on profiles,
// the sidebar's friends list and your own card (2026-11-19). Someone who has Haven Premium from
// paying or a promo code (premium_public/{uid}, written by the server — lib/premiumBilling.ts
// publicMark) shows as Premium, the same as the Premium title staff can give.

/** The title to show: a Regular account that pays (or used a promo code) counts as Premium. */
export function shownTitle(role: AccountRoleRecord, paid: boolean): AccountRoleRecord {
  return role.role === 'regular' && paid && !role.banned ? { ...role, role: 'premium' } : role
}

// Looked up once per account every few minutes, however many lists show them
const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; p: Promise<AccountRoleRecord> }>()
const paidCache = new Map<string, { at: number; p: Promise<boolean> }>()

function paidOf(uid: string): Promise<boolean> {
  const hit = paidCache.get(uid)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p
  const p = getDoc(doc(db, 'premium_public', uid))
    .then((s) => {
      const d = s.data()
      return d?.active === true && (typeof d.expiresAt !== 'number' || d.expiresAt > Date.now())
    })
    .catch(() => false)
  paidCache.set(uid, { at: Date.now(), p })
  return p
}

function titleOf(uid: string): Promise<AccountRoleRecord> {
  const hit = cache.get(uid)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p
  const p = Promise.all([getAccountRole(uid), paidOf(uid)]).then(([role, paid]) => shownTitle(role, paid))
  cache.set(uid, { at: Date.now(), p })
  return p
}

/** Has this account Haven Premium from paying or a promo code? */
export function usePaidPremium(uid: string | null | undefined): boolean {
  const [state, setState] = useState<{ uid: string; paid: boolean } | null>(null)
  useEffect(() => {
    if (!uid) return
    let live = true
    paidOf(uid).then((paid) => { if (live) setState({ uid, paid }) })
    return () => { live = false }
  }, [uid])
  return !!uid && state?.uid === uid && state.paid
}

/** The title tag for an account (nothing for a Regular account). `record` = its title when the
 *  caller already has it (your own, live); otherwise it's looked up. */
export function TitleTag({ uid, record, size = 'sm', className = '' }: { uid: string; record?: AccountRoleRecord; size?: 'sm' | 'md'; className?: string }) {
  const paid = usePaidPremium(record ? uid : null)
  const [looked, setLooked] = useState<{ uid: string; r: AccountRoleRecord } | null>(null)
  useEffect(() => {
    if (record) return
    let live = true
    titleOf(uid).then((r) => { if (live) setLooked({ uid, r }) })
    return () => { live = false }
  }, [uid, record])
  const title = record ? shownTitle(record, paid) : looked?.uid === uid ? looked.r : null
  if (!title || title.role === 'regular' || title.banned) return null
  const color = titleColor(title)
  return (
    <span
      className={`shrink-0 inline-block font-bold uppercase tracking-wider rounded-full leading-none ${size === 'md' ? 'text-[0.625rem] px-2 py-1' : 'text-[0.5rem] px-1.5 py-[0.1875rem]'} ${className}`}
      style={{ backgroundColor: color + '22', color }}
    >
      {titleLabel(title)}
    </span>
  )
}
