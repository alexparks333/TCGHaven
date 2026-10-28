'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen, Lock, Award, TrendingUp, Pencil, Check, Loader2, UserPlus, Clock, Eye, EyeOff, ChevronRight, Users,
  Layers, LayoutGrid, Sparkles, Settings, X,
} from 'lucide-react'
import { cn, RARITY_LABELS_BY_GAME, zoomGlowColor } from '@/lib/utils'
import { useScrollLock } from '@/lib/useScrollLock'
import CardexPage, { CardZoomOverlay, RARITY_COLORS, bestSlab, SlabTileOverlay, type ZoomCardData, type SlabInfo } from './CardexPage'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { useFriends } from '@/components/friends/FriendsProvider'
import { Avatar } from '@/components/friends/Avatar'
import { SettingsDialog } from '@/components/friends/SettingsDialog'
import { BadgeLibrary } from '@/components/badges/BadgeLibrary'
import { loadBadges, type SharedBadges } from '@/lib/firebase/badges'
import { GAME_COLORS, GAME_LABELS, type Card, type Game } from '@/lib/types'
import {
  getProfile, resolveUsername, profilePath, updateProfileDetails, loadFriendCardex, sendFriendRequest, acceptFriendRequest, removeFriendship,
  BIO_MAX, type Profile, type ProfilePrivacy, type Friendship,
} from '@/lib/firebase/friends'

// /profile — your profile, the page your friends see. You curate it: a short bio and what friends
// may look at (Cardex, Badges). The Portfolio is never shown to anyone else.
// /profile/{uid} — someone else's profile, showing only what they share.
// /u/{username} — the same, by @username.
export default function ProfilePage({ uid, username }: { uid?: string; username?: string }) {
  return (
    <AuthGuard>
      {username ? <ByUsername username={username} /> : <ProfileBody uid={uid} />}
    </AuthGuard>
  )
}

function ByUsername({ username }: { username: string }) {
  const [uid, setUid] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setUid(undefined)
    resolveUsername(username).then((u) => { if (live) setUid(u) }).catch(() => { if (live) setUid(null) })
    return () => { live = false }
  }, [username])
  if (uid === undefined) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
  if (uid === null) return <NotFound />
  return <ProfileBody uid={uid} viaUsername={username} />
}

function NotFound() {
  return (
    <div className="card-glass max-w-md mx-auto text-center py-14 px-6 mt-10">
      <div className="text-lg font-bold text-ink">Profile not found</div>
      <p className="text-sm text-slate-500 mt-1">No one on TCGHaven has that username.</p>
      <Link href="/friends" className="btn-secondary w-fit mx-auto mt-5">Back to Friends</Link>
    </div>
  )
}

function ProfileBody({ uid, viaUsername }: { uid?: string; viaUsername?: string }) {
  const { user } = useAuth()
  const { me, setMe, byUid } = useFriends()
  const isMe = !uid || uid === user?.uid
  const [other, setOther] = useState<Profile | null | undefined>(undefined)

  useEffect(() => {
    if (isMe || !uid) return
    let live = true
    setOther(undefined)
    getProfile(uid).then((p) => { if (live) setOther(p) }).catch(() => { if (live) setOther(null) })
    return () => { live = false }
  }, [uid, isMe])

  const profile = isMe ? me : other

  // Opened by a username they've since changed: show their current one in the address bar.
  useEffect(() => {
    if (!viaUsername || !profile?.username || profile.username === viaUsername.toLowerCase()) return
    window.history.replaceState(window.history.state, '', profilePath(profile.uid, profile.username))
  }, [viaUsername, profile?.username, profile?.uid])

  if (profile === undefined || (isMe && !profile)) {
    return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
  }
  if (!profile) return <NotFound />

  const friendship = isMe ? undefined : byUid.get(profile.uid)
  const isFriend = friendship?.status === 'accepted'

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <ProfileHeader profile={profile} isMe={isMe} onSaved={setMe} friendship={friendship} />
      <Showcase profile={profile} isMe={isMe} isFriend={isFriend} />
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────────────────────────────

function ProfileHeader({ profile, isMe, onSaved, friendship }: {
  profile: Profile
  isMe: boolean
  onSaved: (p: Profile) => void
  friendship: Friendship | undefined
}) {
  const { user } = useAuth()
  const { friends } = useFriends()
  const [editing, setEditing] = useState(false)
  const [bio, setBio] = useState(profile.bio)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'deny' | 'cancel' | 'add' | null>(null)
  const [error, setError] = useState('')
  // Settings opens from the ⚙️ here; the old /settings address redirects to /profile?settings=1.
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    if (!isMe) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('settings') !== '1') return
    setSettingsOpen(true)
    params.delete('settings')
    window.history.replaceState(window.history.state, '', window.location.pathname + (params.size ? `?${params}` : ''))
  }, [isMe])

  async function saveBio() {
    setSaving(true); setError('')
    try {
      await updateProfileDetails(profile.uid, { bio })
      onSaved({ ...profile, bio: bio.trim().slice(0, BIO_MAX) })
      setEditing(false)
    } catch (e) {
      console.error(e); setError('Couldn’t save — please try again.')
    } finally { setSaving(false) }
  }

  async function act(key: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(key); setError('')
    try { await fn() } catch (e) { console.error(e); setError('Something went wrong — please try again.') } finally { setBusy(null) }
  }

  const me = user?.uid ?? ''
  const first = profile.displayName.split(' ')[0]

  let action: React.ReactNode = null
  if (!isMe) {
    if (friendship?.status === 'accepted') {
      action = (
        <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600/15 text-emerald-700 text-sm font-semibold">
          <Check size={15} />Friends
        </span>
      )
    } else if (friendship && friendship.addressee === me) {
      // They sent you a request: accept or deny it right here
      action = (
        <div className="flex items-center gap-2">
          <button onClick={() => act('accept', () => acceptFriendRequest(me, profile.uid))} disabled={!!busy} className="btn-primary disabled:opacity-60">
            {busy === 'accept' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Accept request
          </button>
          <button onClick={() => act('deny', () => removeFriendship(me, profile.uid))} disabled={!!busy} className="btn-secondary disabled:opacity-60">
            {busy === 'deny' ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}Deny
          </button>
        </div>
      )
    } else if (friendship) {
      action = <button onClick={() => act('cancel', () => removeFriendship(me, profile.uid))} disabled={!!busy} className="btn-secondary" title="Cancel request">{busy ? <Loader2 size={15} className="animate-spin" /> : <Clock size={15} />}Requested</button>
    } else {
      action = <button onClick={() => act('add', () => sendFriendRequest(me, profile.uid))} disabled={!!busy} className="btn-primary">{busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}Add {first}</button>
    }
  }

  return (
    <section className="relative overflow-hidden card-glass">
      {/* Banner */}
      <div className="relative h-24 md:h-28 bg-gradient-to-br from-violet-600/30 via-slate-800 to-slate-700/70 overflow-hidden">
        <Sparkles size={120} className="absolute right-6 -top-6 text-white/15" />
        <Sparkles size={60} className="absolute right-40 top-10 text-white/10" />
        {isMe && (
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
            className="absolute top-3 right-3 flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-xl bg-slate-950/80 backdrop-blur-sm border border-slate-700 text-sm font-semibold text-ink hover:bg-slate-950 shadow-sm transition-colors"
          >
            <Settings size={15} />Settings
          </button>
        )}
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <div className="px-5 md:px-6 pb-5 flex flex-col md:flex-row gap-5">
        {/* Identity */}
        <div className="min-w-0 flex-1 -mt-12">
          <div className="flex items-end justify-between gap-3">
            <Avatar seed={profile.uid} name={profile.displayName} photoURL={profile.photoURL} size={96} className="ring-4 ring-slate-900 shadow-lg" />
            {action && <div className="mb-1 md:hidden">{action}</div>}
          </div>
          <h1 className="text-2xl font-bold text-ink mt-3 leading-tight">{profile.displayName}</h1>
          <div className="text-sm text-slate-500">@{profile.username}</div>

          {editing ? (
            <div className="mt-3 max-w-md">
              <textarea
                autoFocus
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
                rows={3}
                placeholder="What do you collect? Favorite set, chase card, local shop…"
                className="input-field resize-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-slate-500 mr-auto">{bio.length}/{BIO_MAX}</span>
                <button onClick={() => { setEditing(false); setBio(profile.bio) }} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-800">Cancel</button>
                <button onClick={saveBio} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-60">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Save
                </button>
              </div>
            </div>
          ) : profile.bio ? (
            <p className="text-sm text-slate-300 mt-3 whitespace-pre-line max-w-md">
              {profile.bio}
              {isMe && (
                <button onClick={() => setEditing(true)} className="inline-flex align-middle ml-1.5 text-slate-500 hover:text-ink" aria-label="Edit bio"><Pencil size={12} /></button>
              )}
            </p>
          ) : isMe ? (
            <button onClick={() => setEditing(true)} className="mt-3 flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink border border-dashed border-slate-700 hover:border-violet-600 rounded-xl px-3 py-2 transition-colors">
              <Pencil size={13} />Add a short bio
            </button>
          ) : null}

          {!isMe && friendship?.status === 'accepted' && friendship.respondedAt > 0 && (
            <div className="flex items-center gap-1.5 mt-4 text-xs text-slate-500">
              <Users size={13} />Friends since {new Date(friendship.respondedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </div>
          )}
          {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
        </div>

        {/* Right side: your privacy switches, or the friend action */}
        {isMe ? (
          <div className="flex gap-3 items-start md:mt-4 shrink-0">
            {/* Friend count, in the Friends page's stat-tile style */}
            <Link
              href="/friends"
              className="w-24 shrink-0 rounded-xl border border-slate-800 bg-slate-950/70 hover:border-slate-700 px-3 py-2.5 text-center transition-colors"
            >
              <div className="text-xl font-bold leading-none text-ink">{friends.length}</div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">{friends.length === 1 ? 'Friend' : 'Friends'}</div>
            </Link>
            <PrivacyBox profile={profile} onSaved={onSaved} />
          </div>
        ) : action ? (
          <div className="hidden md:flex items-start pt-4">{action}</div>
        ) : null}
      </div>
    </section>
  )
}

// ── What others can see (compact, inside your header) ─────────────────────────────────────

function PrivacyBox({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [saving, setSaving] = useState<keyof ProfilePrivacy | null>(null)
  const [error, setError] = useState('')

  async function toggle(key: keyof ProfilePrivacy) {
    const privacy = { ...profile.privacy, [key]: !profile.privacy[key] }
    setSaving(key); setError('')
    try {
      await updateProfileDetails(profile.uid, { privacy })
      onSaved({ ...profile, privacy })
    } catch (e) {
      console.error(e); setError('Couldn’t save — please try again.')
    } finally { setSaving(null) }
  }

  const rows: { key: keyof ProfilePrivacy; icon: typeof Award; label: string; hint: string }[] = [
    { key: 'cardex', icon: BookOpen, label: 'Cardex', hint: 'Which cards you own — never prices or what you paid' },
    { key: 'badges', icon: Award, label: 'Badges', hint: 'Your Haven Badges pin book' },
  ]

  return (
    <div className="flex-1 md:flex-none md:w-[290px] min-w-0 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-center gap-1.5 px-1 mb-2">
        <Eye size={13} className="text-slate-500" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Public on your Haven</span>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map(({ key, icon: Icon, label, hint }) => {
          const on = profile.privacy[key]
          return (
            <button
              key={key}
              onClick={() => toggle(key)}
              disabled={saving === key}
              role="switch"
              aria-checked={on}
              title={hint}
              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-slate-800/60 transition-colors text-left"
            >
              <Icon size={15} className={on ? 'text-violet-700' : 'text-slate-500'} />
              <span className="text-sm font-semibold text-ink flex-1">{label}</span>
              <Switch on={on} saving={saving === key} />
            </button>
          )
        })}
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5" title="Your values and P&L are only ever for you">
          <TrendingUp size={15} className="text-slate-500" />
          <span className="text-sm font-semibold text-ink flex-1">Portfolio</span>
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Lock size={11} />Private</span>
        </div>
      </div>
      {error && <div className="text-[11px] text-red-600 mt-1.5 px-1">{error}</div>}
    </div>
  )
}

function Switch({ on, saving }: { on: boolean; saving: boolean }) {
  return (
    <span className={cn('relative w-9 h-5 rounded-full shrink-0 transition-colors', on ? 'bg-violet-600' : 'bg-slate-700')}>
      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all flex items-center justify-center', on ? 'left-[18px]' : 'left-0.5')}>
        {saving && <Loader2 size={10} className="animate-spin text-slate-500" />}
      </span>
    </span>
  )
}

// ── Showcase: a framed mini Cardex, with a Badges tab ──────────────────────────────────────

type ShowcaseTab = 'cardex' | 'badges'
type CardexView = 'top' | 'full'

function Showcase({ profile, isMe, isFriend }: { profile: Profile; isMe: boolean; isFriend: boolean }) {
  const [tab, setTab] = useState<ShowcaseTab>('cardex')
  // Cardex tab: "Top cards" (best-first showcase) or "Full Cardex" (every set, owned and missing)
  const [view, setView] = useState<CardexView>('top')
  const cardexVisible = isMe || profile.privacy.cardex
  const shared = tab === 'cardex' ? profile.privacy.cardex : profile.privacy.badges
  const tabs: { id: ShowcaseTab; label: string; icon: typeof Award }[] = [
    { id: 'cardex', label: 'Cardex', icon: BookOpen },
    { id: 'badges', label: 'Badges', icon: Award },
  ]

  return (
    <section className="showcase-frame">
      <div className="showcase-inner p-4 md:p-6">
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex gap-1 p-1 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-inner">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all',
                  tab === id ? 'bg-violet-600 text-white shadow-md' : 'text-slate-500 hover:text-ink',
                )}
              >
                <Icon size={15} />{label}
              </button>
            ))}
          </div>
          {isMe && (
            <span className={cn(
              'flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full',
              shared ? 'bg-emerald-600/15 text-emerald-700' : 'bg-slate-800 text-slate-500',
            )}>
              {shared ? <Eye size={11} /> : <EyeOff size={11} />}{shared ? 'Public' : 'Only you'}
            </span>
          )}
          {tab === 'cardex' && cardexVisible && (
            <div className="ml-auto flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800">
              {([['top', 'Top cards', Sparkles], ['full', 'Full Cardex', LayoutGrid]] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-violet-600',
                    view === id ? 'bg-slate-800 text-ink shadow-sm' : 'text-slate-500 hover:text-ink',
                  )}
                >
                  <Icon size={13} />{label}
                </button>
              ))}
            </div>
          )}
        </div>
        {tab === 'cardex'
          ? <CardexTab profile={profile} isMe={isMe} isFriend={isFriend} view={view} />
          : <BadgesTab profile={profile} isMe={isMe} isFriend={isFriend} />}
      </div>
    </section>
  )
}

function Locked({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-12">
      <div className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-slate-400">
        <Lock size={24} />
      </div>
      <div className="text-sm text-slate-500 mt-3 max-w-xs">{children}</div>
    </div>
  )
}

const FIRST_PAGE = 18
const PAGE = 24

type ShowcaseCard = Card & { copies: number; slab?: SlabInfo }

// A self-contained mini Cardex: everything happens on this page — no links into the app's own
// Cardex, which a visitor has no access to. Filter by game and set, page through in place, and
// click a card for the same spin-around zoom the Cardex has (without prices — profiles never show
// any).
function CardexTab({ profile, isMe, isFriend, view }: { profile: Profile; isMe: boolean; isFriend: boolean; view: CardexView }) {
  const ownCards = useStore((s) => s.cards)
  const [friendCards, setFriendCards] = useState<Card[] | 'private' | undefined>(undefined)
  const [game, setGame] = useState<Game | 'all'>('all')
  const [set, setSet] = useState('')
  const [limit, setLimit] = useState(FIRST_PAGE)
  const [zoom, setZoom] = useState<ZoomCardData | null>(null)
  useScrollLock(zoom !== null)
  const canView = isMe || profile.privacy.cardex

  useEffect(() => {
    if (isMe || !canView) return
    let live = true
    loadFriendCardex(profile.uid).then((r) => { if (live) setFriendCards(r) })
    return () => { live = false }
  }, [isMe, canView, profile.uid])

  useEffect(() => { setLimit(FIRST_PAGE) }, [game, set])

  // One tile per distinct card, best first: your own by today's price; a friend's copy is
  // already stored most-valuable-first (without the prices).
  const unique = useMemo(() => {
    const src = isMe
      ? [...ownCards].sort((a, b) => (b.currentPrice ?? 0) - (a.currentPrice ?? 0))
      : Array.isArray(friendCards) ? friendCards : []
    const groups = new Map<string, Card[]>()
    for (const c of src) {
      const key = c.apiId || `${c.game}|${c.set}|${c.number}|${c.name}`
      const list = groups.get(key)
      if (list) list.push(c)
      else groups.set(key, [c])
    }
    return Array.from(groups.values()).map((copies): ShowcaseCard => ({
      ...copies[0],
      copies: copies.reduce((n, c) => n + (c.quantity || 1), 0),
      slab: bestSlab(copies),
    }))
  }, [isMe, ownCards, friendCards])

  const viewer = useMemo(
    () => ({ cards: isMe ? ownCards : Array.isArray(friendCards) ? friendCards : [] }),
    [isMe, ownCards, friendCards],
  )

  const first = profile.displayName.split(' ')[0]
  if (!canView || friendCards === 'private') {
    return (
      <Locked>
        {`${first} keeps their Cardex private.`}
      </Locked>
    )
  }
  if (!isMe && friendCards === undefined) {
    return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-500" /></div>
  }
  if (unique.length === 0) {
    return <Locked>{isMe ? 'Add cards to your inventory and they’ll show up here.' : `${first} hasn’t added any cards yet.`}</Locked>
  }

  const games = Array.from(new Set(unique.map((c) => c.game)))
  const counts = new Map<Game, number>()
  unique.forEach((c) => counts.set(c.game, (counts.get(c.game) ?? 0) + 1))
  const inGame = game === 'all' ? unique : unique.filter((c) => c.game === game)
  const sets = game === 'all' ? [] : Array.from(
    inGame.reduce((m, c) => m.set(c.set, (m.get(c.set) ?? 0) + 1), new Map<string, number>()).entries(),
  ).sort((a, b) => b[1] - a[1])
  const shown = set ? inGame.filter((c) => c.set === set) : inGame
  const setCount = new Set(unique.map((c) => `${c.game}|${c.set}`)).size

  function open(el: HTMLElement, c: ShowcaseCard) {
    const color = GAME_COLORS[c.game]
    const label = RARITY_LABELS_BY_GAME[c.game]?.[c.rarity ?? ''] ?? c.rarity ?? ''
    setZoom({
      imageUrl: c.imageUrl ?? '',
      name: c.name,
      number: c.number,
      rarityLabel: label.replace('_', ' '),
      rarityColor: RARITY_COLORS[c.rarity ?? ''] ?? '#7a6a55',
      marketPrice: 0,
      owned: true,
      quantity: c.copies,
      isFoil: c.isFoil,
      glowColor: zoomGlowColor(c.game, c.rarity ?? '', color),
      slab: c.slab,
      setName: c.set,
      ebayCard: { name: c.name, number: c.number, set: c.set, game: c.game, gradingCompany: c.slab?.company, grade: c.slab?.grade, language: c.language },
      originRect: el.getBoundingClientRect(),
    })
  }

  const stats = [
    { icon: LayoutGrid, value: unique.length.toLocaleString(), label: 'cards' },
    { icon: Layers, value: setCount.toLocaleString(), label: setCount === 1 ? 'set' : 'sets' },
    { icon: BookOpen, value: games.length.toString(), label: games.length === 1 ? 'game' : 'games' },
  ]

  if (view === 'full') return <CardexPage viewer={viewer} />

  return (
    <div>
      {/* Stats */}
      <div className="flex flex-wrap gap-2 mb-4">
        {stats.map(({ icon: Icon, value, label }) => (
          <div key={label} className="flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <Icon size={14} className="text-violet-600" />
            <span className="text-sm font-bold text-ink">{value}</span>
            <span className="text-xs text-slate-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Game chips, then that game's sets */}
      {games.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-5">
          <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0 [scrollbar-width:none]">
            {(['all', ...games] as const).map((g) => {
              const active = game === g
              const color = g === 'all' ? '#8a5d36' : GAME_COLORS[g]
              return (
                <button
                  key={g}
                  onClick={() => { setGame(g); setSet('') }}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all', active ? 'shadow-sm' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-ink')}
                  style={active ? { backgroundColor: color + '26', borderColor: color + '80', color } : undefined}
                >
                  {g !== 'all' && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}
                  {g === 'all' ? 'All games' : GAME_LABELS[g]}
                  <span className="opacity-60">{g === 'all' ? unique.length : counts.get(g)}</span>
                </button>
              )
            })}
          </div>
          {sets.length > 1 && (
            <div className="relative sm:ml-auto">
              <select
                value={set}
                onChange={(e) => setSet(e.target.value)}
                className="appearance-none bg-slate-900 border border-slate-800 rounded-lg pl-3 pr-8 py-1.5 text-xs font-semibold text-ink outline-none cursor-pointer max-w-[240px]"
              >
                <option value="">All sets ({sets.length})</option>
                {sets.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
              </select>
              <ChevronRight size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none text-slate-500" />
            </div>
          )}
        </div>
      )}

      {/* The binder page */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 md:gap-4">
        {shown.slice(0, limit).map((c) => (
          <button
            key={c.apiId || c.id}
            onClick={(e) => open(e.currentTarget, c)}
            title={c.name}
            className="showcase-card relative block rounded-lg overflow-hidden bg-slate-800 cursor-pointer"
            style={{ aspectRatio: '5/7', outline: c.slab ? '1px solid #9aa4b1' : `2px solid ${GAME_COLORS[c.game]}55`, outlineOffset: 1 }}
          >
            {c.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.imageUrl} alt={c.name} loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-2 text-center text-[11px] font-semibold text-slate-400">{c.name}</div>
            )}
            {c.slab && <SlabTileOverlay slab={c.slab} />}
            {c.copies > 1 && (
              <span className="absolute top-1 right-1 text-[10px] font-bold text-white bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-full leading-none">×{c.copies}</span>
            )}
          </button>
        ))}
      </div>
      {shown.length > limit && (
        <div className="flex flex-col items-center mt-5 gap-1">
          <button onClick={() => setLimit((n) => n + PAGE)} className="btn-secondary">
            Show more
          </button>
          <span className="text-[11px] text-slate-500">Showing {Math.min(limit, shown.length).toLocaleString()} of {shown.length.toLocaleString()}</span>
        </div>
      )}
      <CardZoomOverlay data={zoom} onClose={() => setZoom(null)} viewOnly />
    </div>
  )
}

// ── Badges: the Haven Badges pin book ──────────────────────────────────────────────────────

function BadgesTab({ profile, isMe, isFriend }: { profile: Profile; isMe: boolean; isFriend: boolean }) {
  const { myBadges } = useFriends()
  const [theirs, setTheirs] = useState<SharedBadges | 'private' | undefined>(undefined)
  const canView = isMe || profile.privacy.badges

  useEffect(() => {
    if (isMe || !canView) return
    let live = true
    loadBadges(profile.uid).then((b) => { if (live) setTheirs(b) })
    return () => { live = false }
  }, [isMe, canView, profile.uid])

  const first = profile.displayName.split(' ')[0]
  if (!canView || theirs === 'private') {
    return <Locked>{`${first} keeps their badges private.`}</Locked>
  }
  const badges = isMe ? myBadges : theirs ?? null
  if (!badges) {
    return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-slate-500" /></div>
  }
  return <BadgeLibrary ownerName={profile.displayName} badges={badges} isMe={isMe} />
}
