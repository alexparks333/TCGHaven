import { NextResponse } from 'next/server'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { callerUid } from '@/lib/firebase/verifyAdminRequest'
import { pairId, toProfile, type FriendListEntry } from '@/lib/firebase/friends'

// GET ?uid= — someone's friends, for the profile's Friends list (components/friends/PeopleListDialog.tsx).
// Friendships are private in firestore.rules (only the two people, and the bot, read them), so the
// server reads them as the bot and hands back only accepted friends' public profile cards — when the
// owner's privacy.friends allows it (Everyone), or the caller is the owner or one of their friends.
export const dynamic = 'force-dynamic'

const MAX = 1000

export async function GET(request: Request) {
  const me = await callerUid(request)
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const uid = new URL(request.url).searchParams.get('uid') ?? ''
  if (!uid || uid.length > 128 || uid.includes('/')) return NextResponse.json({ error: 'Expected ?uid=' }, { status: 400 })

  await ensureAdminAuth()
  const owner = toProfile(uid, (await getDoc(doc(db, 'profiles', uid))).data())
  if (!owner) return NextResponse.json({ error: 'No such profile' }, { status: 404 })
  if (me !== uid && owner.privacy.friends === false) {
    const f = (await getDoc(doc(db, 'friendships', pairId(me, uid)))).data()
    if (f?.status !== 'accepted') return NextResponse.json({ error: 'Friends only' }, { status: 403 })
  }

  const snap = await getDocs(query(collection(db, 'friendships'), where('users', 'array-contains', uid)))
  const others = snap.docs
    .map((d) => d.data())
    .filter((x) => x.status === 'accepted' && Array.isArray(x.users))
    .map((x) => (x.users as string[]).find((u) => u !== uid))
    .filter((u): u is string => !!u)
    .slice(0, MAX)

  const friends: FriendListEntry[] = []
  for (let i = 0; i < others.length; i += 50) {
    const docs = await Promise.all(others.slice(i, i + 50).map((u) => getDoc(doc(db, 'profiles', u))))
    for (const d of docs) {
      const p = toProfile(d.id, d.data())
      if (p) friends.push({ uid: p.uid, username: p.username, displayName: p.displayName, photoURL: p.photoURL })
    }
  }
  friends.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return NextResponse.json({ friends }, { headers: { 'Cache-Control': 'no-store' } })
}
