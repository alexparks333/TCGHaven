import { NextResponse } from 'next/server'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { callerUid } from '@/lib/firebase/verifyAdminRequest'
import { pairId, profilePath, toProfile } from '@/lib/firebase/friends'
import { sendPush, pushConfigured } from '@/lib/pushServer'

// POST { them, kind: 'request' | 'accepted' } — the app calls this right after sending or
// accepting a friend request (lib/firebase/friends.ts). It never trusts the caller's word: the
// friendship doc must really say so, and be fresh. One push per pair and kind an hour, so
// cancel-and-resend can't be used to spam someone. docs/push-notifications.md

export const dynamic = 'force-dynamic'

const FRESH_MS = 10 * 60_000
const GAP_MS = 60 * 60_000
const millis = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0

export async function POST(request: Request) {
  const me = await callerUid(request)
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const them = typeof body?.them === 'string' ? body.them : ''
  const kind = body?.kind === 'request' || body?.kind === 'accepted' ? body.kind : null
  if (!them || them === me || !kind) return NextResponse.json({ error: 'Expected { them, kind }' }, { status: 400 })
  if (!pushConfigured()) return NextResponse.json({ ok: true, sent: 0, reason: 'not set up' })

  await ensureAdminAuth()
  const pair = pairId(me, them)
  const f = (await getDoc(doc(db, 'friendships', pair))).data()
  const now = Date.now()
  const real = kind === 'request'
    ? f?.status === 'pending' && f.requester === me && f.addressee === them && now - millis(f.createdAt) < FRESH_MS
    : f?.status === 'accepted' && f.addressee === me && f.requester === them && now - millis(f.respondedAt) < FRESH_MS
  if (!real) return NextResponse.json({ ok: true, sent: 0, reason: 'no such request' })

  const logRef = doc(db, 'push_log', `${pair}_${kind}_${them}`)
  const last = Number((await getDoc(logRef)).data()?.at) || 0
  if (now - last < GAP_MS) return NextResponse.json({ ok: true, sent: 0, reason: 'sent recently' })

  const sender = toProfile(me, (await getDoc(doc(db, 'profiles', me))).data())
  const who = sender ? `${sender.displayName}${sender.username ? ` (@${sender.username})` : ''}` : 'A collector'
  const sent = kind === 'request'
    ? await sendPush(them, 'friendRequests', { title: 'New friend request', body: `${who} wants to be friends on TCGHaven`, link: '/friends?tab=requests' })
    : await sendPush(them, 'friendAccepts', { title: 'Friend request accepted', body: `${who} accepted your friend request`, link: sender ? profilePath(me, sender.username) : '/friends' })
  await setDoc(logRef, { at: now })
  return NextResponse.json({ ok: true, sent })
}
