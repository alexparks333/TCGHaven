'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  X, Search, UserPlus, Check, Copy, Share2, Link2, Pencil, Loader2, Clock, UserMinus, Users, Inbox, Sparkles, Maximize2, MoreHorizontal, Home, QrCode,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends, type FriendsTab, type FriendEntry } from './FriendsProvider'
import { Avatar } from './Avatar'
import { InviteQrCode, ScanFriendCode } from './FriendQr'
import {
  searchProfiles, profilePath, sendFriendRequest, acceptFriendRequest, removeFriendship, changeUsername,
  type Profile,
} from '@/lib/firebase/friends'

export function FriendsDialog() {
  const { open, closeFriends, tab, setTab, incoming, friends } = useFriends()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFriends() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeFriends])

  if (!open) return null

  const tabs: { id: FriendsTab; label: string; icon: typeof Users; badge?: number }[] = [
    { id: 'friends', label: 'Friends', icon: Users, badge: friends.length || undefined },
    { id: 'requests', label: 'Requests', icon: Inbox, badge: incoming.length || undefined },
    { id: 'add', label: 'Add Friends', icon: UserPlus },
  ]

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={closeFriends} />
      <div
        role="dialog"
        aria-label="Friends"
        className="add-card-panel relative w-full md:max-w-[480px] card-glass bg-slate-900 rounded-t-3xl md:rounded-2xl flex flex-col h-[86dvh] md:h-[640px] md:max-h-[90dvh] overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="md:hidden mx-auto mt-2 mb-1 w-10 h-1 rounded-full bg-slate-700" />
        <div className="flex items-center px-5 pt-3 md:pt-5 pb-3">
          <h2 className="text-lg font-bold text-ink">Friends</h2>
          <Link
            href="/friends"
            onClick={closeFriends}
            className="ml-auto mr-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-ink hover:bg-slate-800 transition-colors"
          >
            <Maximize2 size={13} />Open full page
          </Link>
          <button onClick={closeFriends} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        <MyCard />

        <div className="px-5 pt-3">
          <div className="flex gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
            {tabs.map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-semibold transition-all',
                  tab === id ? 'bg-slate-800 text-ink shadow-sm' : 'text-slate-500 hover:text-ink',
                )}
              >
                <Icon size={14} />
                <span className="whitespace-nowrap">{label}</span>
                {badge !== undefined && (
                  <span className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none',
                    id === 'requests' ? 'bg-red-500 text-white' : 'bg-slate-700/70 text-slate-300',
                  )}>{badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {tab === 'friends' && <FriendsTabView />}
          {tab === 'requests' && <RequestsTabView />}
          {tab === 'add' && <AddTabView />}
        </div>
      </div>
    </div>
  )
}

// ── Your own card (name + editable @username) ───────────────────────────────────────────────

function MyCard() {
  const { user } = useAuth()
  const { me, setMe } = useFriends()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!user) return null

  async function save() {
    if (!me || !user) return
    setSaving(true); setError('')
    try {
      const username = await changeUsername(user.uid, me.username, value)
      setMe({ ...me, username })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-5 flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-br from-violet-600/15 via-slate-950 to-slate-950 border border-slate-800">
      <Avatar seed={user.uid} name={me?.displayName ?? user.displayName ?? ''} photoURL={me?.photoURL ?? user.photoURL ?? ''} size={44} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-ink truncate">{me?.displayName ?? user.displayName ?? 'You'}</div>
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); save() }} className="mt-1">
            <div className="flex items-center gap-1.5">
              <div className="flex items-center flex-1 min-w-0 bg-slate-950 border border-slate-700 focus-within:border-violet-600 rounded-lg px-2">
                <span className="text-sm text-slate-500">@</span>
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => { setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '')); setError('') }}
                  maxLength={20}
                  className="flex-1 min-w-0 bg-transparent py-1 text-sm text-ink outline-none"
                  aria-label="Username"
                />
              </div>
              <button type="submit" disabled={saving} className="w-7 h-7 flex items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50" aria-label="Save username">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button type="button" onClick={() => { setEditing(false); setError('') }} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800" aria-label="Cancel">
                <X size={14} />
              </button>
            </div>
            {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
          </form>
        ) : (
          <button
            onClick={() => { setValue(me?.username ?? ''); setEditing(true) }}
            disabled={!me}
            className="group flex items-center gap-1 text-xs text-slate-500 hover:text-ink transition-colors"
            title="Change your username"
          >
            {me ? `@${me.username}` : 'Setting up…'}
            {me && <Pencil size={11} className="opacity-50 group-hover:opacity-100" />}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────────────────────

function PersonRow({ uid, profile, children, onClick, active }: {
  uid: string
  profile: Profile | null
  children?: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const Body = (
    <>
      <Avatar seed={uid} name={profile?.displayName ?? ''} photoURL={profile?.photoURL} size={40} />
      <div className="min-w-0 flex-1 text-left">
        <div className="text-sm font-semibold text-ink truncate">{profile?.displayName ?? <span className="inline-block w-24 h-3 rounded bg-slate-800 animate-pulse" />}</div>
        {profile?.username && <div className="text-xs text-slate-500 truncate">@{profile.username}</div>}
      </div>
    </>
  )
  return (
    <div className={cn('flex items-center gap-3 p-2 -mx-2 rounded-xl transition-colors', active ? 'bg-slate-800/70' : onClick && 'hover:bg-slate-800/40')}>
      {onClick ? <button onClick={onClick} className="flex items-center gap-3 min-w-0 flex-1">{Body}</button> : <div className="flex items-center gap-3 min-w-0 flex-1">{Body}</div>}
      {children && <div className="flex items-center gap-1.5 shrink-0">{children}</div>}
    </div>
  )
}

function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError('')
    try { await fn() } catch (e) {
      console.error(e)
      setError('Something went wrong — please try again.')
    } finally { setBusy(null) }
  }
  return { busy, error, run }
}

function EmptyState({ icon: Icon, title, body, action }: { icon: typeof Users; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-4">
      <div className="w-14 h-14 rounded-2xl bg-slate-800/70 flex items-center justify-center text-slate-400 mb-3">
        <Icon size={26} />
      </div>
      <div className="text-sm font-bold text-ink">{title}</div>
      <div className="text-xs text-slate-500 mt-1 max-w-[260px]">{body}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Friends tab ─────────────────────────────────────────────────────────────────────────────

function FriendsTabView() {
  const { friends, ready, focusUid, setTab } = useFriends()
  const [filter, setFilter] = useState('')
  const { error, run, busy } = useAction()

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/^@/, '')
    if (!q) return friends
    return friends.filter((e) => e.profile?.displayName.toLowerCase().includes(q) || e.profile?.username.includes(q))
  }, [friends, filter])

  if (!ready) return <ListSkeleton />
  if (friends.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No friends yet"
        body="Send your invite link to a friend, or look them up by name — they'll show up right here."
        action={<button onClick={() => setTab('add')} className="btn-primary"><UserPlus size={15} />Add friends</button>}
      />
    )
  }

  return (
    <div>
      <div className="relative mb-2.5">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search friends"
          aria-label="Search your friends"
          className="w-full h-8 bg-slate-950 border border-slate-800 focus:border-violet-600 rounded-lg pl-7 pr-7 text-xs text-ink outline-none transition-colors"
        />
        {filter && (
          <button onClick={() => setFilter('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-ink">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {shown.map((e) => <FriendBadge key={e.uid} entry={e} highlighted={focusUid === e.uid} run={run} busy={busy} />)}
        {shown.length === 0 && <div className="text-center text-xs text-slate-500 py-6">No friends match “{filter}”</div>}
      </div>
      {error && <div className="text-xs text-red-600 mt-3 text-center">{error}</div>}
    </div>
  )
}

// One friend: who they are, "Visit Haven" (their profile) on the right, and a ⋯ menu in the
// corner holding Remove Friend (with a confirm step).
function FriendBadge({ entry: e, highlighted, run, busy }: {
  entry: FriendEntry
  highlighted: boolean
  run: (key: string, fn: () => Promise<void>) => Promise<void>
  busy: string | null
}) {
  const { user } = useAuth()
  const { closeFriends } = useFriends()
  const [menu, setMenu] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const first = e.profile?.displayName.split(' ')[0] ?? 'friend'

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  useEffect(() => {
    if (!menu) return
    const close = (ev: MouseEvent) => {
      if (!ref.current?.contains(ev.target as Node)) { setMenu(false); setConfirming(false) }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex items-center gap-3 rounded-2xl border bg-slate-950/60 pl-3 pr-2 py-2.5 transition-colors',
        highlighted ? 'border-violet-600' : 'border-slate-800',
      )}
    >
      <Avatar seed={e.uid} name={e.profile?.displayName ?? ''} photoURL={e.profile?.photoURL} size={44} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-ink truncate">{e.profile?.displayName ?? <span className="inline-block w-24 h-3 rounded bg-slate-800 animate-pulse" />}</div>
        {e.profile?.username && <div className="text-xs text-slate-500 truncate">@{e.profile.username}</div>}
      </div>
      <Link
        href={profilePath(e.uid, e.profile?.username)}
        onClick={closeFriends}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
      >
        <Home size={13} />Visit Haven
      </Link>
      <button
        onClick={() => { setMenu(!menu); setConfirming(false) }}
        aria-label={`More options for ${e.profile?.displayName ?? 'friend'}`}
        aria-expanded={menu}
        className="self-start -mt-1 shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800 transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <div className="absolute right-2 top-9 z-20 w-52 rounded-xl border border-slate-700 bg-slate-950 shadow-xl p-1.5">
          {confirming ? (
            <div className="p-1.5">
              <div className="text-xs text-slate-400 mb-2">Remove {first} from your friends?</div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => user && run(e.uid, () => removeFriendship(user.uid, e.uid))}
                  className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-500"
                >
                  {busy === e.uid && <Loader2 size={12} className="animate-spin" />}Remove
                </button>
                <button onClick={() => { setConfirming(false); setMenu(false) }} className="flex-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800">Keep</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-slate-300 hover:text-red-600 hover:bg-red-100/20">
              <UserMinus size={14} />Remove Friend
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-800 animate-pulse" />
          <div className="flex-1 space-y-1.5"><div className="w-32 h-3 rounded bg-slate-800 animate-pulse" /><div className="w-20 h-2.5 rounded bg-slate-800/70 animate-pulse" /></div>
        </div>
      ))}
    </div>
  )
}

// ── Requests tab ────────────────────────────────────────────────────────────────────────────

function RequestsTabView() {
  const { user } = useAuth()
  const { incoming, outgoing, ready, setTab } = useFriends()
  const { busy, error, run } = useAction()

  if (!ready) return <ListSkeleton />
  if (!incoming.length && !outgoing.length) {
    return (
      <EmptyState
        icon={Inbox}
        title="No requests right now"
        body="When someone wants to be your friend, you'll see it here."
        action={<button onClick={() => setTab('add')} className="btn-secondary"><UserPlus size={15} />Find friends</button>}
      />
    )
  }
  const me = user?.uid ?? ''

  return (
    <div className="flex flex-col gap-5">
      {incoming.length > 0 && (
        <section>
          <SectionLabel>Waiting on you · {incoming.length}</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {incoming.map((e: FriendEntry) => (
              <PersonRow key={e.uid} uid={e.uid} profile={e.profile}>
                <button
                  onClick={() => run(e.uid, () => acceptFriendRequest(me, e.uid))}
                  disabled={busy === e.uid}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-60"
                >
                  {busy === e.uid ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Accept
                </button>
                <button
                  onClick={() => run(e.uid + ':x', () => removeFriendship(me, e.uid))}
                  disabled={busy === e.uid + ':x'}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors disabled:opacity-60"
                >
                  {busy === e.uid + ':x' ? <Loader2 size={13} className="animate-spin" /> : 'Deny'}
                </button>
              </PersonRow>
            ))}
          </div>
        </section>
      )}
      {outgoing.length > 0 && (
        <section>
          <SectionLabel>Sent · {outgoing.length}</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {outgoing.map((e) => (
              <PersonRow key={e.uid} uid={e.uid} profile={e.profile}>
                <span className="hidden sm:flex items-center gap-1 text-[11px] text-slate-500"><Clock size={11} />Pending</span>
                <button
                  onClick={() => run(e.uid, () => removeFriendship(me, e.uid))}
                  disabled={busy === e.uid}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors"
                >
                  {busy === e.uid ? <Loader2 size={13} className="animate-spin" /> : 'Cancel'}
                </button>
              </PersonRow>
            ))}
          </div>
        </section>
      )}
      {error && <div className="text-xs text-red-600 text-center">{error}</div>}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{children}</div>
}

// ── Add Friends tab ─────────────────────────────────────────────────────────────────────────

function AddTabView() {
  const { user } = useAuth()
  const { byUid, cacheProfile, closeFriends } = useFriends()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Profile[] | null>(null)
  const [searching, setSearching] = useState(false)
  const { busy, error, run } = useAction()
  const seq = useRef(0)

  useEffect(() => {
    const q = term.trim()
    if (q.replace(/^@/, '').length < 2 || !user) { setResults(null); setSearching(false); return }
    setSearching(true)
    const mine = ++seq.current
    const t = setTimeout(() => {
      searchProfiles(q, user.uid)
        .then((r) => { if (mine === seq.current) { setResults(r); r.forEach(cacheProfile) } })
        .catch((e) => { console.error(e); if (mine === seq.current) setResults([]) })
        .finally(() => { if (mine === seq.current) setSearching(false) })
    }, 250)
    return () => clearTimeout(t)
  }, [term, user, cacheProfile])

  const me = user?.uid ?? ''

  function actionFor(p: Profile) {
    const f = byUid.get(p.uid)
    if (f?.status === 'accepted') {
      return <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-600"><Check size={13} />Friends</span>
    }
    if (f && f.addressee === me) {
      return (
        <button onClick={() => run(p.uid, () => acceptFriendRequest(me, p.uid))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold">
          {busy === p.uid ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Accept
        </button>
      )
    }
    if (f) {
      return (
        <button onClick={() => run(p.uid, () => removeFriendship(me, p.uid))} title="Cancel request" className="group flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs font-semibold">
          {busy === p.uid ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
          <span className="group-hover:hidden">Requested</span><span className="hidden group-hover:inline">Cancel</span>
        </button>
      )
    }
    return (
      <button onClick={() => run(p.uid, () => sendFriendRequest(me, p.uid))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors">
        {busy === p.uid ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}Add
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <InviteLinkCard />

      <section>
        <SectionLabel>In person?</SectionLabel>
        <ScanFriendCode onFound={closeFriends} />
      </section>

      <section>
        <SectionLabel>Find someone on TCGHaven</SectionLabel>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by name or @username"
            className="input-field pl-9 py-2.5"
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />}
        </div>
        <div className="mt-2 flex flex-col gap-0.5">
          {results?.map((p) => (
            <PersonRow key={p.uid} uid={p.uid} profile={p}>{actionFor(p)}</PersonRow>
          ))}
          {results && results.length === 0 && !searching && (
            <div className="text-center text-xs text-slate-500 py-5">
              No one matches “{term.trim()}”. Not on TCGHaven yet? Send them your invite link above.
            </div>
          )}
        </div>
        {error && <div className="text-xs text-red-600 mt-2 text-center">{error}</div>}
      </section>
    </div>
  )
}

// Your Haven link (/u/{username}) — it opens your profile, where they tap "Add" and you get a
// request to accept. (Invite links used to make you friends instantly; old ones now open your
// Haven too — see InvitePage.tsx.)
function InviteLinkCard() {
  const { me } = useFriends()
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)

  const link = me ? `${window.location.origin}${profilePath(me.uid, me.username)}` : ''
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked — the link is still selectable */ }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Join me on TCGHaven', text: 'Be my friend on TCGHaven — let\'s compare collections!', url: link })
    } catch { /* cancelled */ }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-violet-600/30 bg-gradient-to-br from-violet-600/15 via-slate-950 to-amber-500/10 p-4">
      <Sparkles size={64} className="absolute -right-3 -top-3 text-violet-600/10" />
      <div className="flex items-center gap-2 text-sm font-bold text-ink">
        <Link2 size={16} className="text-violet-600" />
        Your Haven link
      </div>
      <p className="text-xs text-slate-500 mt-1 mb-3 pr-6">
        Send this to a friend. It opens your Haven, where they can add you — you&rsquo;ll get a request to accept.
      </p>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 truncate font-mono select-all">
          {link || 'Loading your link…'}
        </div>
        <button
          onClick={copy}
          disabled={!link}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 shrink-0',
            copied ? 'bg-emerald-600 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white',
          )}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={() => setShowQr((v) => !v)}
          disabled={!link}
          aria-label="Show my QR code"
          aria-pressed={showQr}
          title="My QR code"
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-xl disabled:opacity-50 shrink-0 transition-colors',
            showQr ? 'bg-violet-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200',
          )}
        >
          <QrCode size={15} />
        </button>
        {canShare && (
          <button onClick={share} disabled={!link} aria-label="Share" className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50 shrink-0">
            <Share2 size={15} />
          </button>
        )}
      </div>
      {showQr && link && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <InviteQrCode link={link} />
          <span className="text-[11px] text-slate-500">Have your friend scan this to open your Haven and add you.</span>
        </div>
      )}
    </section>
  )
}
