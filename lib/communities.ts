// Communities collectors join (docs/creators.md "Communities"). A community is a creator's
// communities/{uid} (lib/creatorBooks.ts, edited in the Creator Studio); joining it is a membership:
//
//   community_members/{communityUid}_{memberUid}  { community, member, joinedAt }
//
// The member creates / deletes their own (firestore.rules). "Your communities" = the memberships
// where member == you; a community's member count = its memberships (a count query).
// A community is only shown while its creator can still use the Creator Studio (isCreator or
// staff) — a suspended or former creator's community is hidden, not deleted.

import { useEffect, useState } from 'react'
import {
  collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, where, endAt, startAt,
} from 'firebase/firestore'
import { db } from './firebase/config'
import { canUseCreatorStudio, toRoleRecord, withOwner } from './accountRoles'
import type { Community } from './creatorBooks'

export interface CommunityEntry extends Community {
  uid: string           // the creator's uid = the community's id
}

const memberId = (community: string, member: string) => `${community}_${member}`

export function communityPath(uid: string) {
  return `/c/${uid}`
}

/** The community, if it exists and its creator is still allowed to run one */
export async function getCommunity(uid: string): Promise<CommunityEntry | null> {
  const [c, role] = await Promise.all([getDoc(doc(db, 'communities', uid)), getDoc(doc(db, 'account_roles', uid))])
  if (!c.exists()) return null
  if (!canUseCreatorStudio(withOwner(uid, toRoleRecord(role.data())))) return null
  return { uid, ...(c.data() as Community) }
}

export async function joinCommunity(member: string, community: string) {
  await setDoc(doc(db, 'community_members', memberId(community, member)), { community, member, joinedAt: serverTimestamp() })
}

export async function leaveCommunity(member: string, community: string) {
  await deleteDoc(doc(db, 'community_members', memberId(community, member)))
}

export async function memberCount(community: string): Promise<number> {
  const snap = await getCountFromServer(query(collection(db, 'community_members'), where('community', '==', community)))
  return snap.data().count
}

/** Communities whose name starts with what's typed (case-insensitive — communities.nameLower) */
export async function searchCommunities(term: string): Promise<CommunityEntry[]> {
  const q = term.trim().toLowerCase()
  if (q.length < 2) return []
  const snap = await getDocs(query(collection(db, 'communities'), orderBy('nameLower'), startAt(q), endAt(q + ''), limit(12)))
  const found = await Promise.all(snap.docs.map((d) => getCommunity(d.id)))
  return found.filter((c): c is CommunityEntry => !!c)
}

/** The communities you've joined, live, newest first */
export function useMyCommunities(uid: string | null | undefined): { communities: CommunityEntry[]; joined: Set<string>; ready: boolean } {
  const [state, setState] = useState<{ uid: string | null; ids: string[]; list: CommunityEntry[]; ready: boolean }>({ uid: null, ids: [], list: [], ready: false })
  useEffect(() => {
    if (!uid) return
    let alive = true
    const unsub = onSnapshot(query(collection(db, 'community_members'), where('member', '==', uid)), async (snap) => {
      const rows = snap.docs.map((d) => d.data() as { community: string; joinedAt?: { toMillis?: () => number } })
        .sort((a, b) => (b.joinedAt?.toMillis?.() ?? Date.now()) - (a.joinedAt?.toMillis?.() ?? Date.now()))
      const ids = rows.map((r) => r.community)
      setState((s) => ({ ...s, uid, ids }))
      const list = (await Promise.all(ids.map((id) => getCommunity(id).catch(() => null)))).filter((c): c is CommunityEntry => !!c)
      if (alive) setState({ uid, ids, list, ready: true })
    }, () => { if (alive) setState({ uid, ids: [], list: [], ready: true }) })
    return () => { alive = false; unsub() }
  }, [uid])
  const mine = uid && state.uid === uid
  return { communities: mine ? state.list : [], joined: new Set(mine ? state.ids : []), ready: !!mine && state.ready }
}
