import {
  collection, doc, getDoc, getDocs, onSnapshot, query, where, limit, orderBy, startAt, endAt,
  setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from './config'
import type { Card, Game } from '../types'

// Friends (2026-10-26). Three shared collections, all enforced by firestore.rules:
//   profiles/{uid}          — public-to-signed-in-users card: name, @username, photo. No email.
//   usernames/{username}    — { uid } claim doc; its id being unique is what makes a username unique.
//                              Renaming keeps your last 3 old names (profile.previousUsernames), so
//                              old /u/ links still redirect to you; older ones are released.
//   friendships/{a_b}       — one doc per pair (uids sorted, joined by "_"):
//                              { users, requester, addressee, status: 'pending' | 'accepted' }.
//                              Either person can delete it (decline / cancel / unfriend).
//   invite_codes/{code}     — { uid }: a personal invite link. Opening it lets someone create an
//                              already-accepted friendship with that person, no request step.
//   shared_cardex/{uid}     — a copy of which cards the user owns (no prices, no purchase info),
//                              written only while they share their Cardex; readable by their
//                              friends while profiles/{uid}.privacy.cardex is on.
// What friends can see is the user's choice (profile `privacy`). The Portfolio is never shared.
// The invite code itself lives in users/{uid}/private/invite, readable only by its owner.

export interface ProfilePrivacy {
  cardex: boolean  // friends can browse your Cardex
  badges: boolean  // friends can see your badges (badges are coming soon)
}

export const DEFAULT_PRIVACY: ProfilePrivacy = { cardex: false, badges: false }
export const BIO_MAX = 160

export interface Profile {
  uid: string
  username: string
  displayName: string
  photoURL: string
  bio: string
  privacy: ProfilePrivacy
}

export type FriendshipStatus = 'pending' | 'accepted'

export interface Friendship {
  id: string
  requester: string
  addressee: string
  status: FriendshipStatus
  createdAt: number
  respondedAt: number
}

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/

export function pairId(a: string, b: string): string {
  return [a, b].sort().join('_')
}

export function otherUid(f: Friendship, me: string): string {
  return f.requester === me ? f.addressee : f.requester
}

function toMillis(v: unknown): number {
  return (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0
}

function toProfile(uid: string, d: Record<string, unknown> | undefined): Profile | null {
  if (!d) return null
  return {
    uid,
    username: String(d.username ?? ''),
    displayName: String(d.displayName ?? '') || String(d.username ?? 'Collector'),
    photoURL: String(d.photoURL ?? ''),
    bio: String(d.bio ?? ''),
    privacy: { ...DEFAULT_PRIVACY, ...(d.privacy as Partial<ProfilePrivacy> | undefined) },
  }
}

function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '').slice(0, 15)
}

// ── Profiles ────────────────────────────────────────────────────────────────────────────────

/**
 * Makes sure the signed-in user has a profile (creating one with a free username the first
 * time) and keeps its name/photo in step with their account. Returns the profile.
 */
export async function ensureProfile(user: User): Promise<Profile> {
  const ref = doc(db, 'profiles', user.uid)
  const snap = await getDoc(ref)
  const displayName = user.displayName || user.email?.split('@')[0] || 'Collector'
  const photoURL = user.photoURL ?? ''
  if (snap.exists()) {
    const d = snap.data()
    if (d.displayName !== displayName || d.photoURL !== photoURL) {
      await updateDoc(ref, { displayName, displayNameLower: displayName.toLowerCase(), photoURL, updatedAt: serverTimestamp() })
    }
    return { ...(toProfile(user.uid, d) as Profile), displayName, photoURL }
  }
  let base = slugify(user.displayName || '') || slugify(user.email?.split('@')[0] || '') || 'collector'
  if (base.length < 3) base = (base + 'collector').slice(0, 15)
  for (let attempt = 0; attempt < 6; attempt++) {
    const username = attempt === 0 ? base : `${base}${Math.floor(Math.random() * (attempt < 3 ? 1000 : 100000))}`
    if ((await getDoc(doc(db, 'usernames', username))).exists()) continue
    const batch = writeBatch(db)
    batch.set(doc(db, 'usernames', username), { uid: user.uid })
    batch.set(ref, {
      uid: user.uid, username, displayName, displayNameLower: displayName.toLowerCase(), photoURL,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    try {
      await batch.commit()
      return { uid: user.uid, username, displayName, photoURL, bio: '', privacy: DEFAULT_PRIVACY }
    } catch {
      // Someone claimed it between the check and the write — try another.
    }
  }
  throw new Error('Could not create your profile')
}

export async function getProfile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(doc(db, 'profiles', uid))
  return snap.exists() ? toProfile(uid, snap.data()) : null
}

/** A profile's shareable address: /u/{username} (falls back to /profile/{uid} without one). */
export function profilePath(uid: string, username?: string): string {
  return username ? `/u/${username}` : `/profile/${uid}`
}

/** Who holds a @username — their current one or a recent old one — or null if no one does. */
export async function resolveUsername(raw: string): Promise<string | null> {
  const name = raw.trim().replace(/^@/, '').toLowerCase()
  if (!USERNAME_RE.test(name)) return null
  const snap = await getDoc(doc(db, 'usernames', name))
  return snap.exists() ? (snap.data().uid as string) : null
}

// How many old usernames stay yours after renaming. While held, an old name still finds you
// (/u/{old} redirects) and no one else can take it and pose as you; older ones are released.
export const KEEP_OLD_USERNAMES = 3

/** Changes the user's @username. Throws a readable message if it's invalid or taken. */
export async function changeUsername(uid: string, oldName: string, raw: string): Promise<string> {
  const username = raw.trim().replace(/^@/, '').toLowerCase()
  if (!USERNAME_RE.test(username)) throw new Error('3–20 letters, numbers, _ or .')
  if (username === oldName) return username
  const claim = await getDoc(doc(db, 'usernames', username))
  // A name you still hold (one of your recent ones) can be switched back to.
  if (claim.exists() && claim.data().uid !== uid) throw new Error('That username is taken')

  // Newest first: the name you're leaving, then the ones before it — the most recent few are kept.
  const prev = ((await getDoc(doc(db, 'profiles', uid))).data()?.previousUsernames ?? []) as string[]
  const kept = Array.from(new Set([oldName, ...prev].filter((n) => n && n !== username))).slice(0, KEEP_OLD_USERNAMES)
  // Every name this account holds — so anything not kept is released, including leftovers from
  // before this limit existed.
  const held = await getDocs(query(collection(db, 'usernames'), where('uid', '==', uid)))

  const batch = writeBatch(db)
  if (!claim.exists()) batch.set(doc(db, 'usernames', username), { uid })
  for (const d of held.docs) {
    if (d.id !== username && !kept.includes(d.id)) batch.delete(d.ref)
  }
  batch.update(doc(db, 'profiles', uid), { username, previousUsernames: kept, updatedAt: serverTimestamp() })
  try {
    await batch.commit()
  } catch {
    throw new Error('That username is taken')
  }
  return username
}

/** People whose @username or name starts with `term` (up to 10, never the searcher). */
export async function searchProfiles(term: string, me: string): Promise<Profile[]> {
  const q = term.trim().replace(/^@/, '').toLowerCase()
  if (q.length < 2) return []
  const range = (field: string) =>
    getDocs(query(collection(db, 'profiles'), orderBy(field), startAt(q), endAt(q + ''), limit(10)))
  const [byName, byUser] = await Promise.all([range('displayNameLower'), range('username')])
  const out = new Map<string, Profile>()
  for (const d of [...byUser.docs, ...byName.docs]) {
    const p = toProfile(d.id, d.data())
    if (p && d.id !== me) out.set(d.id, p)
  }
  return Array.from(out.values()).slice(0, 10)
}

/** Saves what the user curates on their profile: bio and what friends can see. */
export async function updateProfileDetails(uid: string, patch: { bio?: string; privacy?: ProfilePrivacy }): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (patch.bio !== undefined) data.bio = patch.bio.trim().slice(0, BIO_MAX)
  if (patch.privacy) data.privacy = { cardex: !!patch.privacy.cardex, badges: !!patch.privacy.badges }
  await updateDoc(doc(db, 'profiles', uid), data)
  if (patch.privacy && !patch.privacy.cardex) await deleteDoc(doc(db, 'shared_cardex', uid)).catch(() => {})
}

// ── Shared Cardex ───────────────────────────────────────────────────────────────────────────
// Only what the Cardex needs to show ownership — never prices, purchase dates or groups.

const SHARED_FIELDS = ['id', 'game', 'name', 'set', 'setCode', 'number', 'quantity', 'isFoil', 'apiId', 'imageUrl',
  'rarity', 'language', 'edition', 'finish', 'gradingCompany', 'grade', 'nexus'] as const

export function toSharedCards(cards: Card[]): Record<string, unknown>[] {
  return cards.map((c) => {
    const out: Record<string, unknown> = {}
    for (const k of SHARED_FIELDS) if (c[k] !== undefined && c[k] !== '') out[k] = c[k]
    return out
  })
}

export async function readSharedCardexRaw(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'shared_cardex', uid))
  return snap.exists() ? String(snap.data().cards ?? '[]') : null
}

/** Writes the shared copy (stored as one JSON string — one small doc, ~150 bytes a card). */
export async function writeSharedCardex(uid: string, json: string): Promise<void> {
  await setDoc(doc(db, 'shared_cardex', uid), { cards: json, updatedAt: serverTimestamp() })
}

/**
 * A friend's shared cards, as Cards the Cardex can read. 'private' when they don't share it (or
 * you aren't friends), 'none' when they share it but haven't any cards yet.
 */
export async function loadFriendCardex(uid: string): Promise<Card[] | 'private'> {
  try {
    const raw = await readSharedCardexRaw(uid)
    if (raw === null) return []
    return (JSON.parse(raw) as Partial<Card>[]).map((c) => ({
      condition: 'near_mint', purchasePrice: 0, purchaseDate: '', quantity: 1, isFoil: false,
      ...c, game: c.game as Game,
    }) as Card)
  } catch {
    return 'private'
  }
}

// ── Friendships ─────────────────────────────────────────────────────────────────────────────

/** Live list of every friendship (pending or accepted) the user is part of. */
export function watchFriendships(me: string, onChange: (list: Friendship[]) => void, onError: (e: Error) => void): () => void {
  const sent = new Map<string, Friendship>()
  const received = new Map<string, Friendship>()
  const emit = () => onChange([...Array.from(sent.values()), ...Array.from(received.values())])
  const listen = (field: 'requester' | 'addressee', into: Map<string, Friendship>) =>
    onSnapshot(query(collection(db, 'friendships'), where(field, '==', me)), (snap) => {
      into.clear()
      for (const d of snap.docs) {
        const x = d.data()
        into.set(d.id, {
          id: d.id, requester: x.requester, addressee: x.addressee, status: x.status,
          createdAt: toMillis(x.createdAt), respondedAt: toMillis(x.respondedAt),
        })
      }
      emit()
    }, onError)
  const a = listen('requester', sent)
  const b = listen('addressee', received)
  return () => { a(); b() }
}

export async function sendFriendRequest(me: string, them: string): Promise<void> {
  await setDoc(doc(db, 'friendships', pairId(me, them)), {
    users: [me, them].sort(), requester: me, addressee: them, status: 'pending',
    createdAt: serverTimestamp(),
  })
}

export async function acceptFriendRequest(me: string, them: string): Promise<void> {
  await updateDoc(doc(db, 'friendships', pairId(me, them)), { status: 'accepted', respondedAt: serverTimestamp() })
}

/** Decline, cancel or unfriend — all the same thing: the pair's doc goes away. */
export async function removeFriendship(me: string, them: string): Promise<void> {
  await deleteDoc(doc(db, 'friendships', pairId(me, them)))
}

// ── Invite links ────────────────────────────────────────────────────────────────────────────

function newCode(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

/** The user's invite code, created the first time it's asked for. `reset` swaps in a new one. */
export async function getInviteCode(uid: string, reset = false): Promise<string> {
  const ref = doc(db, 'users', uid, 'private', 'invite')
  const current = (await getDoc(ref)).data()?.code as string | undefined
  if (current && !reset) return current
  const code = newCode()
  const batch = writeBatch(db)
  batch.set(doc(db, 'invite_codes', code), { uid, createdAt: serverTimestamp() })
  if (current) batch.delete(doc(db, 'invite_codes', current))
  batch.set(ref, { code })
  await batch.commit()
  return code
}

/** Who an invite code belongs to, or null if it's unknown (reset or mistyped). */
export async function resolveInviteCode(code: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'invite_codes', code))
    return snap.exists() ? (snap.data().uid as string) : null
  } catch {
    return null
  }
}

/**
 * Accepts someone's invite link: becomes friends straight away. If either of them already sent
 * a request, that's settled the same way.
 */
export async function acceptInvite(me: string, them: string, code: string, existing: Friendship | undefined): Promise<void> {
  if (existing?.status === 'accepted') return
  if (existing && existing.addressee === me) return acceptFriendRequest(me, them)
  if (existing) await removeFriendship(me, them)
  await setDoc(doc(db, 'friendships', pairId(me, them)), {
    users: [me, them].sort(), requester: me, addressee: them, status: 'accepted',
    inviteCode: code, createdAt: serverTimestamp(), respondedAt: serverTimestamp(),
  })
}
