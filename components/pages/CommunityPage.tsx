'use client'

// /c/{uid} — a community: the creator's header picture (CommunityHeader), their book pinned in the top
// right (opened into the real pin book), name, tagline, Join / Leave and the member count, then the
// sections the creator switched on (About, Newest members — lib/creatorBooks.ts COMMUNITY_SECTIONS).
// Shown only while its creator can still run one (lib/communities.ts getCommunity). docs/creators.md.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Users, Check, LogOut, BookOpen, X, Sparkles, Wand2, Trophy } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { Avatar } from '@/components/friends/Avatar'
import { getProfile, profilePath, type Profile } from '@/lib/firebase/friends'
import { getCommunity, joinCommunity, leaveCommunity, memberCount, newestAchievements, newestMembers, useMyCommunities, type Achievement, type CommunityEntry } from '@/lib/communities'
import { useFriends } from '@/components/friends/FriendsProvider'
import { BadgePin } from '@/components/badges/BadgePin'
import { loadBadges, type SharedBadges } from '@/lib/firebase/badges'
import { cn } from '@/lib/utils'
import { Corners, Divider } from '@/components/creator/Ornaments'
import { CommunityHeader } from '@/components/creator/CommunityHeader'
import { sectionOn, useCreatorBook, type CreatorBook } from '@/lib/creatorBooks'
import { useStudioDevice } from '@/lib/studioDevice'
import { isLive } from '@/lib/badges'
import { BookCover, BookThickness } from '@/components/badges/BadgeLibrary'
import { BadgeBook } from '@/components/badges/BadgeBook'
import { useScrollLock } from '@/lib/useScrollLock'
import { GAME_COLORS, GAME_LABELS } from '@/lib/types'

export default function CommunityPage({ uid }: { uid: string }) {
  return (
    <AuthGuard>
      <Body uid={uid} />
    </AuthGuard>
  )
}

function Body({ uid }: { uid: string }) {
  const studio = useStudioDevice()
  const { user } = useAuth()
  const [community, setCommunity] = useState<CommunityEntry | null | undefined>(undefined)
  const [creator, setCreator] = useState<Profile | null>(null)
  const [members, setMembers] = useState<number | null>(null)
  const { joined } = useMyCommunities(user?.uid)
  const isMember = joined.has(uid)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { book: raw } = useCreatorBook(community ? uid : null)
  // Fans see only published badges — a creator's drafts stay in their Studio (lib/badges.ts isLive)
  const book = raw && { ...raw, badges: raw.badges.filter(isLive) }
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getCommunity(uid).then(setCommunity).catch(() => setCommunity(null))
    getProfile(uid).then(setCreator).catch(() => {})
  }, [uid])
  useEffect(() => { memberCount(uid).then(setMembers).catch(() => {}) }, [uid, isMember])

  if (community === undefined) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
  if (!community) {
    return (
      <div className="card-glass max-w-md mx-auto mt-10 p-6 text-center">
        <Users size={30} className="mx-auto text-slate-500 mb-3" />
        <h1 className="text-lg font-bold text-ink">Community not found</h1>
        <p className="text-sm text-slate-400 mt-1">It may have been renamed or isn&rsquo;t available right now.</p>
        <Link href="/friends" className="btn-secondary w-fit mx-auto mt-5">Find communities</Link>
      </div>
    )
  }

  const mine = user?.uid === uid
  async function toggle() {
    if (!user) return
    setBusy(true); setError('')
    try {
      if (isMember) await leaveCommunity(user.uid, uid)
      else await joinCommunity(user.uid, uid)
    } catch (e) {
      setError('Couldn’t ' + (isMember ? 'leave' : 'join') + ' — ' + (e instanceof Error ? e.message : String(e)))
    } finally { setBusy(false) }
  }

  return <CommunityView {...{ uid, community, creator, members, mine, studio, isMember, busy, error, toggle, book, open, setOpen }} />
}

/** The page itself, from its data — split from Body so it can be drawn without signing in (dev checks) */
export function CommunityView({ uid, community, creator, members, mine, studio, isMember, busy, error, toggle, book, open, setOpen }: {
  uid: string; community: CommunityEntry; creator: Profile | null; members: number | null; mine: boolean
  studio: ReturnType<typeof useStudioDevice>; isMember: boolean; busy: boolean; error: string; toggle: () => void
  book: CreatorBook | null; open: boolean; setOpen: (o: boolean) => void
}) {
  const { myBadges: progress } = useFriends()
  const wide = useWide()
  return (
    <div className="flex flex-col pb-12">
      {/* The header — the creator's picture (or colour) */}
      <div className="relative">
        <CommunityHeader community={community} className="rounded-3xl shadow-[0_24px_50px_-28px_rgba(40,25,10,0.8)]" />
        {/* The community's emblem, half over the header's bottom edge in a frosted frame */}
        <div className="absolute left-5 md:left-9 bottom-0 translate-y-1/2 z-[5] w-[104px] h-[104px] md:w-[136px] md:h-[136px] rounded-[32px] p-2 md:p-2.5 bg-[#3a2a1a]/25 backdrop-blur-md ring-1 ring-white/35 shadow-[0_16px_34px_-12px_rgba(30,18,8,0.65)]">
          <div className="w-full h-full rounded-[24px] flex items-center justify-center pinbook-serif text-5xl md:text-6xl font-bold text-white shadow-[inset_0_-6px_12px_rgba(0,0,0,0.25),inset_0_2px_0_rgba(255,255,255,0.25)]"
            style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${community.color} 82%, white), ${community.color} 55%, color-mix(in srgb, ${community.color} 70%, black))` }}>
            {(community.name.trim()[0] || '★').toUpperCase()}
          </div>
        </div>
      </div>

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        {/* ── Who it is ── */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 px-2 md:px-4">
          {/* beside the emblem (below it on a phone) */}
          <div className="pt-16 sm:pt-4 sm:pl-[124px] md:pl-[164px]">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#8a6420]">Community</p>
              <h1 className="pinbook-serif text-3xl md:text-[40px] font-bold text-ink leading-[1.05] mt-0.5">{community.name}</h1>
              {community.tagline && <p className="mt-1.5 text-base md:text-lg italic text-slate-500" style={{ fontFamily: 'Georgia, serif' }}>{community.tagline}</p>}
            </div>
          </div>

          {/* Members · the creator · games — then Join */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="haven-chip px-3 py-1.5 text-sm inline-flex items-center gap-1.5"><Users size={15} /><b className="text-ink tabular-nums">{members ?? '–'}</b> {members === 1 ? 'member' : 'members'}</span>
            {creator && (
              <Link href={profilePath(uid, creator.username)} className="haven-chip px-3 py-1.5 text-sm inline-flex items-center gap-2 hover:text-ink">
                <Avatar seed={uid} name={creator.displayName} photoURL={creator.photoURL} size={20} />by <b className="text-ink">{creator.displayName}</b>
              </Link>
            )}
            {(community.games ?? []).map((g) => (
              <span key={g} className="haven-chip px-3 py-1.5 text-sm inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: GAME_COLORS[g] }} />{GAME_LABELS[g]}</span>
            ))}
            <div className="basis-full sm:basis-auto sm:ml-auto mt-2 sm:mt-0">
              {mine ? (
                // the Studio is computers-only — no link to it in the app or on a phone
                studio === 'computer' ? <Link href="/creator" className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink"><Wand2 size={15} />Edit in Creator Studio</Link> : null
              ) : (
                <button type="button" onClick={toggle} disabled={busy}
                  className={isMember ? 'group btn-secondary !bg-slate-950 border border-slate-700 !text-ink' : 'btn-primary px-7 py-3 text-base shadow-[0_10px_22px_-10px_rgba(122,82,48,0.8)]'}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : isMember ? <><Check size={16} className="group-hover:hidden" /><LogOut size={16} className="hidden group-hover:block" /></> : <Sparkles size={17} />}
                  {isMember ? <><span className="group-hover:hidden">Joined</span><span className="hidden group-hover:inline">Leave</span></> : 'Join the community'}
                </button>
              )}
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>

        {/* ── The book: a big picture of it, slanted on the page, over the header's corner ── */}
        <aside className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:-mt-48 relative z-10 flex flex-col items-center gap-8">
          {book ? <ShowcaseBook book={book} onOpen={() => setOpen(true)} />
            : <p className="pinbook-serif text-sm text-slate-500 text-center py-6">{community.name} hasn&rsquo;t made their book yet.</p>}
          {/* Members, top collectors first — beside the sections on a computer */}
          {wide && sectionOn(community, 'members') && <MembersColumn community={uid} book={book} members={members} />}
        </aside>

        {/* ── The sections the creator switched on ── */}
        <div className="min-w-0 flex flex-col gap-6 lg:col-start-1 lg:row-start-2">
          {sectionOn(community, 'about') && (
            <Section title="About">
              <p className="text-[15px] text-slate-400 whitespace-pre-line leading-relaxed">{community.about || 'No description yet.'}</p>
            </Section>
          )}
          {sectionOn(community, 'badgeBoard') && <AchievementBoard community={uid} book={book} />}
          {/* on a phone, Members comes after the sections */}
          {!wide && sectionOn(community, 'members') && <MembersColumn community={uid} book={book} members={members} />}
        </div>
      </div>

      {open && book && <BookViewer book={book.book} defs={book.badges} badges={isMember || mine ? progress : null} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** A section of the page: a paper card with an engraved title and corner flourishes */
function Section({ title, icon, sub, children }: { title: string; icon?: React.ReactNode; sub?: string; children: React.ReactNode }) {
  return (
    <section className="haven-panel haven-grain relative !p-6 md:!p-7">
      <Corners inset={8} size={30} />
      <h2 className="pinbook-serif text-xl font-bold text-ink flex items-center gap-2.5">{icon}{title}</h2>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      <Divider className="mt-3 mb-4" />
      {children}
    </section>
  )
}

/** The creator's book, shown off: a big picture of it standing slanted on the page with its shadow;
 *  it turns to follow the pointer (light sweeping the cover), and a click opens it over the page */
function ShowcaseBook({ book, onOpen }: { book: CreatorBook; onOpen: () => void }) {
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null)
  const ry = -18 + (tilt ? (tilt.x - 0.5) * 30 : 0), rx = 7 + (tilt ? (0.5 - tilt.y) * 18 : 0)
  return (
    <div className="flex flex-col items-center">
      <button type="button" onClick={onOpen} aria-label={`Open ${book.book.name}`}
        onPointerMove={(e) => { if (e.pointerType !== 'mouse') return; const r = e.currentTarget.getBoundingClientRect(); setTilt({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }) }}
        onPointerLeave={() => setTilt(null)}
        className="relative w-[200px] md:w-[250px] lg:w-[280px] aspect-[0.71] outline-none [perspective:1100px] cursor-pointer">
        {/* its shadow on the page, moving opposite the tilt */}
        <span aria-hidden className="absolute left-[8%] right-[2%] bottom-[-7%] h-[12%] rounded-[50%] bg-[#2b1a0c]/40 blur-xl transition-transform duration-200"
          style={{ transform: `translateX(${(-ry - 18) * 0.6}px) scaleX(${tilt ? 0.92 : 1})` }} />
        <span className="absolute inset-0 transition-transform duration-200 ease-out [transform-style:preserve-3d]"
          style={{ transform: `rotateY(${ry}deg) rotateX(${rx}deg) rotateZ(-2deg) ${tilt ? 'translateY(-8px) scale(1.02)' : ''}`, containerType: 'inline-size', filter: 'drop-shadow(18px 26px 22px rgba(40,22,8,0.45)) drop-shadow(4px 6px 4px rgba(40,22,8,0.35))' }}>
          <BookThickness look={book.book.coverStyle} />
          <span className="absolute inset-0"><BookCover set={book.book} badges={null} defs={book.badges} /></span>
          {/* the light catching the cover as it turns */}
          <span aria-hidden className="absolute inset-0 rounded-[10px] pointer-events-none mix-blend-overlay transition-opacity duration-200"
            style={{ opacity: tilt ? 1 : 0.35, background: `linear-gradient(${105 + (tilt ? (tilt.x - 0.5) * 60 : 0)}deg, transparent 25%, rgba(255,255,255,0.6) ${45 + (tilt ? (tilt.x - 0.5) * 30 : 0)}%, transparent 65%)` }} />
        </span>
      </button>
      <p className="mt-8 pinbook-serif text-lg font-bold text-ink text-center leading-tight">{book.book.name}</p>
      <p className="mt-1 text-xs text-slate-500 text-center">
        {book.badges.length} badge{book.badges.length === 1 ? '' : 's'} to collect{chaptersOf(book) > 1 ? ` · ${chaptersOf(book)} chapters` : ''} · <span className="text-[#8a6420] font-semibold">click to open</span>
      </p>
    </div>
  )
}

/** How many chapters the book's badges fill */
const chaptersOf = (b: CreatorBook) => new Set(b.badges.map((x) => x.page)).size

/** The Achievement Badge Board: the newest members to earn one of this creator's badges */
export function AchievementBoard({ community, book, sample }: { community: string; book: CreatorBook | null; sample?: Array<Achievement & { profile: Profile | null }> /* dev checks */ }) {
  const [list, setList] = useState<Array<Achievement & { profile: Profile | null }> | null>(sample ?? null)
  useEffect(() => {
    if (sample) return
    newestAchievements(community, 10)
      .then((rows) => Promise.all(rows.map(async (r) => ({ ...r, profile: await getProfile(r.member).catch(() => null) }))))
      .then(setList).catch(() => setList([]))
  }, [community, sample])
  const defOf = (id: string) => book?.badges.find((b) => b.id === id)
  const shown = (list ?? []).filter((a) => defOf(a.badge)) // badges still in the book
  return (
    <Section title="Achievement Badge Board" icon={<Trophy size={19} className="text-[#b8862b]" />} sub="The newest members to earn a badge from this book.">
      {list === null ? <Loader2 size={18} className="animate-spin text-slate-500" />
        : shown.length === 0 ? <p className="text-sm text-slate-500">No one has earned a badge yet — collect the cards and be the first.</p>
        : (
          <ol className="space-y-2">
            {shown.map((a, i) => {
              const def = defOf(a.badge)!
              return (
                <li key={a.member + a.badge} className={cn('flex items-center gap-3 rounded-xl p-2.5', i === 0 ? 'bg-[#f6e7c4] border border-[#d6b168]/60' : 'hover:bg-slate-900/50')}>
                  <span className="relative shrink-0 w-12 h-[54px] flex items-center justify-center drop-shadow-[0_3px_4px_rgba(0,0,0,0.35)]">
                    <BadgePin art={def.art} imageUrl={def.imageUrl} size={46} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink truncate">
                      <Link href={a.profile ? profilePath(a.member, a.profile.username) : '#'} className="font-bold hover:underline">{a.profile?.displayName ?? 'A collector'}</Link>
                      <span className="text-slate-500"> earned </span><b className="pinbook-serif">{def.name}</b>
                    </span>
                    <span className="block text-[11px] text-slate-500">{timeAgo(a.earnedAt)}{i === 0 && ' · newest'}</span>
                  </span>
                  <Avatar seed={a.member} name={a.profile?.displayName ?? 'Collector'} photoURL={a.profile?.photoURL} size={32} />
                </li>
              )
            })}
          </ol>
        )}
    </Section>
  )
}

function timeAgo(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A computer-sized window (the lg layout) — Members sits beside the sections there, after them on a phone */
function useWide() {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)')
    const f = () => setWide(m.matches)
    f(); m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return wide
}

interface RankedMember { uid: string; profile: Profile | null; badges: number; cards: number; hidden: boolean; joinedAt: number }

/** The community's members, top collectors first: most of this book's badges earned, then the most
 *  cards collected toward them (from each member's shared badges; members who keep theirs private
 *  come last, marked hidden) */
export function MembersColumn({ community, book, members, sample }: { community: string; book: CreatorBook | null; members: number | null; sample?: RankedMember[] /* dev checks */ }) {
  const [list, setList] = useState<RankedMember[] | null>(sample ?? null)
  const [all, setAll] = useState(false)
  const ids = (book?.badges ?? []).map((b) => b.id).join(',')
  useEffect(() => {
    if (sample) return
    let live = true
    const badgeIds = ids ? ids.split(',') : []
    newestMembers(community, 100)
      .then((rows) => Promise.all(rows.map(async (r) => {
        const [profile, shared] = await Promise.all([getProfile(r.uid).catch(() => null), loadBadges(r.uid)])
        if (shared === 'private') return { uid: r.uid, profile, badges: 0, cards: 0, hidden: true, joinedAt: r.joinedAt }
        return {
          uid: r.uid, profile, hidden: false, joinedAt: r.joinedAt,
          badges: badgeIds.filter((id) => shared.earned[id]).length,
          cards: badgeIds.reduce((n, id) => n + (shared.progress[id]?.[0] ?? 0), 0),
        }
      })))
      .then((rows) => {
        if (!live) return
        rows.sort((a, b) => Number(a.hidden) - Number(b.hidden) || b.badges - a.badges || b.cards - a.cards || a.joinedAt - b.joinedAt)
        setList(rows)
      })
      .catch(() => { if (live) setList([]) })
    return () => { live = false }
  }, [community, ids, members, sample])
  const shown = list ? (all ? list : list.slice(0, 12)) : []
  const medal = ['#d6b168', '#c7ccd3', '#c08552']
  return (
    <section className="haven-panel haven-grain relative w-full !p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="pinbook-serif text-xl font-bold text-ink">Members</h2>
        <span className="text-xs text-slate-500 tabular-nums">{members ?? list?.length ?? '–'}</span>
      </div>
      <p className="text-[11px] text-slate-500">Top collectors first</p>
      <Divider className="mt-2.5 mb-3" />
      {list === null ? <Loader2 size={18} className="animate-spin text-slate-500" />
        : list.length === 0 ? <p className="text-sm text-slate-500">No members yet — be the first to join.</p>
        : (
          <ol className="space-y-1">
            {shown.map((m, i) => (
              <li key={m.uid}>
                <Link href={m.profile ? profilePath(m.uid, m.profile.username) : '#'} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-[#f6eedb]">
                  <span className={cn('w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums', !m.hidden && i < 3 ? 'text-[#2b2014] shadow-[inset_0_-2px_3px_rgba(0,0,0,0.2)]' : 'text-slate-500')}
                    style={!m.hidden && i < 3 ? { background: `radial-gradient(circle at 35% 30%, #fff8e0, ${medal[i]} 60%)` } : undefined}>
                    {m.hidden ? '–' : i + 1}
                  </span>
                  <Avatar seed={m.uid} name={m.profile?.displayName ?? 'Collector'} photoURL={m.profile?.photoURL} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink truncate">{m.profile?.displayName ?? 'Collector'}</span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {m.hidden ? 'Badges kept private' : `${m.badges} badge${m.badges === 1 ? '' : 's'} · ${m.cards} card${m.cards === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      {list && list.length > 12 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 w-full text-xs font-semibold text-[#7a5230] hover:underline">{all ? 'Show fewer' : `Show all ${list.length}`}</button>
      )}
    </section>
  )
}

function BookViewer({ book, defs, badges, onClose }: { book: Parameters<typeof BadgeBook>[0]['set']; defs: Parameters<typeof BookCover>[0]['defs']; badges: SharedBadges | null; onClose: () => void }) {
  useScrollLock(true)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-5 py-3 text-white">
        <BookOpen size={18} />
        <p className="font-bold truncate">{book.name}</p>
        <button type="button" onClick={onClose} className="ml-auto p-2 rounded-full bg-white/10 hover:bg-white/20" aria-label="Close"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-6 flex items-start justify-center">
        {/* a member's own progress fills it in (their badges include this community's — lib/creatorShelf.ts) */}
        <div className="w-full max-w-[1100px]"><BadgeBook set={book} defs={defs} badges={badges} isMe={!!badges} /></div>
      </div>
    </div>
  )
}
