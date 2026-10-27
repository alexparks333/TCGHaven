import { NextResponse } from 'next/server'
import { createHmac } from 'node:crypto'
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { firebaseConfig } from '@/lib/firebase/config'
import { verifyOwnerRequest } from '@/lib/firebase/verifyAdminRequest'
import { loadCatalog } from '@/lib/api/catalog'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Dev tools (components/dev/DevPanel.tsx, Owner only, local dev server only — 404 in production): a test collector, "Tess Tester", who can
// send the Owner a friend request, accept one, unfriend them, and share a Cardex with real cards —
// so the friends flow can be tried end to end from one account. The server signs in AS Tess (her
// own Firebase app instance, separate from the process's admin session), so every write goes
// through the same firestore.rules a real user's would. Her password is derived from CRON_SECRET,
// so it's never stored anywhere.

const EMAIL = 'tess.tester@tcghaven.test'
const NAME = 'Tess Tester'
const WANTED_USERNAME = 'tesstester'

function password(): string {
  const secret = process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || ''
  if (!secret) throw new Error('CRON_SECRET is not set')
  return 'T!' + createHmac('sha256', secret).update(EMAIL).digest('base64url').slice(0, 28)
}

const app = getApps().find((a) => a.name === 'dev-test-friend') ?? initializeApp(firebaseConfig, 'dev-test-friend')
const auth = getAuth(app)
const db = getFirestore(app)

async function signIn(create: boolean): Promise<string | null> {
  if (auth.currentUser?.email === EMAIL) return auth.currentUser.uid
  try {
    return (await signInWithEmailAndPassword(auth, EMAIL, password())).user.uid
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    if (!create || !/user-not-found|invalid-credential|invalid-login/.test(code)) {
      if (!create) return null
      throw e
    }
    const cred = await createUserWithEmailAndPassword(auth, EMAIL, password())
    await updateProfile(cred.user, { displayName: NAME })
    return cred.user.uid
  }
}

const pairId = (a: string, b: string) => [a, b].sort().join('_')

// ── Tess's cards ────────────────────────────────────────────────────────────────────────────
// Deterministic (seeded) so every reset gives her the same collection: about half of Riftbound
// Origins and Pokémon Base Set (good for the Full Cardex view), plus a handful of chase cards.

function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
}

interface CatCard {
  id: string; name: string; set?: string; setName: string; setCode?: string; number: string
  rarity?: string; imageUrl?: string; marketPrice?: number; marketPriceFoil?: number; hidden?: boolean
}

async function buildCards() {
  const rand = seeded(42)
  const [rift, poke] = await Promise.all([loadCatalog<CatCard>('riftbound'), loadCatalog<CatCard>('pokemon')])
  const price = (c: CatCard) => Math.max(c.marketPrice ?? 0, c.marketPriceFoil ?? 0)
  const pick = (list: CatCard[], share: number) => list.filter((c) => !c.hidden && rand() < share)
  const top = (list: CatCard[], n: number) => [...list].filter((c) => !c.hidden && c.imageUrl).sort((a, b) => price(b) - price(a)).slice(0, n)

  const chosen = new Map<string, { c: CatCard; game: 'riftbound' | 'pokemon' }>()
  for (const c of pick(rift.filter((c) => c.setName === 'Origins'), 0.55)) chosen.set(c.id, { c, game: 'riftbound' })
  for (const c of top(rift, 8)) chosen.set(c.id, { c, game: 'riftbound' })
  for (const c of pick(poke.filter((c) => c.set === 'base1'), 0.5)) chosen.set(c.id, { c, game: 'pokemon' })
  for (const c of top(poke, 8)) chosen.set(c.id, { c, game: 'pokemon' })

  const graded = new Set(top(Array.from(chosen.values()).map((x) => x.c), 3).map((c) => c.id))
  // Most valuable first — the order a real shared Cardex is stored in (no prices are stored).
  return Array.from(chosen.values())
    .sort((a, b) => price(b.c) - price(a.c))
    .map(({ c, game }, i) => ({
      id: `tess-${i}`,
      game,
      name: c.name,
      set: c.setName,
      setCode: c.setCode ?? c.set ?? '',
      number: c.number,
      quantity: rand() < 0.2 ? 2 + Math.floor(rand() * 2) : 1,
      isFoil: !(c.marketPrice ?? 0) && (c.marketPriceFoil ?? 0) > 0,
      apiId: c.id,
      ...(c.imageUrl && { imageUrl: c.imageUrl }),
      ...(c.rarity && { rarity: c.rarity }),
      ...(graded.has(c.id) && { gradingCompany: 'PSA', grade: '10' }),
    }))
}

// ── Her profile ─────────────────────────────────────────────────────────────────────────────

async function ensureProfile(uid: string): Promise<{ username: string; cardex: boolean }> {
  const ref = doc(db, 'profiles', uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return { username: snap.data().username, cardex: !!snap.data().privacy?.cardex }
  for (const username of [WANTED_USERNAME, `${WANTED_USERNAME}${Math.floor(Math.random() * 1000)}`]) {
    if ((await getDoc(doc(db, 'usernames', username))).exists()) continue
    const batch = writeBatch(db)
    batch.set(doc(db, 'usernames', username), { uid })
    batch.set(ref, {
      uid, username, displayName: NAME, displayNameLower: NAME.toLowerCase(), photoURL: '',
      bio: 'Test collector for trying out Friends. Chasing every Origins alt art. 🃏',
      privacy: { cardex: true, badges: true }, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    await batch.commit()
    await shareCards(uid)
    return { username, cardex: true }
  }
  throw new Error('No free username for the test account')
}

async function shareCards(uid: string) {
  await setDoc(doc(db, 'shared_cardex', uid), { cards: JSON.stringify(await buildCards()), updatedAt: serverTimestamp() })
}

// ── Actions ─────────────────────────────────────────────────────────────────────────────────

type Action = 'status' | 'request' | 'accept' | 'unfriend' | 'toggle-cardex'

export async function POST(request: Request) {
  // Dev tools exist only on a local dev server (`npm run dev`) — never on the live site.
  if (process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const owner = await verifyOwnerRequest(request)
  if (owner instanceof NextResponse) return owner
  const { action } = (await request.json().catch(() => ({}))) as { action?: Action }

  try {
    const uid = await signIn(action === 'request')
    if (!uid) return NextResponse.json({ exists: false })
    const profile = await ensureProfile(uid)
    const fRef = doc(db, 'friendships', pairId(uid, owner.uid))
    const current = async () => {
      // Tess can read the pair's doc (she's in it); a missing doc reads as "none".
      const s = await getDoc(fRef).catch(() => null)
      return s?.exists() ? (s.data() as { status: string; requester: string }) : null
    }

    if (action === 'request') {
      if (await current()) await deleteDoc(fRef)
      await setDoc(fRef, {
        users: [uid, owner.uid].sort(), requester: uid, addressee: owner.uid, status: 'pending', createdAt: serverTimestamp(),
      })
    } else if (action === 'accept') {
      const f = await current()
      if (!f || f.status !== 'pending' || f.requester !== owner.uid) {
        return NextResponse.json({ error: 'Send Tess a friend request first (search "tess" on the Friends page).' }, { status: 400 })
      }
      await updateDoc(fRef, { status: 'accepted', respondedAt: serverTimestamp() })
    } else if (action === 'unfriend') {
      if (await current()) await deleteDoc(fRef)
    } else if (action === 'toggle-cardex') {
      const on = !profile.cardex
      await updateDoc(doc(db, 'profiles', uid), { privacy: { cardex: on, badges: true }, updatedAt: serverTimestamp() })
      if (on) await shareCards(uid)
      else await deleteDoc(doc(db, 'shared_cardex', uid))
      profile.cardex = on
    }

    const f = await current()
    return NextResponse.json({
      exists: true,
      uid,
      username: profile.username,
      cardex: profile.cardex,
      friendship: f ? { status: f.status, fromMe: f.requester === owner.uid } : null,
    })
  } catch (e) {
    console.error('Dev test friend:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
