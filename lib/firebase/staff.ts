import { initializeApp, getApps, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { firebaseConfig, ADMIN_UID } from './config'

// The staff portal (/admin) runs on its OWN Firebase app instance, so a staff login is a separate
// session from the collector app's: Alex can be signed in to his collection and to /admin at the
// same time in one browser, and an employee's login never touches the collector side. Every
// Firestore/Storage write the portal makes goes through staffDb/staffStorage so security rules see
// the staff member as the caller (see firestore.rules' isStaff()).
const STAFF_APP_NAME = 'staff'
const staffApp = getApps().find((a) => a.name === STAFF_APP_NAME) ?? initializeApp(firebaseConfig, STAFF_APP_NAME)

export const staffAuth = getAuth(staffApp)
export const staffDb = getFirestore(staffApp)
export const staffStorage = getStorage(staffApp)

// The Owner — the one account that can add and remove staff. Also hardcoded in firestore.rules /
// storage.rules as the root of trust, so the Owner can never lock themselves out.
export const OWNER_UID = ADMIN_UID

export type StaffRole = 'owner' | 'staff'

// Job titles on the Team page — just a label: what someone can do is `role` (owner or staff).
// Only the Owner holds "Owner"; the Owner sets everyone else's.
export const STAFF_TITLES = ['Owner', 'Senior Developer', 'Developer', 'Junior Developer', 'Staff'] as const
export type StaffTitle = (typeof STAFF_TITLES)[number]
export const STAFF_TITLE_COLORS: Record<StaffTitle, string> = {
  Owner: '#b8862b', 'Senior Developer': '#7c3aed', Developer: '#2563eb', 'Junior Developer': '#0f8a8a', Staff: '#7a6a55',
}

export interface StaffMember {
  uid: string
  name: string
  email: string
  role: StaffRole
  title: StaffTitle
  // Set when the Owner creates the login with a temporary password; the portal makes the
  // employee choose their own before anything else.
  mustChangePassword?: boolean
  addedAt?: string
  addedBy?: string
}

const staffRef = (uid: string) => doc(staffDb, 'staff', uid)

function toMember(uid: string, data: Record<string, unknown>): StaffMember {
  const at = data.addedAt as { toDate?: () => Date } | undefined
  const role: StaffRole = data.role === 'owner' ? 'owner' : 'staff'
  const stored = STAFF_TITLES.find((t) => t === data.title)
  return {
    uid,
    name: String(data.name ?? ''),
    email: String(data.email ?? ''),
    role,
    title: role === 'owner' ? 'Owner' : stored && stored !== 'Owner' ? stored : 'Staff',
    mustChangePassword: data.mustChangePassword === true,
    addedAt: at?.toDate ? at.toDate().toISOString() : undefined,
    addedBy: typeof data.addedBy === 'string' ? data.addedBy : undefined,
  }
}

// The signed-in staff member's own record, or null if this account isn't staff. The Owner's
// record is created on their first sign-in.
export async function loadStaffMember(uid: string, email: string | null, name: string | null): Promise<StaffMember | null> {
  const isOwner = !!OWNER_UID && uid === OWNER_UID
  const ownerFallback: StaffMember = { uid, name: name || 'Owner', email: email || '', role: 'owner', title: 'Owner' }
  let snap
  try {
    snap = await getDoc(staffRef(uid))
  } catch (err) {
    // The Owner is the rules' hardcoded root of trust, so never lock them out over a failed read.
    if (isOwner) return ownerFallback
    throw err
  }
  if (snap.exists()) return toMember(uid, snap.data())
  if (isOwner) {
    await setDoc(staffRef(uid), { name: ownerFallback.name, email: ownerFallback.email, role: 'owner', addedAt: serverTimestamp(), addedBy: uid })
      .catch((err) => console.error('Failed to create the Owner staff record:', err))
    return ownerFallback
  }
  return null
}

export async function listStaff(): Promise<StaffMember[]> {
  const snap = await getDocs(collection(staffDb, 'staff'))
  return snap.docs
    .map((d) => toMember(d.id, d.data()))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'owner' ? -1 : 1))
}

// Owner only (enforced by firestore.rules). Creates the employee's login with a temporary password
// on a throwaway app instance — creating a user signs that instance in as them, which must not
// disturb the Owner's own staff session — then registers them as staff.
export async function addStaffMember(input: { name: string; email: string; tempPassword: string; title: StaffTitle }, addedBy: string): Promise<void> {
  const provision = initializeApp(firebaseConfig, `staff-provision-${Date.now()}`)
  try {
    const provisionAuth = getAuth(provision)
    const { user } = await createUserWithEmailAndPassword(provisionAuth, input.email.trim(), input.tempPassword)
    await signOut(provisionAuth)
    await setDoc(staffRef(user.uid), {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: 'staff',
      title: input.title === 'Owner' ? 'Staff' : input.title,
      mustChangePassword: true,
      addedAt: serverTimestamp(),
      addedBy,
    })
  } finally {
    await deleteApp(provision).catch(() => {})
  }
}

// Owner only. Removes portal access immediately (every rule and server check reads this record).
// The Firebase login itself stays, but it can no longer do anything as staff.
export async function removeStaffMember(uid: string): Promise<void> {
  await deleteDoc(staffRef(uid))
  await deleteDoc(doc(staffDb, 'staff_presence', uid)).catch(() => {})
}

export async function markPasswordChanged(uid: string): Promise<void> {
  await updateDoc(staffRef(uid), { mustChangePassword: false })
}

// Owner only. A staff member's job title (never "Owner").
export async function setStaffTitle(uid: string, title: StaffTitle): Promise<void> {
  await updateDoc(staffRef(uid), { title: title === 'Owner' ? 'Staff' : title })
}

// ── Who's in the portal right now ─────────────────────────────────────────────────────────
// staff_presence/{uid} = { lastSeen, page }: the portal writes it while it's open and
// in front (every PRESENCE_BEAT_MS and on every page change). "Online" = seen within ONLINE_MS.

export const PRESENCE_BEAT_MS = 60_000
export const ONLINE_MS = 150_000

export interface StaffPresence { lastSeen: number; page: string }

export async function beatPresence(uid: string, page: string): Promise<void> {
  const ref = doc(staffDb, 'staff_presence', uid)
  await setDoc(ref, { lastSeen: serverTimestamp(), page }, { merge: true })
}

export function watchPresence(onChange: (all: Record<string, StaffPresence>) => void): () => void {
  return onSnapshot(collection(staffDb, 'staff_presence'), (snap) => {
    const all: Record<string, StaffPresence> = {}
    for (const d of snap.docs) {
      const x = d.data()
      all[d.id] = { lastSeen: x.lastSeen?.toMillis?.() ?? Date.now(), page: String(x.page ?? '') }
    }
    onChange(all)
  }, () => onChange({}))
}
