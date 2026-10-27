'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2, UserPlus, PartyPopper } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends, type FriendEntry } from './FriendsProvider'
import { Avatar } from './Avatar'
import { acceptFriendRequest, removeFriendship, profilePath } from '@/lib/firebase/friends'

// Pops out in the top right when someone sends you a friend request (or accepts yours): Accept /
// Decline right there, or tap through to their profile. Each request pops once — which ones have
// been shown is remembered per account on this device, so a request that arrived while you were
// away pops the next time you open the app, and never again after that.

const SHOW_MS = 9000

type Toast =
  | { kind: 'request'; key: string; entry: FriendEntry }
  | { kind: 'accepted'; key: string; entry: FriendEntry }

function seenKey(uid: string) { return `tcghaven-seen-requests:${uid}` }
function readSeen(uid: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey(uid)) ?? '[]')) } catch { return new Set() }
}
function writeSeen(uid: string, seen: Set<string>) {
  try { localStorage.setItem(seenKey(uid), JSON.stringify(Array.from(seen).slice(-200))) } catch { /* storage blocked */ }
}

export function FriendRequestToast() {
  const { user } = useAuth()
  const { incoming, friends, ready } = useFriends()
  const [queue, setQueue] = useState<Toast[]>([])
  const pendingSent = useRef<Set<string> | null>(null)
  const { outgoing } = useFriends()

  // New incoming requests → a toast each (once per request).
  useEffect(() => {
    if (!user || !ready) return
    const seen = readSeen(user.uid)
    const fresh = incoming.filter((e) => e.profile && !seen.has(`${e.friendship.id}:${e.friendship.createdAt}`))
    if (!fresh.length) return
    fresh.forEach((e) => seen.add(`${e.friendship.id}:${e.friendship.createdAt}`))
    writeSeen(user.uid, seen)
    setQueue((q) => [...q, ...fresh.map((entry): Toast => ({ kind: 'request', key: `r:${entry.friendship.id}:${entry.friendship.createdAt}`, entry }))])
  }, [incoming, ready, user])

  // A request you sent was accepted (while the app is open) → a celebration toast.
  useEffect(() => {
    if (!ready) return
    const prev = pendingSent.current
    pendingSent.current = new Set(outgoing.map((e) => e.uid))
    if (!prev) return
    const accepted = friends.filter((e) => prev.has(e.uid) && e.profile)
    if (accepted.length) setQueue((q) => [...q, ...accepted.map((entry): Toast => ({ kind: 'accepted', key: `a:${entry.uid}:${Date.now()}`, entry }))])
  }, [outgoing, friends, ready])

  // Drop toasts for requests that went away elsewhere (accepted/declined on another device).
  useEffect(() => {
    setQueue((q) => q.filter((t) => t.kind !== 'request' || incoming.some((e) => e.uid === t.entry.uid)))
  }, [incoming])

  useEffect(() => { if (!user) setQueue([]) }, [user])

  const dismiss = (key: string) => setQueue((q) => q.filter((t) => t.key !== key))
  if (!queue.length) return null

  return (
    <div
      className="fixed z-[80] right-3 left-3 md:left-auto md:right-5 md:w-[360px] flex flex-col gap-2 pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
      aria-live="polite"
    >
      {queue.slice(0, 3).map((t) => <ToastCard key={t.key} toast={t} onDone={() => dismiss(t.key)} />)}
    </div>
  )
}

function ToastCard({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const { user } = useAuth()
  const router = useRouter()
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [result, setResult] = useState<'accepted' | null>(null)
  const [leaving, setLeaving] = useState(false)
  const { entry } = toast
  const name = entry.profile?.displayName ?? 'Someone'
  const first = name.split(' ')[0]

  const close = () => { setLeaving(true); setTimeout(onDone, 180) }

  useEffect(() => {
    if (paused || busy) return
    const t = setTimeout(close, result ? 2500 : SHOW_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, busy, result])

  async function act(kind: 'accept' | 'decline') {
    if (!user) return
    setBusy(kind)
    try {
      if (kind === 'accept') {
        await acceptFriendRequest(user.uid, entry.uid)
        setResult('accepted')
      } else {
        await removeFriendship(user.uid, entry.uid)
        close()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(null)
    }
  }

  function openProfile() {
    router.push(profilePath(entry.uid, entry.profile?.username))
    close()
  }

  const celebrating = toast.kind === 'accepted' || result === 'accepted'

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`friend-toast pointer-events-auto card-glass bg-slate-900 shadow-xl border-slate-700 p-3 ${leaving ? 'friend-toast-out' : ''}`}
    >
      <div className="flex items-start gap-3">
        <button onClick={openProfile} className="relative shrink-0" aria-label={`View ${name}'s profile`}>
          <Avatar seed={entry.uid} name={name} photoURL={entry.profile?.photoURL} size={44} />
          <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-slate-900 text-white ${celebrating ? 'bg-emerald-600' : 'bg-violet-600'}`}>
            {celebrating ? <Check size={11} strokeWidth={3} /> : <UserPlus size={11} />}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <button onClick={openProfile} className="text-left block w-full">
            <div className="text-sm font-bold text-ink truncate">{name}</div>
            <div className="text-xs text-slate-500">
              {toast.kind === 'accepted'
                ? 'Accepted your friend request'
                : result === 'accepted'
                  ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><PartyPopper size={12} />You&rsquo;re now friends!</span>
                  : 'Sent you a friend request'}
            </div>
          </button>
          {toast.kind === 'request' && !result && (
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => act('accept')}
                disabled={!!busy}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-60"
              >
                {busy === 'accept' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Accept
              </button>
              <button
                onClick={() => act('decline')}
                disabled={!!busy}
                className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold disabled:opacity-60"
              >
                {busy === 'decline' ? <Loader2 size={13} className="animate-spin mx-auto" /> : 'Decline'}
              </button>
            </div>
          )}
          {celebrating && (
            <button onClick={openProfile} className="mt-2 text-xs font-semibold text-violet-700 hover:text-violet-600">
              View {first}&rsquo;s profile →
            </button>
          )}
        </div>
        <button onClick={close} aria-label="Dismiss" className="-mt-1 -mr-1 w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800 shrink-0">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
