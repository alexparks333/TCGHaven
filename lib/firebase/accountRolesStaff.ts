import {
  addDoc, collection, doc, documentId, getCountFromServer, getDoc, getDocs, limit, orderBy, query,
  runTransaction, serverTimestamp, startAfter, startAt, endAt, where, type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { staffDb } from './staff'
import { toProfile, type Profile } from './friends'
import { toRoleRecord, type AccountRole, type AccountRoleRecord } from '../accountRoles'

// Staff portal side of Accounts (lib/accountRoles.ts) — always the staff session (staffDb).

export interface AccountRow { profile: Profile; record: AccountRoleRecord }
export type AccountAction = 'title' | 'suspend' | 'restore' | 'ban' | 'unban'
export interface AccountChange { id: string; at: number; byName: string; action: AccountAction; from?: AccountRole; to?: AccountRole; note: string }

/** The Accounts page's lists. `regular` is everyone without a title (paged — there are many). */
export type AccountList = 'regular' | 'premium' | 'creator' | 'suspended' | 'former' | 'staff' | 'banned'

const roleRef = (uid: string) => doc(staffDb, 'account_roles', uid)
const DELETED = (uid: string): Profile => ({ uid, username: '', displayName: '(deleted account)', photoURL: '', bio: '', privacy: { cardex: false, badges: false }, pinDisplay: [] })

async function inChunks<T>(ids: string[], coll: string, read: (id: string, d: Record<string, unknown>) => T | null): Promise<Map<string, T>> {
  const out = new Map<string, T>()
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(staffDb, coll), where(documentId(), 'in', ids.slice(i, i + 30))))
    for (const d of snap.docs) { const v = read(d.id, d.data()); if (v) out.set(d.id, v) }
  }
  return out
}
const profilesFor = (uids: string[]) => inChunks(uids, 'profiles', (id, d) => toProfile(id, d))
const rolesFor = (uids: string[]) => inChunks(uids, 'account_roles', (_id, d) => toRoleRecord(d))

/** Which list an account belongs in (each account is in exactly one). */
export function listOf(r: AccountRoleRecord): AccountList {
  if (r.banned) return 'banned'
  if (r.role === 'creator') return r.suspended ? 'suspended' : 'creator'
  if (r.formerCreator) return 'former'
  return r.role
}

/** Every account in one of the titled lists, A → Z. */
export async function listAccounts(list: Exclude<AccountList, 'regular'>): Promise<AccountRow[]> {
  const base = collection(staffDb, 'account_roles')
  const q = list === 'banned' ? query(base, where('banned', '==', true))
    : list === 'suspended' ? query(base, where('suspended', '==', true))
    : list === 'former' ? query(base, where('formerCreator', '==', true))
    : query(base, where('role', '==', list))
  const snap = await getDocs(q)
  const records = new Map<string, AccountRoleRecord>()
  for (const d of snap.docs) { const r = toRoleRecord(d.data()); if (listOf(r) === list) records.set(d.id, r) }
  const profiles = await profilesFor(Array.from(records.keys()))
  return Array.from(records, ([uid, record]) => ({ profile: profiles.get(uid) ?? DELETED(uid), record }))
    .sort((a, b) => a.profile.displayName.localeCompare(b.profile.displayName))
}

/** Regular accounts, A → Z, a page at a time (pass the last page's cursor for the next). */
export async function listRegular(after: QueryDocumentSnapshot | null, pageSize = 50): Promise<{ rows: AccountRow[]; next: QueryDocumentSnapshot | null }> {
  const q = after
    ? query(collection(staffDb, 'profiles'), orderBy('displayNameLower'), startAfter(after), limit(pageSize))
    : query(collection(staffDb, 'profiles'), orderBy('displayNameLower'), limit(pageSize))
  const snap = await getDocs(q)
  const roles = await rolesFor(snap.docs.map((d) => d.id))
  const rows: AccountRow[] = []
  for (const d of snap.docs) {
    const record = roles.get(d.id) ?? { role: 'regular' as const }
    const profile = toProfile(d.id, d.data())
    if (profile && listOf(record) === 'regular') rows.push({ profile, record })
  }
  return { rows, next: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null }
}

/** How many accounts there are in all (for the Regular count). */
export async function countAllAccounts(): Promise<number> {
  return (await getCountFromServer(collection(staffDb, 'profiles'))).data().count
}

/** Find any account by name, @username or exact user id — with each one's record. */
export async function searchAccounts(term: string): Promise<AccountRow[]> {
  const raw = term.trim()
  const q = raw.replace(/^@/, '').toLowerCase()
  if (q.length < 2) return []
  const range = (field: string) => getDocs(query(collection(staffDb, 'profiles'), orderBy(field), startAt(q), endAt(q + ''), limit(25)))
  const [byName, byUser, byId] = await Promise.all([
    range('displayNameLower'),
    range('username'),
    raw.length >= 20 && !raw.includes(' ') ? getDoc(doc(staffDb, 'profiles', raw)) : Promise.resolve(null),
  ])
  const found = new Map<string, Profile>()
  if (byId?.exists()) { const p = toProfile(byId.id, byId.data()); if (p) found.set(p.uid, p) }
  for (const d of [...byUser.docs, ...byName.docs]) { const p = toProfile(d.id, d.data()); if (p) found.set(d.id, p) }
  const roles = await rolesFor(Array.from(found.keys()))
  return Array.from(found.values()).slice(0, 40).map((profile) => ({ profile, record: roles.get(profile.uid) ?? { role: 'regular' } }))
}

/** One change to an account (title, suspend/restore, ban/unban), recorded with who and why.
 *  Nothing the account made is ever touched. */
export async function changeAccount(
  uid: string,
  change: { action: 'title'; to: AccountRole } | { action: Exclude<AccountAction, 'title'> },
  note: string,
  by: { uid: string; name: string },
): Promise<AccountRoleRecord> {
  let from: AccountRole = 'regular'
  const next = await runTransaction(staffDb, async (tx) => {
    const snap = await tx.get(roleRef(uid))
    const cur = toRoleRecord(snap.data())
    from = cur.role
    const n: AccountRoleRecord = { ...cur }
    if (change.action === 'title') {
      n.role = change.to
      if (change.to === 'creator') { n.creatorSince = cur.creatorSince ?? Date.now(); n.formerCreator = false }
      else { n.formerCreator = cur.formerCreator || cur.role === 'creator'; n.suspended = false }
    }
    if (change.action === 'suspend') n.suspended = true
    if (change.action === 'restore') n.suspended = false
    if (change.action === 'ban') n.banned = true
    if (change.action === 'unban') n.banned = false
    const data: Record<string, unknown> = {
      role: n.role,
      formerCreator: !!n.formerCreator,
      suspended: !!n.suspended,
      banned: !!n.banned,
      updatedAt: serverTimestamp(),
    }
    if (n.creatorSince) data.creatorSince = n.creatorSince
    tx.set(roleRef(uid), data)
    return { ...n, updatedAt: Date.now() }
  })
  await addDoc(collection(staffDb, 'account_roles', uid, 'history'), {
    at: serverTimestamp(), by: by.uid, byName: by.name, action: change.action,
    ...(change.action === 'title' ? { from, to: change.to } : {}),
    note: note.trim().slice(0, 500),
  })
  return next
}

/** Every change to this account, newest first. */
export async function accountHistory(uid: string): Promise<AccountChange[]> {
  const snap = await getDocs(query(collection(staffDb, 'account_roles', uid, 'history'), orderBy('at', 'desc'), limit(50)))
  return snap.docs.map((d) => {
    const x = d.data()
    return {
      id: d.id, at: x.at?.toMillis?.() ?? Date.now(), byName: String(x.byName ?? ''),
      action: (x.action ?? 'title') as AccountAction, from: x.from, to: x.to, note: String(x.note ?? ''),
    }
  })
}
