'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  X, Search, UserPlus, Check, Copy, Share2, Link2, Pencil, Loader2, Clock, UserMinus, RefreshCw, Users,
  Sparkles, MoreHorizontal, Inbox, Send, Eye,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends, type FriendEntry } from '@/components/friends/FriendsProvider'
import { Avatar } from '@/components/friends/Avatar'
import {
  searchProfiles, profilePath, sendFriendRequest, acceptFriendRequest, removeFriendship, getInviteCode, changeUsername,
  type Profile,
} from '@/lib/firebase/friends'

// /friends — the Friends module. Sections, top to bottom: your profile, requests waiting on you,
// your friends, requests you sent; invite link + people search on the right (below on phones).
// Deep links from the sidebar: ?focus={uid} highlights a friend, ?add=1 jumps to search,
// ?tab=requests scrolls to requests.
export default function FriendsPage() {
  return (
    <AuthGuard>
      <FriendsModule />
    </AuthGuard>
  )
}

function FriendsModule() {
  const params = useSearchParams()
  const focus = params.get('focus')
  const wantsAdd = params.get('add') === '1'
  const wantsRequests = params.get('tab') === 'requests'
  const searchRef = useRef<HTMLInputElement>(null)
  const requestsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (wantsAdd) {
      searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      searchRef.current?.focus({ preventScroll: true })
    }
  }, [wantsAdd])

  useEffect(() => {
    if (wantsRequests) requestsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [wantsRequests])

  return (
    <div className="flex flex-col gap-6">
      <ProfileHero />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <RequestsSection sectionRef={requestsRef} />
          <FriendsSection focus={focus} />
          <SentSection />
        </div>
        <aside className="flex flex-col gap-6 lg:sticky lg:top-0">
          <InviteLinkCard />
          <FindPeople inputRef={searchRef} />
        </aside>
      </div>
    </div>
  )
}

// ── Profile hero ────────────────────────────────────────────────────────────────────────────

function ProfileHero() {
  const { user } = useAuth()
  const { me, setMe, friends, incoming, outgoing } = useFriends()
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

  const name = me?.displayName ?? user.displayName ?? 'You'
  const stats = [
    { label: 'Friends', value: friends.length },
    { label: 'Requests', value: incoming.length, hot: incoming.length > 0 },
    { label: 'Sent', value: outgoing.length },
  ]

  return (
    <section className="relative overflow-hidden card-glass p-5 md:p-6">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-600/20 via-transparent to-amber-500/10 pointer-events-none" />
      <Sparkles size={140} className="absolute -right-6 -top-8 text-violet-600/10 pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <Avatar seed={user.uid} name={name} photoURL={me?.photoURL ?? user.photoURL ?? ''} size={72} className="shadow-md ring-4 ring-slate-900" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Your profile</div>
            <h1 className="text-2xl font-bold text-ink truncate leading-tight">{name}</h1>
            {editing ? (
              <form onSubmit={(e) => { e.preventDefault(); save() }} className="mt-1 max-w-xs">
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
                  <button type="submit" disabled={saving} className="w-8 h-8 flex items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50" aria-label="Save username">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </button>
                  <button type="button" onClick={() => { setEditing(false); setError('') }} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800" aria-label="Cancel">
                    <X size={14} />
                  </button>
                </div>
                {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
              </form>
            ) : (
              <button
                onClick={() => { setValue(me?.username ?? ''); setEditing(true) }}
                disabled={!me}
                className="group flex items-center gap-1 text-sm text-slate-500 hover:text-ink transition-colors"
                title="Change your username"
              >
                {me ? `@${me.username}` : 'Setting up your profile…'}
                {me && <Pencil size={12} className="opacity-50 group-hover:opacity-100" />}
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-2 sm:gap-3 items-stretch">
          <Link href="/profile" className="hidden sm:flex flex-col items-center justify-center w-24 rounded-xl border border-slate-800 bg-slate-950/70 hover:border-violet-600/60 text-slate-500 hover:text-ink transition-colors">
            <Eye size={18} />
            <span className="text-[11px] font-semibold mt-1">My profile</span>
          </Link>
          {stats.map((s) => (
            <div key={s.label} className={cn(
              'flex-1 sm:flex-none sm:w-24 rounded-xl border px-3 py-2.5 text-center bg-slate-950/70',
              s.hot ? 'border-violet-600/50' : 'border-slate-800',
            )}>
              <div className={cn('text-xl font-bold leading-none', s.hot ? 'text-violet-700' : 'text-ink')}>{s.value}</div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────────────────────

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

function SectionHeader({ icon: Icon, title, count, children }: { icon: typeof Users; title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={16} className="text-slate-400" />
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {count !== undefined && <span className="text-xs font-bold text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded-full">{count}</span>}
      {children && <div className="ml-auto">{children}</div>}
    </div>
  )
}

function PersonRow({ uid, profile, children }: { uid: string; profile: Profile | null; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Avatar seed={uid} name={profile?.displayName ?? ''} photoURL={profile?.photoURL} size={40} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink truncate">{profile?.displayName ?? <span className="inline-block w-24 h-3 rounded bg-slate-800 animate-pulse" />}</div>
        {profile?.username && <div className="text-xs text-slate-500 truncate">@{profile.username}</div>}
      </div>
      {children && <div className="flex items-center gap-1.5 shrink-0">{children}</div>}
    </div>
  )
}

function sinceLabel(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// ── Requests waiting on you ─────────────────────────────────────────────────────────────────

function RequestsSection({ sectionRef }: { sectionRef: React.RefObject<HTMLElement> }) {
  const { user } = useAuth()
  const { incoming } = useFriends()
  const { busy, error, run } = useAction()
  if (!incoming.length) return null
  const me = user?.uid ?? ''

  return (
    <section ref={sectionRef} className="card-glass p-4 md:p-5 border-violet-600/40 scroll-mt-4">
      <SectionHeader icon={Inbox} title="Friend requests" count={incoming.length} />
      <div className="divide-y divide-slate-800">
        {incoming.map((e: FriendEntry) => (
          <PersonRow key={e.uid} uid={e.uid} profile={e.profile}>
            <button
              onClick={() => run(e.uid, () => acceptFriendRequest(me, e.uid))}
              disabled={busy === e.uid}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {busy === e.uid ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Accept
            </button>
            <button
              onClick={() => run(e.uid + ':x', () => removeFriendship(me, e.uid))}
              disabled={busy === e.uid + ':x'}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors"
            >
              {busy === e.uid + ':x' ? <Loader2 size={13} className="animate-spin" /> : 'Decline'}
            </button>
          </PersonRow>
        ))}
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </section>
  )
}

// ── Your friends ────────────────────────────────────────────────────────────────────────────

function FriendsSection({ focus }: { focus: string | null }) {
  const { friends, ready } = useFriends()
  const [filter, setFilter] = useState('')

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/^@/, '')
    if (!q) return friends
    return friends.filter((e) => e.profile?.displayName.toLowerCase().includes(q) || e.profile?.username.includes(q))
  }, [friends, filter])

  return (
    <section>
      <SectionHeader icon={Users} title="Your friends" count={ready ? friends.length : undefined}>
        {friends.length > 6 && (
          <div className="relative w-44 sm:w-56">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search friends" className="input-field pl-7 py-1.5 text-xs" />
          </div>
        )}
      </SectionHeader>

      {!ready ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="card-glass h-[88px] animate-pulse" />)}
        </div>
      ) : friends.length === 0 ? (
        <div className="card-glass border-dashed flex flex-col items-center text-center py-12 px-6">
          <div className="flex -space-x-3 mb-4">
            {['#8a5d36', '#66745a', '#7a4a5a'].map((c, i) => (
              <span key={c} className="w-12 h-12 rounded-full ring-4 ring-slate-900 flex items-center justify-center text-white/90" style={{ background: c, zIndex: 3 - i }}>
                <Users size={18} />
              </span>
            ))}
          </div>
          <div className="text-base font-bold text-ink">Collecting is better with friends</div>
          <div className="text-sm text-slate-500 mt-1 max-w-sm">Send your invite link to a friend, or look them up by name. They&rsquo;ll show up right here.</div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((e) => <FriendCard key={e.uid} entry={e} highlighted={focus === e.uid} />)}
          {shown.length === 0 && <div className="text-sm text-slate-500 py-6 col-span-full text-center">No friends match &ldquo;{filter}&rdquo;</div>}
        </div>
      )}
    </section>
  )
}

function FriendCard({ entry: e, highlighted }: { entry: FriendEntry; highlighted: boolean }) {
  const { user } = useAuth()
  const [menu, setMenu] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const { busy, error, run } = useAction()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlighted])

  useEffect(() => {
    if (!menu) return
    const close = (ev: MouseEvent) => { if (!ref.current?.contains(ev.target as Node)) { setMenu(false); setConfirming(false) } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const first = e.profile?.displayName.split(' ')[0] ?? 'friend'

  return (
    <div
      ref={ref}
      className={cn(
        'relative card-glass p-4 flex items-center gap-3 transition-all hover:-translate-y-0.5 hover:shadow-md',
        highlighted && 'ring-2 ring-violet-600',
      )}
    >
      {/* The whole card opens their profile; the ⋯ menu sits above this link */}
      <Link href={profilePath(e.uid, e.profile?.username)} className="absolute inset-0 rounded-2xl" aria-label={`View ${e.profile?.displayName ?? 'friend'}'s profile`} />
      <Avatar seed={e.uid} name={e.profile?.displayName ?? ''} photoURL={e.profile?.photoURL} size={52} />
      <div className="min-w-0 flex-1 pointer-events-none">
        <div className="text-sm font-bold text-ink truncate">{e.profile?.displayName ?? <span className="inline-block w-24 h-3 rounded bg-slate-800 animate-pulse" />}</div>
        {e.profile?.username && <div className="text-xs text-slate-500 truncate">@{e.profile.username}</div>}
        {e.friendship.respondedAt > 0 && (
          <div className="text-[11px] text-slate-500 mt-1">Friends since {sinceLabel(e.friendship.respondedAt)}</div>
        )}
      </div>
      <button
        onClick={() => { setMenu(!menu); setConfirming(false) }}
        aria-label={`Options for ${e.profile?.displayName ?? 'friend'}`}
        className="relative self-start -mr-1 -mt-1 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800 transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <div className="absolute right-3 top-11 z-20 w-52 rounded-xl border border-slate-700 bg-slate-950 shadow-xl p-1.5">
          {confirming ? (
            <div className="p-1.5">
              <div className="text-xs text-slate-400 mb-2">Remove {first} from your friends?</div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => user && run('rm', () => removeFriendship(user.uid, e.uid))}
                  className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-500"
                >
                  {busy === 'rm' && <Loader2 size={12} className="animate-spin" />}Remove
                </button>
                <button onClick={() => { setConfirming(false); setMenu(false) }} className="flex-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800">Keep</button>
              </div>
              {error && <div className="text-[11px] text-red-600 mt-1.5">{error}</div>}
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-slate-300 hover:text-red-600 hover:bg-red-100/20">
              <UserMinus size={14} />Remove friend
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Requests you sent ───────────────────────────────────────────────────────────────────────

function SentSection() {
  const { user } = useAuth()
  const { outgoing } = useFriends()
  const { busy, error, run } = useAction()
  if (!outgoing.length) return null
  const me = user?.uid ?? ''

  return (
    <section>
      <SectionHeader icon={Send} title="Sent requests" count={outgoing.length} />
      <div className="card-glass px-4 divide-y divide-slate-800">
        {outgoing.map((e) => (
          <PersonRow key={e.uid} uid={e.uid} profile={e.profile}>
            <span className="hidden sm:flex items-center gap-1 text-[11px] text-slate-500"><Clock size={11} />Waiting</span>
            <button
              onClick={() => run(e.uid, () => removeFriendship(me, e.uid))}
              disabled={busy === e.uid}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors"
            >
              {busy === e.uid ? <Loader2 size={13} className="animate-spin" /> : 'Cancel'}
            </button>
          </PersonRow>
        ))}
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </section>
  )
}

// ── Invite link ─────────────────────────────────────────────────────────────────────────────

function InviteLinkCard() {
  const { user } = useAuth()
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!user) return
    getInviteCode(user.uid).then(setCode).catch((e) => { console.error(e); setFailed(true) })
  }, [user])

  const link = code ? `${window.location.origin}/invite/${code}` : ''
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

  async function reset() {
    if (!user) return
    setResetting(true)
    try { setCode(await getInviteCode(user.uid, true)) } catch (e) { console.error(e) } finally { setResetting(false) }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-violet-600/30 bg-gradient-to-br from-violet-600/15 via-slate-900 to-amber-500/10 p-5 shadow-sm">
      <Sparkles size={72} className="absolute -right-3 -top-3 text-violet-600/10" />
      <div className="flex items-center gap-2 text-base font-bold text-ink">
        <Link2 size={17} className="text-violet-600" />
        Invite friends
      </div>
      <p className="text-xs text-slate-500 mt-1 mb-3 pr-6">
        Send your link to a friend. When they open it, you&rsquo;re friends instantly — no request needed.
      </p>
      <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 truncate font-mono select-all">
        {failed ? 'Couldn’t load your link' : link || 'Creating your link…'}
      </div>
      <div className="flex gap-2 mt-2">
        <button
          onClick={copy}
          disabled={!link}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50',
            copied ? 'bg-emerald-600 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white',
          )}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied!' : 'Copy link'}
        </button>
        {canShare && (
          <button onClick={share} disabled={!link} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold disabled:opacity-50">
            <Share2 size={15} />Share
          </button>
        )}
      </div>
      <button onClick={reset} disabled={!code || resetting} className="mt-3 flex items-center gap-1 text-[11px] text-slate-500 hover:text-ink transition-colors disabled:opacity-50">
        <RefreshCw size={11} className={cn(resetting && 'animate-spin')} />
        Get a new link (the old one stops working)
      </button>
    </section>
  )
}

// ── Find people ─────────────────────────────────────────────────────────────────────────────

function FindPeople({ inputRef }: { inputRef: React.RefObject<HTMLInputElement> }) {
  const { user } = useAuth()
  const { byUid, cacheProfile } = useFriends()
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
    <section className="card-glass p-5">
      <div className="flex items-center gap-2 text-base font-bold text-ink mb-3">
        <UserPlus size={17} className="text-slate-400" />
        Find people
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Name or @username"
          className="input-field pl-9 py-2.5"
          autoComplete="off"
          spellCheck={false}
        />
        {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin" />}
      </div>
      {results === null ? (
        <p className="text-xs text-slate-500 mt-2.5">Type at least 2 letters to search everyone on TCGHaven.</p>
      ) : results.length === 0 && !searching ? (
        <p className="text-xs text-slate-500 mt-3 text-center">No one matches &ldquo;{term.trim()}&rdquo;. Not on TCGHaven yet? Send them your invite link.</p>
      ) : (
        <div className="mt-1.5 divide-y divide-slate-800">
          {results.map((p) => <PersonRow key={p.uid} uid={p.uid} profile={p}>{actionFor(p)}</PersonRow>)}
        </div>
      )}
      {error && <div className="text-xs text-red-600 mt-2 text-center">{error}</div>}
    </section>
  )
}
