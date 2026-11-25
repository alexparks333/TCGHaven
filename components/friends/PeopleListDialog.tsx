'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { X, Search, Loader2, UserPlus, Check, Clock, Lock, Users, ChevronRight } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from './FriendsProvider'
import { Avatar } from './Avatar'
import { useScrollLock } from '@/lib/useScrollLock'
import { loadFriendList, profilePath, sendFriendRequest, type FriendListEntry, type Profile } from '@/lib/firebase/friends'
import { communityPath, type CommunityEntry } from '@/lib/communities'

// A profile's Friends or Communities, as a searchable list (2026-11-24) — opened from the
// "N Friends" / "N Communities" buttons on a profile (ProfilePage). Friends: yours live from
// FriendsProvider; anyone else's from app/api/friends/list (their privacy.friends decides who may see
// it), with Add friend beside everyone you aren't friends with yet, and Add friend at the top to
// search every collector (the Friends popup's Add tab).
export function PeopleListDialog({ kind, profile, isMe, communities, onClose }: {
  kind: 'friends' | 'communities'
  profile: Profile
  isMe: boolean
  communities: CommunityEntry[]
  onClose: () => void
}) {
  const { user } = useAuth()
  const { friends: myFriends, byUid, openFriends } = useFriends()
  const me = user?.uid ?? ''
  const first = profile.displayName.split(' ')[0]
  const [q, setQ] = useState('')
  const [theirs, setTheirs] = useState<FriendListEntry[] | 'private' | 'error' | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  useScrollLock(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (kind !== 'friends' || isMe) return
    let live = true
    loadFriendList(profile.uid).then((r) => { if (live) setTheirs(r) }).catch(() => { if (live) setTheirs('error') })
    return () => { live = false }
  }, [kind, isMe, profile.uid])

  const people: FriendListEntry[] | null = kind !== 'friends' ? null
    : isMe
      ? myFriends.filter((f) => f.profile).map((f) => ({ uid: f.uid, username: f.profile!.username, displayName: f.profile!.displayName, photoURL: f.profile!.photoURL }))
      : Array.isArray(theirs) ? theirs : null

  const term = q.trim().toLowerCase()
  const shownPeople = useMemo(() => (people ?? []).filter((p) => !term || p.displayName.toLowerCase().includes(term) || p.username.toLowerCase().includes(term)), [people, term])
  const shownCommunities = useMemo(() => communities.filter((c) => !term || (c.name ?? '').toLowerCase().includes(term) || (c.tagline ?? '').toLowerCase().includes(term)), [communities, term])

  async function add(uid: string) {
    if (!me) return
    setSending(uid)
    try { await sendFriendRequest(me, uid) } catch (e) { console.error(e) } finally { setSending(null) }
  }

  /** What sits at the end of someone's row: you, already friends, a request either way, or Add friend */
  function action(uid: string) {
    if (uid === me) return <span className="text-xs font-semibold text-slate-500">You</span>
    const f = byUid.get(uid)
    if (f?.status === 'accepted') return <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check size={13} />Friends</span>
    if (f?.status === 'pending') {
      return <span className="flex items-center gap-1 text-xs font-semibold text-slate-500"><Clock size={13} />{f.requester === me ? 'Requested' : 'Wants to add you'}</span>
    }
    return (
      <button onClick={() => add(uid)} disabled={sending === uid}
        className="flex items-center gap-1 rounded-full bg-[#6b4a2e] text-[#f6ecd6] px-3 py-1.5 text-xs font-bold hover:bg-[#5a3d25] disabled:opacity-60">
        {sending === uid ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}Add friend
      </button>
    )
  }

  const title = kind === 'friends'
    ? (isMe ? 'Your friends' : `${first}’s friends`)
    : (isMe ? 'Your communities' : `${first}’s communities`)

  let body: React.ReactNode
  if (kind === 'communities') {
    body = shownCommunities.length === 0
      ? <Empty>{communities.length === 0 ? (isMe ? 'You haven’t joined a community yet.' : `${first} hasn’t joined a community yet.`) : 'No community matches that.'}</Empty>
      : shownCommunities.map((c) => (
        <Link key={c.uid} href={communityPath(c.uid)} onClick={onClose} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-800 transition-colors">
          <span className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: c.color || '#7a5230' }}><Users size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink truncate">{c.name || 'Community'}</span>
            {c.tagline && <span className="block text-xs text-slate-500 truncate">{c.tagline}</span>}
          </span>
          <ChevronRight size={16} className="text-slate-500 shrink-0" />
        </Link>
      ))
  } else if (theirs === 'private') {
    body = <Empty icon={<Lock size={20} />}>{first} shares their friends list with friends only.</Empty>
  } else if (theirs === 'error') {
    body = <Empty>Couldn’t load the list — please try again.</Empty>
  } else if (!people) {
    body = <div className="flex justify-center py-10 text-slate-500"><Loader2 size={20} className="animate-spin" /></div>
  } else if (shownPeople.length === 0) {
    body = <Empty>{people.length === 0 ? (isMe ? 'No friends yet — add some above.' : `${first} hasn’t added any friends yet.`) : 'Nobody matches that.'}</Empty>
  } else {
    body = shownPeople.map((p) => (
      <div key={p.uid} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800/60 transition-colors">
        <Link href={profilePath(p.uid, p.username)} onClick={onClose} className="flex items-center gap-3 min-w-0 flex-1">
          <Avatar seed={p.uid} name={p.displayName} photoURL={p.photoURL} size={40} />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-ink truncate">{p.displayName}</span>
            <span className="block text-xs text-slate-500 truncate">@{p.username}</span>
          </span>
        </Link>
        <span className="shrink-0">{action(p.uid)}</span>
      </div>
    ))
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={onClose} />
      <div role="dialog" aria-label={title}
        className="add-card-panel relative w-full md:max-w-[27.5rem] card-glass bg-slate-900 rounded-t-3xl md:rounded-2xl overflow-hidden flex flex-col h-[min(40rem,calc(100dvh-env(safe-area-inset-top)-0.75rem))] md:h-[min(40rem,calc(100dvh-2rem))]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="md:hidden mx-auto mt-2 mb-1 w-10 h-1 rounded-full bg-slate-700 shrink-0" />
        <div className="flex items-center justify-between gap-2 px-5 pt-3 md:pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-bold text-ink truncate">{title}</h2>
          <div className="flex items-center gap-1.5 shrink-0">
            {kind === 'friends' && (
              // every collector, not just this list — the Friends popup's Add tab
              <button onClick={() => { onClose(); openFriends('add') }}
                className="flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-bold text-ink hover:border-[#7a5230]">
                <UserPlus size={13} />Add friend
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="px-5 pb-3 shrink-0">
          <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 focus-within:border-violet-600">
            <Search size={15} className="text-slate-500 shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'friends' ? 'Search friends' : 'Search communities'}
              aria-label={kind === 'friends' ? 'Search friends' : 'Search communities'}
              className="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-slate-500" />
            {q && <button onClick={() => setQ('')} aria-label="Clear" className="text-slate-500 hover:text-ink"><X size={14} /></button>}
          </label>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-4">{body}</div>
      </div>
    </div>,
    document.body,
  )
}

function Empty({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-12 px-6 text-sm text-slate-500">
      {icon}
      {children}
    </div>
  )
}
