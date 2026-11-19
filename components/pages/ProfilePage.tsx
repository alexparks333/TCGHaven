'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen, Lock, Award, TrendingUp, Pencil, Check, Loader2, UserPlus, UserMinus, Clock, Eye, EyeOff, ChevronRight, Users, Globe,
  Layers, LayoutGrid, Sparkles, Settings, X,
} from 'lucide-react'
import { LogoLoader } from '@/components/LogoLoader'
import { cn, RARITY_LABELS_BY_GAME, zoomGlowColor } from '@/lib/utils'
import { useScrollLock } from '@/lib/useScrollLock'
import CardexPage, { CardZoomOverlay, RARITY_COLORS, bestSlab, SlabTileOverlay, type ZoomCardData, type SlabInfo } from './CardexPage'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { fetchCardPrice, fetchCardPrices } from '@/components/PriceAutoUpdater'
import { gradedLabel } from '@/components/GradedPriceTag'
import type { GradedSource } from '@/lib/api/gradedPrices'
import { useAuth } from '@/components/auth/AuthProvider'
import { useStore } from '@/lib/store'
import { useFriends } from '@/components/friends/FriendsProvider'
import { getCommunity, useMyCommunities } from '@/lib/communities'
import { useCommunity, type Community } from '@/lib/creatorBooks'
import { Avatar } from '@/components/friends/Avatar'
import { SettingsDialog } from '@/components/friends/SettingsDialog'
import { useAccountRole, getAccountRole, REGULAR, titleColor, titleLabel, type AccountRoleRecord } from '@/lib/accountRoles'
import { BadgeLibrary } from '@/components/badges/BadgeLibrary'
import { BadgeShowcase } from '@/components/badges/BadgeShowcase'
import { BannerPins } from '@/components/badges/BannerPins'
import { loadBadges, type SharedBadges } from '@/lib/firebase/badges'
import { GAME_COLORS, GAME_LABELS, type Card, type Game } from '@/lib/types'
import { conditionFactor } from '@/lib/pricing'
import {
  getProfile, resolveUsername, profilePath, updateProfileDetails, loadFriendCardex, sendFriendRequest, acceptFriendRequest, removeFriendship,
  BIO_MAX, type Profile, type ProfilePrivacy, type Friendship,
} from '@/lib/firebase/friends'
import { cardImage } from '@/lib/cardImage'
import { EDITION_LABELS, FINISH_LABELS } from '@/scripts/lib/pokemon-variants.mjs'
import { CardName } from '@/components/CardName'

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
  if (uid === undefined) return <LogoLoader label="Loading profile…" />
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
    // A banned account's profile is hidden from everyone else (lib/accountRoles.ts)
    Promise.all([getProfile(uid), getAccountRole(uid)])
      .then(([p, r]) => { if (live) setOther(r.banned ? null : p) })
      .catch(() => { if (live) setOther(null) })
    return () => { live = false }
  }, [uid, isMe])

  const profile = isMe ? me : other

  // Opened by a username they've since changed: show their current one in the address bar.
  useEffect(() => {
    if (!viaUsername || !profile?.username || profile.username === viaUsername.toLowerCase()) return
    window.history.replaceState(window.history.state, '', profilePath(profile.uid, profile.username))
  }, [viaUsername, profile?.username, profile?.uid])

  if (profile === undefined || (isMe && !profile)) {
    return <LogoLoader label="Loading profile…" />
  }
  if (!profile) return <NotFound />

  const friendship = isMe ? undefined : byUid.get(profile.uid)
  const isFriend = friendship?.status === 'accepted'

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <ProfileHeader profile={profile} isMe={isMe} onSaved={setMe} friendship={friendship} />
      <Showcase profile={profile} isMe={isMe} isFriend={isFriend} onSaved={setMe} />
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────────────────────────────

// The banner's gilt rule and flourish along its foot (globals.css .haven-banner) — banner pins
// stay above it — and the even margin above and below the pins.
/** The banner's artwork — today the engraved sparkles; one day the collector's own header art. Drawn in the
 *  banner and again inside the photo's ring (lined up), so the ring always shows the same art. */
function BannerArt() {
  return <>
    <Sparkles aria-hidden size={150} strokeWidth={1.25} className="absolute -left-6 -bottom-12 text-[#4a321f]/[0.07] rotate-12" />
    <Sparkles aria-hidden size={64} strokeWidth={1.25} className="absolute left-[38%] top-3 text-[#4a321f]/[0.08] -rotate-6" />
  </>
}
/** A count in the Friends page's stat-tile style; a link only when it goes somewhere (your own profile) */
function StatTile({ href, n, label }: { href?: string; n: number | undefined; label: string }) {
  const cls = 'block w-24 shrink-0 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-center transition-colors'
  const body = <>
    <div className="text-xl font-bold leading-none text-ink">{n ?? '–'}</div>
    <div className="text-[11px] font-semibold text-slate-500 mt-1">{label}</div>
  </>
  return href ? <Link href={href} className={cn(cls, 'hover:border-slate-700')}>{body}</Link> : <div className={cls}>{body}</div>
}

/** How far below the banner the ring can reach (the banner's look carries on that far, in its bottom tone) */
const RING_REACH = 160

const BANNER_RULE = 14
const BANNER_MARGIN = 4

function ProfileHeader({ profile, isMe, onSaved, friendship }: {
  profile: Profile
  isMe: boolean
  onSaved: (p: Profile) => void
  friendship: Friendship | undefined
}) {
  const { user } = useAuth()
  const { friends } = useFriends()
  // Their friends (the count their own app keeps on their profile — never the list), the communities they're
  // in, and the one they run, if any — yours, or anyone's you're looking at
  const { communities } = useMyCommunities(profile.uid)
  const mineRun = useCommunity(isMe ? profile.uid : null).community // the community you run (live, as you edit it)
  const [theirsRun, setTheirsRun] = useState<Community | null>(null)  // someone else's — only while it's open (getCommunity)
  useEffect(() => {
    if (isMe) return
    let live = true
    setTheirsRun(null)
    getCommunity(profile.uid).then((c) => { if (live) setTheirsRun(c) }).catch(() => {})
    return () => { live = false }
  }, [isMe, profile.uid])
  const owned = isMe ? mineRun : theirsRun
  const friendCount = isMe ? friends.length : profile.friendCount
  const [editing, setEditing] = useState(false)
  const [bio, setBio] = useState(profile.bio)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'deny' | 'cancel' | 'add' | 'remove' | null>(null)
  const [error, setError] = useState('')
  // Settings opens from the ⚙️ here; the old /settings address redirects to /profile?settings=1.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Their title (Premium / Creator / Staff) beside the name. Regular shows only on your own profile.
  const mine = useAccountRole(isMe ? profile.uid : null).record
  const [theirs, setTheirs] = useState<AccountRoleRecord>(REGULAR)
  useEffect(() => { if (!isMe) getAccountRole(profile.uid).then(setTheirs) }, [isMe, profile.uid])
  const title = isMe ? mine : theirs
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

  // Banner pins fill the banner top to bottom (an even margin above and below, the gilt rule kept
  // clear) — but never so wide on a phone that they run into the avatar or Settings
  const bannerRef = useRef<HTMLDivElement>(null)
  const [bannerPin, setBannerPin] = useState(0)
  useEffect(() => {
    const el = bannerRef.current
    if (!el) return
    const fit = () => {
      const tall = (el.clientHeight - BANNER_RULE - 2 * BANNER_MARGIN) / 1.12
      const wide = (el.clientWidth - 150 - (isMe ? (el.clientWidth >= 640 ? 120 : 52) : 0) - 16) / 3.3
      setBannerPin(Math.max(28, Math.floor(Math.min(tall, wide))))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isMe])

  // The ring round the photo shows the banner's own art, lined up with it: where the ring sits relative to
  // the banner (and the banner's size), kept up to date as the page resizes
  const ringRef = useRef<HTMLSpanElement>(null)
  const [ringAt, setRingAt] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const banner = bannerRef.current, ring = ringRef.current
    if (!banner || !ring) return
    const place = () => {
      const b = banner.getBoundingClientRect(), r = ring.getBoundingClientRect()
      const next = { x: Math.round(r.left - b.left), y: Math.round(r.top - b.top), w: Math.round(b.width), h: Math.round(b.height) }
      setRingAt((p) => (p && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h ? p : next))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(banner); ro.observe(ring)
    return () => ro.disconnect()
  }, [])

  const me = user?.uid ?? ''
  const first = profile.displayName.split(' ')[0]

  let action: React.ReactNode = null
  if (!isMe) {
    if (friendship?.status === 'accepted') {
      // Already friends: take it back (asked first — they'd have to send a new request)
      action = (
        <button onClick={() => { if (confirm(`Remove ${profile.displayName} from your friends? You’d need to send a new request to be friends again.`)) act('remove', () => removeFriendship(me, profile.uid)) }}
          disabled={!!busy} className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink hover:!text-red-600 hover:border-red-400 disabled:opacity-60">
          {busy === 'remove' ? <Loader2 size={15} className="animate-spin" /> : <UserMinus size={15} />}Remove friend
        </button>
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
      {/* Banner: darker, aged Haven parchment with a walnut-and-gilt rule along its foot; your
          pins in a stitched leather strap beside Settings (components/badges/BannerPins.tsx) */}
      {/* no walnut-and-gilt rule along its foot here — the photo's ring carries the banner's art on round it */}
      <div ref={bannerRef} className="haven-banner relative h-28 md:h-36 overflow-hidden" style={{ boxShadow: 'none' }}>
        {/* the fine gilt rules either side of a small diamond, near its foot */}
        <span aria-hidden className="haven-banner-flourish absolute inset-0 pointer-events-none" />
        <BannerArt />
        {bannerPin > 0 && (
          <div className="absolute top-0 flex items-center" style={{ bottom: BANNER_RULE, right: 12, paddingBlock: BANNER_MARGIN }}>
            <div className={isMe ? 'mr-[52px] sm:mr-[120px]' : undefined}>
              <BannerPins profile={profile} isMe={isMe} onSaved={onSaved} size={bannerPin} />
            </div>
          </div>
        )}
        <div className="absolute top-2.5 right-2.5 md:top-3 md:right-3">
          {isMe && (
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
              className="shrink-0 flex items-center gap-1.5 px-2 sm:pl-2.5 sm:pr-3 py-1.5 rounded-xl bg-[#f3e9d3]/90 backdrop-blur-sm border border-[#94805f] text-sm font-semibold text-ink hover:bg-[#f3e9d3] shadow-sm transition-colors"
            >
              <Settings size={15} /><span className="hidden sm:inline">Settings</span>
            </button>
          )}
        </div>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {/* Phone: identity and the privacy box side by side, the bio full width under them.
          Desktop: identity above the bio, the right-hand column beside both. */}
      <div className="px-5 md:px-6 pb-5 grid grid-cols-[minmax(0,1fr)_auto] md:grid-rows-[auto_1fr]">
        {/* Identity */}
        <div className="min-w-0 -mt-12">
          <div className="flex items-end justify-between gap-3">
            {/* A ring of the banner round the photo — a flex box, so it hugs the photo exactly (as an inline span it
                kept a text line's descender gap under it, and the gold showed as a crescent below the photo) */}
            <span ref={ringRef} className="relative isolate flex rounded-full p-[9px] shrink-0 overflow-hidden shadow-[0_10px_18px_-8px_rgba(40,22,8,0.5)]">
              {/* the banner itself, lined up with the real one — so the ring is a window onto the header art */}
              {ringAt && (
                <span aria-hidden className="haven-banner absolute -z-10 pointer-events-none"
                  style={{
                    left: -ringAt.x, top: -ringAt.y, width: ringAt.w, height: ringAt.h + RING_REACH, boxShadow: 'none',
                    // the banner's layers sized to the banner itself (not this taller box), then its bottom tone carried on below it
                    backgroundSize: `${ringAt.w}px ${ringAt.h}px, ${ringAt.w}px ${ringAt.h}px, 420px 220px, ${ringAt.w}px ${ringAt.h}px`,
                    backgroundRepeat: 'no-repeat, no-repeat, repeat, no-repeat', backgroundColor: '#a8885a',
                  }}>
                  {/* the art laid out on the banner's own box but not cut at its edge: what runs off the banner's foot (the big
                      star) carries on into the ring — the art shows through the banner and the ring together, like one matte */}
                  <span className="absolute left-0 top-0" style={{ width: ringAt.w, height: ringAt.h }}><BannerArt /></span>
                </span>
              )}
              <Avatar seed={profile.uid} name={profile.displayName} photoURL={profile.photoURL} size={96} className="ring-[3px] ring-[#ede1c6]" />
            </span>
            {action && <div className="mb-1 md:hidden">{action}</div>}
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-ink mt-3 leading-tight [overflow-wrap:anywhere]">{profile.displayName}</h1>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm text-slate-500 truncate">@{profile.username}</span>
            {(isMe || title.role !== 'regular') && (
              <span
                className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ backgroundColor: titleColor(title) + '22', color: titleColor(title) }}
              >
                {titleLabel(title)}
              </span>
            )}
          </div>
          {/* Phone: the counts and the community as a line of text (on desktop they're the tiles on the right) */}
          <div className="md:hidden mt-1 flex gap-4 text-sm font-semibold text-slate-400">
            {([[isMe ? '/friends' : null, friendCount, friendCount === 1 ? 'Friend' : 'Friends'],
               [isMe ? '/friends#communities' : null, communities.length, communities.length === 1 ? 'Community' : 'Communities']] as const).map(([href, n, label]) => {
              const body = <><span className="text-ink font-bold">{n ?? '–'}</span> {label}</>
              return href ? <Link key={label} href={href} className="hover:text-ink">{body}</Link> : <span key={label}>{body}</span>
            })}
          </div>
          {owned && (
            <Link href={`/c/${profile.uid}`} className="md:hidden mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-[#7a5230]">
              <Users size={14} />{isMe ? 'Your community' : `${first}’s community`}: <span className="truncate">{owned.name || 'Open'}</span><ChevronRight size={14} />
            </Link>
          )}
        </div>

        {/* Right side: the counts and the community they run, then your privacy switches — or, on someone
            else's profile, the friend action */}
        <div className={cn('flex gap-3 items-start md:row-span-2', isMe ? 'pl-3 md:pl-5 pt-3 md:pt-4' : 'hidden md:flex pl-5 pt-4')}>
          {/* someone else's profile: Add / Requested / Remove friend first, to the left of their counts */}
          {!isMe && action && <div className="shrink-0">{action}</div>}
          {/* No fixed px width here: the tiles are in rem, and rem grows on wide screens
              (globals.css html font-size), so a px column let them spill over the privacy box */}
          <div className="hidden md:flex flex-col gap-2 shrink-0">
            <div className="flex gap-3">
              {/* Friend count, in the Friends page's stat-tile style (someone else's: the number their app keeps) */}
              <StatTile href={isMe ? '/friends' : undefined} n={friendCount} label={friendCount === 1 ? 'Friend' : 'Friends'} />
              {/* Communities they're in (lib/communities.ts) — yours open the Friends page's "Your communities" */}
              <StatTile href={isMe ? '/friends#communities' : undefined} n={communities.length} label={communities.length === 1 ? 'Community' : 'Communities'} />
            </div>
            {/* The community they run — straight to its page (where a visitor can join it) */}
            {owned && (
              <Link href={`/c/${profile.uid}`} title={`Go to ${owned.name || 'the community'}`}
                className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 hover:border-[#7a5230] px-3 py-2 transition-colors">
                <Users size={15} className="shrink-0 text-[#7a5230]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 leading-none">{isMe ? 'Your community' : `${first}’s community`}</span>
                  <span className="block text-sm font-bold text-ink truncate mt-0.5">{owned.name || 'Community'}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-slate-500" />
              </Link>
            )}
          </div>
          {isMe && <PrivacyBox profile={profile} onSaved={onSaved} />}
        </div>

        {/* Bio */}
        <div className="min-w-0 col-span-2 md:col-span-1 md:col-start-1">
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
            // breaks anywhere it has to, so even one very long word stays in its column (never under the tiles beside it)
            <p className="text-sm text-slate-300 mt-3 whitespace-pre-line max-w-md [overflow-wrap:anywhere]">
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
      </div>
    </section>
  )
}

// ── What others can see (compact, inside your header) ─────────────────────────────────────

/** The width of the Everyone / Friends choice (and Portfolio's "Only you"): icons only on a phone, words from md */
const SEG_W = 'w-[60px] md:w-[164px]'

function PrivacyBox({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [saving, setSaving] = useState<keyof ProfilePrivacy | null>(null)
  const [error, setError] = useState('')

  // true = Everyone (any collector), false = Friends (only the friends you've added and accepted)
  async function choose(key: keyof ProfilePrivacy, everyone: boolean) {
    if (profile.privacy[key] === everyone) return
    const privacy = { ...profile.privacy, [key]: everyone }
    setSaving(key); setError('')
    try {
      await updateProfileDetails(profile.uid, { privacy })
      onSaved({ ...profile, privacy })
    } catch (e) {
      console.error(e); setError('Couldn’t save — please try again.')
    } finally { setSaving(null) }
  }

  const rows: { key: keyof ProfilePrivacy; icon: typeof Award; label: string; hint: string }[] = [
    { key: 'cardex', icon: BookOpen, label: 'Cardex', hint: 'Which cards you own and what they’re worth — never what you paid' },
    { key: 'badges', icon: Award, label: 'Badges', hint: 'Your Haven Badges pin book' },
  ]

  return (
    <div className="w-[176px] md:w-[320px] min-w-0 rounded-2xl border border-slate-800 bg-slate-950/60 p-2 md:p-3">
      <div className="flex items-center gap-1.5 px-1 mb-1 md:mb-2">
        <Eye size={13} className="text-slate-500 shrink-0" />
        <span className="text-[10px] md:text-[11px] font-bold uppercase md:tracking-wider leading-tight text-slate-500">Who can see it</span>
      </div>
      <div className="flex flex-col md:gap-1">
        {rows.map(({ key, icon: Icon, label, hint }) => {
          const everyone = profile.privacy[key]
          // Everyone / Friends — on a phone just the icons (a globe, two people), the words from md up
          const opt = (value: boolean, I: typeof Globe, name: string, tip: string) => (
            <button type="button" role="radio" aria-checked={everyone === value} aria-label={`${label}: ${name}`} title={tip}
              onClick={() => choose(key, value)} disabled={saving === key}
              className={cn('flex items-center justify-center gap-1 px-1 md:px-2 py-1 text-[10px] md:text-[11px] font-bold leading-none whitespace-nowrap transition-colors',
                everyone === value ? 'bg-[#7a5230] text-[#fbf6ea]' : 'text-slate-500 hover:text-ink')}>
              {saving === key && everyone !== value ? <Loader2 size={11} className="animate-spin" /> : <I size={11} />}<span className="hidden md:inline">{name}</span>
            </button>
          )
          return (
            <div key={key} title={hint} className="flex items-center gap-1.5 md:gap-2.5 rounded-xl px-1 md:px-2 py-1 md:py-1.5">
              <Icon size={15} className={everyone ? 'text-violet-700' : 'text-slate-500'} />
              <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate md:overflow-visible md:whitespace-nowrap">{label}</span>
              {/* two equal halves, the same width as Portfolio's "Only you" box below so all three line up */}
              <span role="radiogroup" aria-label={`Who can see your ${label}`} className={cn(SEG_W, 'shrink-0 grid grid-cols-2 rounded-lg border border-[#d6c49f] overflow-hidden bg-[#f6eedb] [&>button+button]:border-l [&>button+button]:border-[#d6c49f]')}>
                {opt(true, Globe, 'Everyone', 'Everyone — any collector can see it')}
                {opt(false, Users, 'Friends', 'Friends — only the friends you’ve added and accepted')}
              </span>
            </div>
          )
        })}
        <div className="flex items-center gap-1.5 md:gap-2.5 rounded-xl px-1 md:px-2 py-1 md:py-1.5" title="Your values and P&L are only ever for you — not even friends">
          <TrendingUp size={15} className="text-slate-500" />
          <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate md:overflow-visible md:whitespace-nowrap">Portfolio</span>
          <span className={cn(SEG_W, 'shrink-0 flex items-center justify-center gap-1 rounded-lg border border-dashed border-[#d6c49f] py-1 text-[10px] md:text-[11px] font-bold leading-none text-slate-500')} aria-label="Only you"><Lock size={11} /><span className="hidden md:inline">Only you</span></span>
        </div>
      </div>
      {error && <div className="text-[11px] text-red-600 mt-1.5 px-1">{error}</div>}
    </div>
  )
}

// ── Showcase: a framed mini Cardex, with a Badges tab ──────────────────────────────────────

type ShowcaseTab = 'cardex' | 'badges'
type CardexView = 'top' | 'full'
type BadgesView = 'display' | 'full'

function Showcase({ profile, isMe, isFriend, onSaved }: { profile: Profile; isMe: boolean; isFriend: boolean; onSaved: (p: Profile) => void }) {
  const [tab, setTab] = useState<ShowcaseTab>('cardex')
  // Cardex tab: "Top cards" (best-first showcase) or "Full Cardex" (every set, owned and missing)
  const [view, setView] = useState<CardexView>('top')
  // Badges tab: the pins the owner put on display, or every book ("Full Badges")
  const [badgesView, setBadgesView] = useState<BadgesView>('display')
  // Everyone sees what's set to Everyone; what's set to Friends, only accepted friends (and you)
  const cardexVisible = isMe || profile.privacy.cardex || isFriend
  const badgesVisible = isMe || profile.privacy.badges || isFriend
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
              {shared ? <Eye size={11} /> : <EyeOff size={11} />}{shared ? 'Everyone' : 'Friends only'}
            </span>
          )}
          {tab === 'cardex' && cardexVisible && (
            <ViewSwitch value={view} onChange={setView} options={[['top', 'Top cards', Sparkles], ['full', 'Full Cardex', LayoutGrid]]} />
          )}
          {tab === 'badges' && badgesVisible && (
            <ViewSwitch value={badgesView} onChange={setBadgesView} options={[['display', 'Pin Display', Sparkles], ['full', 'Full Badges', BookOpen]]} />
          )}
        </div>
        {tab === 'cardex'
          ? <CardexTab profile={profile} isMe={isMe} isFriend={isFriend} view={view} />
          : <BadgesTab profile={profile} isMe={isMe} isFriend={isFriend} view={badgesView} onSaved={onSaved} />}
      </div>
    </section>
  )
}

// The showcase's top-right switch between a tab's two views
function ViewSwitch<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string, typeof Sparkles])[] }) {
  return (
    <div className="ml-auto flex gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800">
      {options.map(([id, label, Icon]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-violet-600',
            value === id ? 'bg-slate-800 text-ink shadow-sm' : 'text-slate-500 hover:text-ink',
          )}
        >
          <Icon size={13} />{label}
        </button>
      ))}
    </div>
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

type ShowcaseCard = Card & { copies: number; slab?: SlabInfo; printing: string }

// A special printing's short label on its tile ("Reverse Holo", "1st Edition"); '' for the plain one — never a bare "Foil"
function printingOf(c: Card): string {
  const parts: string[] = []
  if (c.edition && c.edition !== 'unlimited') parts.push((EDITION_LABELS as Record<string, string>)[c.edition] ?? c.edition)
  if (c.finish && c.finish !== 'normal') parts.push((FINISH_LABELS as Record<string, string>)[c.finish] ?? c.finish)
  return parts.join(' ')
}

// A self-contained mini Cardex: everything happens on this page — no links into the app's own
// Cardex, which a visitor has no access to. Filter by game and set, page through in place, and
// click a card for the same spin-around zoom the Cardex has, with the card's market price (the
// shared catalog's — never what its owner paid; the grid itself shows no prices).
function CardexTab({ profile, isMe, isFriend, view }: { profile: Profile; isMe: boolean; isFriend: boolean; view: CardexView }) {
  const ownCards = useStore((s) => s.cards)
  const [friendCards, setFriendCards] = useState<Card[] | 'private' | undefined>(undefined)
  // A friend's prices, all fetched together as their cards open (their shared copies carry none) —
  // the tiles are ranked by them and the zoom shows them at once. null = couldn't be priced: their
  // stored order stands and the zoom asks per card.
  const [friendPrices, setFriendPrices] = useState<Awaited<ReturnType<typeof fetchCardPrices>> | undefined>(undefined)
  const [game, setGame] = useState<Game | 'all'>('all')
  const [set, setSet] = useState('')
  const [limit, setLimit] = useState(FIRST_PAGE)
  const [zoom, setZoom] = useState<ZoomCardData | null>(null)
  useScrollLock(zoom !== null)
  // A friend's shared Cardex has no prices: the zoom asks the price routes for the one card opened
  const prices = useRef(new Map<string, { price: number; source?: GradedSource }>())
  // Your own slabs' PriceCharting sources (their price is already the graded one) — for the credit
  const gradedSources = useStore((s) => s.gradedSources)
  const gradedOn = useStore((s) => s.gradedOn)
  const opened = useRef('')
  const canView = isMe || profile.privacy.cardex || isFriend

  useEffect(() => {
    if (isMe || !canView) return
    let live = true
    loadFriendCardex(profile.uid).then(async (r) => {
      const priced = Array.isArray(r) ? await fetchCardPrices(r) : null
      if (!live) return
      setFriendPrices(priced)
      setFriendCards(r)
    })
    return () => { live = false }
  }, [isMe, canView, profile.uid])

  useEffect(() => { setLimit(FIRST_PAGE) }, [game, set])

  // A friend's copies with today's prices on them (the full Cardex view reads currentPrice)
  const friendPriced = useMemo(
    () => (Array.isArray(friendCards)
      ? friendCards.map((c) => { const p = friendPrices?.prices[c.id]; return p ? { ...c, currentPrice: p } : c })
      : []),
    [friendCards, friendPrices],
  )

  // One tile per distinct card, printing *and grade*, best first by what one copy is worth today —
  // a slab at its grade's PriceCharting price (one copy, one price: docs/PriceCharting.md). Your own
  // and a friend's alike: a friend's stored order was ranked on their device, before slabs had
  // graded prices, so a $1,000 PSA 8 sat below a $480 raw card (2026-11-19). A card's printings are
  // separate tiles too — seven Slowpokes, one of them a $142 Reverse Holo, were one "×7" tile ranked
  // at the Reverse Holo's price (2026-11-13).
  const unique = useMemo(() => {
    const src = [...(isMe ? ownCards : friendPriced)].sort((a, b) => (b.currentPrice ?? 0) - (a.currentPrice ?? 0))
    const groups = new Map<string, Card[]>()
    for (const c of src) {
      const grade = c.gradingCompany ? `|${c.gradingCompany}|${c.grade ?? ''}|${c.gradeTier ?? ''}` : conditionFactor(c) !== 1 ? `|${c.condition}` : ''
      const key = `${c.apiId || `${c.game}|${c.set}|${c.number}|${c.name}`}|${printingOf(c)}${grade}`
      const list = groups.get(key)
      if (list) list.push(c)
      else groups.set(key, [c])
    }
    return Array.from(groups.values()).map((copies): ShowcaseCard => ({
      ...copies[0],
      copies: copies.reduce((n, c) => n + (c.quantity || 1), 0),
      slab: bestSlab(copies),
      printing: printingOf(copies[0]),
    }))
  }, [isMe, ownCards, friendPriced])

  const viewer = useMemo(
    () => (isMe ? { cards: ownCards } : { cards: friendPriced, graded: friendPrices?.graded ?? {}, gradedOn: friendPrices?.gradedOn ?? false }),
    [isMe, ownCards, friendPriced, friendPrices],
  )

  const first = profile.displayName.split(' ')[0]
  if (!canView || friendCards === 'private') {
    return (
      <Locked>
        {`${first} shares their Cardex with friends only — add them as a friend to see it.`}
      </Locked>
    )
  }
  if (!isMe && friendCards === undefined) {
    return <LogoLoader label={`Loading ${first}’s cards…`} />
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
  // distinct cards, whatever their printing (a card in two printings is two tiles, one card)
  const cardCount = new Set(unique.map((c) => c.apiId || `${c.game}|${c.set}|${c.number}|${c.name}`)).size

  function open(el: HTMLElement, c: ShowcaseCard) {
    const color = GAME_COLORS[c.game]
    const label = RARITY_LABELS_BY_GAME[c.game]?.[c.rarity ?? ''] ?? c.rarity ?? ''
    const credit = (s?: GradedSource) => (s ? { label: gradedLabel(s.key), url: s.url } : undefined)
    const batch = friendPrices?.prices[c.id]
    const known = prices.current.get(c.id) ?? (batch ? { price: batch, source: friendPrices?.graded[c.id] } : undefined)
    setZoom({
      imageUrl: c.imageUrl ?? '',
      name: c.name,
      number: c.number,
      rarityLabel: label.replace('_', ' '),
      rarityColor: RARITY_COLORS[c.rarity ?? ''] ?? '#7a6a55',
      marketPrice: isMe ? c.currentPrice ?? 0 : known?.price ?? 0,
      priceSource: credit(isMe ? gradedSources[c.id] : known?.source),
      rawEstimate: Boolean(c.slab && c.apiId && (isMe ? gradedOn && !gradedSources[c.id] : known && friendPrices?.gradedOn && !known.source)),
      owned: true,
      quantity: c.copies,
      isFoil: c.isFoil,
      glowColor: zoomGlowColor(c.game, c.rarity ?? '', color),
      slab: c.slab,
      setName: c.set,
      ebayCard: { name: c.name, number: c.number, set: c.set, game: c.game, gradingCompany: c.slab?.company, grade: c.slab?.grade, language: c.language },
      originRect: el.getBoundingClientRect(),
    })
    opened.current = c.id
    if (!isMe && !known) {
      // A friend's slab is priced from PriceCharting's sales for its grade, with the credit under it
      fetchCardPrice(c, c.slab).then((r) => {
        prices.current.set(c.id, r)
        // still the card on screen: show its price as soon as it arrives
        if (r.price > 0 && opened.current === c.id) setZoom((z) => (z ? { ...z, marketPrice: r.price, priceSource: credit(r.source), rawEstimate: Boolean(c.slab && gradedOn && !r.source) } : z))
      })
    }
  }

  const stats = [
    { icon: LayoutGrid, value: cardCount.toLocaleString(), label: 'cards' },
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
            key={c.id}
            onClick={(e) => open(e.currentTarget, c)}
            title={c.name}
            className="showcase-card relative block rounded-lg overflow-hidden bg-slate-800 cursor-pointer"
            style={{ aspectRatio: '5/7', outline: c.slab ? '1px solid #9aa4b1' : `2px solid ${GAME_COLORS[c.game]}55`, outlineOffset: 1 }}
          >
            {c.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cardImage(c.imageUrl, 'grid')} alt={c.name} loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-2 text-center text-[11px] font-semibold text-slate-400"><CardName name={c.name} /></div>
            )}
            {c.slab && <SlabTileOverlay slab={c.slab} />}
            {c.copies > 1 && (
              <span className="absolute top-1 right-1 text-[10px] font-bold text-white bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-full leading-none">×{c.copies}</span>
            )}
            {c.printing && !c.slab && (
              <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate text-[9px] font-bold text-white bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-full leading-none">{c.printing}</span>
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

function BadgesTab({ profile, isMe, isFriend, view, onSaved }: { profile: Profile; isMe: boolean; isFriend: boolean; view: BadgesView; onSaved: (p: Profile) => void }) {
  const [saveError, setSaveError] = useState(false)
  const { myBadges } = useFriends()
  const [theirs, setTheirs] = useState<SharedBadges | 'private' | undefined>(undefined)
  const canView = isMe || profile.privacy.badges || isFriend

  useEffect(() => {
    if (isMe || !canView) return
    let live = true
    loadBadges(profile.uid).then((b) => { if (live) setTheirs(b) })
    return () => { live = false }
  }, [isMe, canView, profile.uid])

  const first = profile.displayName.split(' ')[0]
  if (!canView || theirs === 'private') {
    return <Locked>{`${first} shares their badges with friends only — add them as a friend to see them.`}</Locked>
  }
  const badges = isMe ? myBadges : theirs ?? null
  if (!badges) {
    return <LogoLoader label={isMe ? 'Loading your badges…' : `Loading ${first}’s badges…`} />
  }
  if (view === 'full') return <BadgeLibrary ownerName={profile.displayName} badges={badges} isMe={isMe} />

  // Arranging your own display: shown at once, saved in the background (put back if it fails)
  async function arrange(pinDisplay: string[]) {
    const before = profile
    setSaveError(false)
    onSaved({ ...profile, pinDisplay })
    try { await updateProfileDetails(profile.uid, { pinDisplay }) } catch { onSaved(before); setSaveError(true) }
  }
  return (
    <>
      <BadgeShowcase badges={badges} isMe={isMe} ownerName={profile.displayName} ids={profile.pinDisplay} onChange={isMe ? arrange : undefined} />
      {saveError && <p className="mt-2 text-xs text-red-500">Couldn’t save your display — try again.</p>}
    </>
  )
}
