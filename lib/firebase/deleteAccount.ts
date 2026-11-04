import {
  collection, doc, getDocs, query, where, limit, writeBatch, type DocumentReference,
} from 'firebase/firestore'
import {
  type User, EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup, deleteUser,
} from 'firebase/auth'
import { auth, db, googleProvider, ADMIN_UID } from './config'

// Delete my account (Settings) — required for the App Store (apps with sign-up must offer it).
// Runs as the user (this app has no server admin SDK), so firestore.rules must let an owner delete
// each of these. Everything a collector has, and nothing anyone else has:
//   users/{uid}/…            every folder below (cards, sold, deleted, collections, settings,
//                            and the unread legacy priceHistory / purchases)
//   friendships              every pair they're in, sent or received
//   shared_cardex/{uid}, shared_badges/{uid}, usernames they hold, profiles/{uid}
//   the sign-in itself (Firebase Auth) — last
// Old invite_codes can't be found by owner (rules forbid listing); they map a code to a uid that
// no longer exists, which /invite already treats as not found.

const USER_FOLDERS = ['cards', 'soldCards', 'deletedCards', 'collections', 'settings', 'priceHistory', 'purchases']

export type DeleteStep = 'confirming' | 'profile' | 'friends' | 'collection' | 'account'

export function canDeleteAccount(user: User): string | null {
  if (ADMIN_UID && user.uid === ADMIN_UID) return 'The Owner account runs the staff portal and can’t be deleted here.'
  return null
}

/** Signs the user in again (Firebase only deletes a sign-in made in the last few minutes). Done
 *  first, so a wrong password or a closed popup leaves everything as it was. */
export async function confirmIdentity(user: User, password?: string): Promise<void> {
  if (user.providerData.some((p) => p.providerId === 'password')) {
    if (!password) throw new Error('Enter your password.')
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password))
  } else {
    await reauthenticateWithPopup(user, googleProvider)
  }
}

export async function deleteAccount(user: User, onStep: (s: DeleteStep) => void): Promise<void> {
  const blocked = canDeleteAccount(user)
  if (blocked) throw new Error(blocked)
  const uid = user.uid

  // The profile first: its batch is all-or-nothing, so if it's refused (say the rules that allow
  // it aren't live) nothing at all has been deleted yet
  onStep('profile')
  const names = await getDocs(query(collection(db, 'usernames'), where('uid', '==', uid)))
  await deleteRefs([
    ...names.docs.map((d) => d.ref),
    doc(db, 'shared_cardex', uid),
    doc(db, 'shared_badges', uid),
    doc(db, 'profiles', uid),
  ])

  onStep('friends')
  for (const field of ['requester', 'addressee'] as const) {
    const snap = await getDocs(query(collection(db, 'friendships'), where(field, '==', uid)))
    await deleteRefs(snap.docs.map((d) => d.ref))
  }

  onStep('collection')
  for (const folder of USER_FOLDERS) await deleteAll(collection(db, 'users', uid, folder))

  onStep('account')
  // The shared copies again, right before the sign-in goes: the app keeps them up to date in the
  // background, and one written in the last moments would otherwise be left behind for good.
  await deleteRefs([doc(db, 'shared_cardex', uid), doc(db, 'shared_badges', uid)])
  await deleteUser(auth.currentUser ?? user)
  // This device's copies kept per account (badges, prices, seen requests — keys carry the uid).
  // The inventory copy is cleared by AuthProvider when the sign-in ends.
  try {
    for (const k of Object.keys(localStorage)) if (k.includes(uid)) localStorage.removeItem(k)
  } catch { /* storage blocked — nothing kept */ }
}

// A whole folder, a page at a time (a batch holds at most 500 writes)
async function deleteAll(col: ReturnType<typeof collection>) {
  for (;;) {
    const snap = await getDocs(query(col, limit(400)))
    if (snap.empty) return
    await deleteRefs(snap.docs.map((d) => d.ref))
  }
}

async function deleteRefs(refs: DocumentReference[]) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db)
    refs.slice(i, i + 400).forEach((r) => batch.delete(r))
    await batch.commit()
  }
}
