'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc, onSnapshot, type DocumentData } from 'firebase/firestore'
import { db, ADMIN_UID } from './firebase/config'

// Accounts (2026-11-09) — each collector account's title and standing, set by staff in the staff
// portal's Accounts page (components/admin/AccountsPage.tsx); nobody can set their own.
//
//   account_roles/{uid}            { role, creatorSince?, formerCreator?, suspended?, banned?, updatedAt }
//                                  — no doc = a Regular account in good standing. Readable by any
//                                  signed-in collector (titles show on profiles), written only by
//                                  staff (firestore.rules).
//   account_roles/{uid}/history/*  { at, by, byName, action, from?, to?, note } — every change and
//                                  why. Staff only: notes can be about suspensions, bans or
//                                  investigations.
//
// Titles: Regular, Premium, Creator, Staff. Two holds, neither deletes anything:
//   - Suspended (Creators): still a Creator, but their Studio is paused and everything they made
//     is hidden from them and their followers until restored. (Taking the Creator title away
//     entirely makes them a "former creator" — also hidden, also kept.)
//   - Banned (any account): the app shows only a "banned" screen and firestore.rules refuse their
//     writes; their profile is hidden from others. Unbanning brings everything back.
// Anything a creator makes must be shown only while isCreator() — i.e. Creator, not suspended,
// not banned.

export type AccountRole = 'regular' | 'premium' | 'creator' | 'staff'
export const ACCOUNT_ROLES: AccountRole[] = ['regular', 'premium', 'creator', 'staff']

export const ROLE_LABELS: Record<AccountRole, string> = {
  regular: 'Regular', premium: 'Premium', creator: 'Creator', staff: 'Staff',
}
export const ROLE_COLORS: Record<AccountRole, string> = {
  regular: '#7a6a55', premium: '#b8862b', creator: '#7c3aed', staff: '#2f6f5e',
}
export const ROLE_HINTS: Record<AccountRole, string> = {
  regular: 'The free app.',
  premium: 'The paid app.',
  creator: 'Premium for free, plus the Creator tab to build their own community and badges.',
  staff: 'A TCG Haven team member’s collector account. Includes Premium.',
}

export interface AccountRoleRecord {
  role: AccountRole
  creatorSince?: number   // ms — when they first became a Creator
  formerCreator?: boolean // was a Creator, title taken away; their work is kept, hidden
  suspended?: boolean     // a Creator on hold: Studio paused, their work hidden
  banned?: boolean        // the whole account is blocked
  updatedAt?: number
  // Set when this account is also on the staff team (its staff portal login is the same account,
  // like the Owner's): shown instead of "Staff" (e.g. "Owner", "Developer"). Such accounts are
  // always Staff and are managed on the Team page, not the Accounts page.
  staffTitle?: string
}

/** The title to show for an account: its staff job title if it has one, else its role's name. */
export const titleLabel = (r: AccountRoleRecord) => r.staffTitle ?? ROLE_LABELS[r.role]
/** Its colour: the Owner in gold, everyone else by role. */
export const titleColor = (r: AccountRoleRecord) => (r.staffTitle === 'Owner' ? '#b8862b' : ROLE_COLORS[r.role])

/** The Owner's collector account is the Owner's — always Staff, titled "Owner", never banned. */
export function withOwner(uid: string, r: AccountRoleRecord): AccountRoleRecord {
  return ADMIN_UID && uid === ADMIN_UID ? { ...r, role: 'staff', staffTitle: 'Owner', banned: false, suspended: false } : r
}

export const REGULAR: AccountRoleRecord = { role: 'regular' }

/** Premium features: paid accounts, and Creators and Staff for free */
export const hasPremium = (r: AccountRoleRecord) => r.role !== 'regular' && !r.banned
/** A Creator whose Studio and work are live */
export const isCreator = (r: AccountRoleRecord) => r.role === 'creator' && !r.suspended && !r.banned

function millis(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  const t = (v as { toMillis?: () => number } | null)?.toMillis?.()
  return typeof t === 'number' ? t : undefined
}

export function toRoleRecord(d: DocumentData | undefined): AccountRoleRecord {
  if (!d) return REGULAR
  const role = ACCOUNT_ROLES.includes(d.role) ? (d.role as AccountRole) : 'regular'
  return {
    role,
    creatorSince: millis(d.creatorSince),
    formerCreator: d.formerCreator === true,
    suspended: d.suspended === true && role === 'creator',
    banned: d.banned === true,
    updatedAt: millis(d.updatedAt),
  }
}

// ── Collector app ───────────────────────────────────────────────────────────────────────────

/** The signed-in collector's own record, live (a change in the staff portal shows straight away). */
export function useAccountRole(uid: string | null | undefined): { record: AccountRoleRecord; loaded: boolean } {
  const [state, setState] = useState<{ uid: string | null; record: AccountRoleRecord }>({ uid: null, record: REGULAR })
  useEffect(() => {
    if (!uid) return
    return onSnapshot(
      doc(db, 'account_roles', uid),
      (snap) => setState({ uid, record: withOwner(uid, toRoleRecord(snap.data())) }),
      () => setState({ uid, record: withOwner(uid, REGULAR) }),
    )
  }, [uid])
  return uid && state.uid === uid ? { record: state.record, loaded: true } : { record: REGULAR, loaded: !uid }
}

/** Someone else's record, for their profile. */
export async function getAccountRole(uid: string): Promise<AccountRoleRecord> {
  try { return withOwner(uid, toRoleRecord((await getDoc(doc(db, 'account_roles', uid))).data())) } catch { return withOwner(uid, REGULAR) }
}
