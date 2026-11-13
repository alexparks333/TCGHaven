'use client'

// /c/{uid} — a community: the creator's header picture (CommunityHeader), their book pinned in the top
// right (opened into the real pin book), name, tagline, Join / Leave and the member count, then the
// sections the creator switched on (About, Newest members — lib/creatorBooks.ts COMMUNITY_SECTIONS).
// Shown only while its creator can still run one (lib/communities.ts getCommunity). docs/creators.md.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Users, Check, LogOut, Sparkles, Wand2, Plus, ArrowUp, ArrowDown, Trash2, Palette } from 'lucide-react'
import { BlockView, type BlockContext } from '@/components/community/blocks'
import { blockName, homeBlocks, tabBlocks, type Block } from '@/lib/communityBlocks'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { Avatar } from '@/components/friends/Avatar'
import { getProfile, profilePath, type Profile } from '@/lib/firebase/friends'
import { getCommunity, joinCommunity, leaveCommunity, memberCount, newestMembers, useMyCommunities, type CommunityEntry } from '@/lib/communities'
import { useFriends } from '@/components/friends/FriendsProvider'
import { loadBadges } from '@/lib/firebase/badges'
import { cn } from '@/lib/utils'
import { blockLook } from '@/lib/blockStyle'
import { DEV_MEMBER_EVENT, DEV_MEMBER_CLEAR_EVENT, type DevMember } from '@/lib/devBoard'
import { Divider } from '@/components/creator/Ornaments'
import { CommunityHeader } from '@/components/creator/CommunityHeader'
import { sectionOn, useCreatorBook, type CreatorBook } from '@/lib/creatorBooks'
import { useStudioDevice } from '@/lib/studioDevice'
import { isLive } from '@/lib/badges'
import { BookCover, BookThickness } from '@/components/badges/BadgeLibrary'
import { OpeningBook } from '@/components/community/OpeningBook'
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
export function CommunityView({ uid, community, creator, members, mine, studio, isMember, busy, error, toggle, book, open, setOpen, tab: tabProp, onTab, builder }: {
  uid: string; community: CommunityEntry; creator: Profile | null; members: number | null; mine: boolean
  studio: ReturnType<typeof useStudioDevice>; isMember: boolean; busy: boolean; error: string; toggle: () => void
  book: CreatorBook | null; open: boolean; setOpen: (o: boolean) => void
  tab?: string; onTab?: (id: string) => void // the tab showing, when the Studio picks it (else the page keeps its own)
  builder?: PageBuilder                      // the Studio: build the open tab's blocks right on the page
}) {
  const { myBadges: progress } = useFriends()
  // Home, then the creator's own pages
  const tabs = community.page?.tabs ?? []
  const [ownTab, setOwnTab] = useState('home')
  const picked = tabProp ?? ownTab
  const current = tabs.find((t) => t.id === picked)
  const pick = (id: string) => { setOwnTab(id); onTab?.(id) }
  // The open tab's blocks: Home's, or one of the creator's pages
  const blocks = current ? tabBlocks(current) : homeBlocks(community)
  const ctx: BlockContext = { uid, community, book, canReact: isMember || mine, owner: mine && !builder }
  // The showcase book opening: it squares up off its tilt, then lifts off and flies open (OpeningBook)
  const showRef = useRef<HTMLSpanElement>(null)
  const fromRect = useRef<DOMRect | null>(null)
  const [straight, setStraight] = useState(false)
  const openBook = () => {
    if (open) return
    setStraight(true)
    setTimeout(() => { fromRect.current = showRef.current?.getBoundingClientRect() ?? null; setOpen(true) }, 200)
  }
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
            {/* the owner's Edit sits on its own line under the members (left); a fan's Join stays at the row's end */}
            <div className={mine ? 'basis-full mt-1' : 'basis-full sm:basis-auto sm:ml-auto mt-2 sm:mt-0'}>
              {mine ? (
                // the Studio is computers-only — no link to it in the app or on a phone
                studio === 'computer' ? <Link href="/creator" className="btn-secondary !inline-flex !w-auto !bg-slate-950 border border-slate-700 !text-ink"><Wand2 size={15} />Edit in Creator Studio</Link> : null
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

          {/* The page's tabs: Home, then the creator's own pages */}
          {(
            <nav className="mt-6 -mx-2 md:-mx-4 flex gap-1 overflow-x-auto no-scrollbar border-b border-[#d6c49f]" aria-label="Community pages">
              {[{ id: 'home', title: 'Home' }, ...tabs].map((t) => {
                const on = (current?.id ?? 'home') === t.id
                return (
                  <button key={t.id} type="button" onClick={() => pick(t.id)}
                    className={cn('relative shrink-0 px-4 md:px-5 py-2.5 pinbook-serif text-[15px] font-bold transition-colors whitespace-nowrap', on ? 'text-ink' : 'text-slate-500 hover:text-ink')}>
                    {t.title || 'Untitled'}
                    <span className={cn('absolute left-3 right-3 -bottom-px h-[3px] rounded-full transition-colors', on ? 'bg-[#7a5230]' : 'bg-transparent')} />
                  </button>
                )
              })}
            </nav>
          )}
        </div>

        {/* ── The book: a big picture of it, slanted on the page, over the header's corner ── */}
        <aside className="lg:col-start-2 lg:row-start-1 lg:-mt-48 relative z-10 flex flex-col items-center">
          {book ? <ShowcaseBook book={book} coverRef={showRef} straight={straight} away={open} onOpen={openBook} />
            : <p className="pinbook-serif text-sm text-slate-500 text-center py-6">{community.name} hasn&rsquo;t made their book yet.</p>}
        </aside>

        {/* ── The open tab's blocks ── */}
        <div className={cn('min-w-0 flex flex-col lg:col-start-1 lg:row-start-2', builder ? 'gap-0' : 'gap-6')}>
          {builder ? <BlockBuilder blocks={blocks} ctx={ctx} builder={builder} />
            : blocks.length ? blocks.map((b) => <BlockView key={b.id} block={b} ctx={ctx} />)
            : <p className="text-sm text-slate-500 text-center py-10">Nothing here yet.</p>}
        </div>

        {/* Members, top collectors first: beside the sections, level with the first one (after them on a phone) */}
        {sectionOn(community, 'members') && (
          <div className="min-w-0 lg:col-start-2 lg:row-start-2">
            <MembersColumn community={uid} book={book} members={members} />
          </div>
        )}
      </div>

      {open && book && (
        <OpeningBook book={book} badges={isMember || mine ? progress : null} isMe={isMember || mine}
          from={fromRect.current ?? showRef.current?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - 100, 120, 200, 282)}
          getSpot={() => showRef.current?.getBoundingClientRect() ?? null}
          onClosed={() => { setOpen(false); requestAnimationFrame(() => setStraight(false)) }} />
      )}
    </div>
  )
}

/** What the Studio's builder does with the page's blocks */
export interface PageBuilder {
  selected: string | null
  onSelect: (id: string) => void
  onStyle: (id: string) => void        // the palette: its colours, fonts and finish
  onInsert: (at: number) => void
  onMove: (id: string, d: -1 | 1) => void
  onDelete: (id: string) => void
}

/** The blocks with the builder round them: a "+" between each (and a big one at the end), and on each
 *  block an outline on hover, its name, its style (the palette), move up / down and delete — click a block
 *  to edit what's in it */
function BlockBuilder({ blocks, ctx, builder }: { blocks: Block[]; ctx: BlockContext; builder: PageBuilder }) {
  const Insert = ({ at, last }: { at: number; last?: boolean }) => last ? (
    <button type="button" onClick={() => builder.onInsert(at)}
      className="mt-4 w-full rounded-2xl border-2 border-dashed border-[#c4ae83] hover:border-[#7a5230] hover:bg-[#f6eedb]/70 py-5 text-sm font-bold text-[#7a5230] inline-flex items-center justify-center gap-2 transition-colors">
      <Plus size={18} />Add a block
    </button>
  ) : (
    <div className="group/ins relative h-6 flex items-center justify-center">
      <span className="absolute inset-x-0 top-1/2 h-px bg-[#7a5230] opacity-0 group-hover/ins:opacity-60 transition-opacity" />
      <button type="button" onClick={() => builder.onInsert(at)} aria-label="Add a block here"
        className="relative z-10 rounded-full bg-[#7a5230] text-[#fbf6ea] w-6 h-6 flex items-center justify-center opacity-0 group-hover/ins:opacity-100 focus:opacity-100 transition-opacity shadow"><Plus size={14} /></button>
    </div>
  )
  return (
    <>
      <Insert at={0} />
      {blocks.map((b, i) => {
        const on = builder.selected === b.id
        const radius = { borderRadius: blockLook(b.type, b.style).radius } // the outline follows the block's roundness
        return (
          <div key={b.id}>
            <div style={radius} className={cn('group/blk relative transition-shadow', on ? 'shadow-[0_0_0_3px_#7a5230]' : 'hover:shadow-[0_0_0_2px_rgba(122,82,48,0.55)]')}>
              <BlockView block={b} ctx={ctx} />
              {/* clicks select the block (the block's own links and buttons are for fans) */}
              <button type="button" onClick={() => builder.onSelect(b.id)} style={radius} className="absolute inset-0 z-10 cursor-pointer" aria-label={`Edit ${blockName(b.type)}`} />
              <div className={cn('absolute -top-3.5 left-4 right-4 z-20 flex items-center gap-1 transition-opacity', on ? 'opacity-100' : 'opacity-0 group-hover/blk:opacity-100')}>
                <span className="rounded-full bg-[#7a5230] text-[#fbf6ea] px-2.5 py-0.5 text-[11px] font-bold shadow">{blockName(b.type)}</span>
                <span className="flex-1" />
                <span className="flex items-center rounded-full bg-[#f6eedb] border border-[#c4ae83] shadow">
                  <button type="button" onClick={() => builder.onStyle(b.id)} className="p-1.5 pl-2 text-[#7a5230] hover:text-ink" aria-label="Style this block — colours and fonts" title="Style — colours and fonts"><Palette size={13} /></button>
                  <span className="w-px h-3.5 bg-[#c4ae83]" />
                  <button type="button" disabled={i === 0} onClick={() => builder.onMove(b.id, -1)} className="p-1.5 text-slate-500 hover:text-ink disabled:opacity-30" aria-label="Move up"><ArrowUp size={13} /></button>
                  <button type="button" disabled={i === blocks.length - 1} onClick={() => builder.onMove(b.id, 1)} className="p-1.5 text-slate-500 hover:text-ink disabled:opacity-30" aria-label="Move down"><ArrowDown size={13} /></button>
                  <button type="button" onClick={() => builder.onDelete(b.id)} className="p-1.5 text-slate-500 hover:text-red-600" aria-label="Delete this block"><Trash2 size={13} /></button>
                </span>
              </div>
            </div>
            {i < blocks.length - 1 && <Insert at={i + 1} />}
          </div>
        )
      })}
      <Insert at={blocks.length} last />
    </>
  )
}

/** The creator's book, shown off: a big picture of it standing slanted on the page with its shadow;
 *  it turns to follow the pointer (light sweeping the cover), and a click opens it over the page */
function ShowcaseBook({ book, onOpen, coverRef, straight, away }: {
  book: CreatorBook; onOpen: () => void
  coverRef: React.Ref<HTMLSpanElement> // the book itself, measured for the opening flight
  straight: boolean                     // squared up as it lifts off to open (and as it's set back down)
  away: boolean                         // it's out — open, or flying — so its spot is empty
}) {
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null)
  const t = straight ? null : tilt
  const ry = straight ? 0 : -18 + (t ? (t.x - 0.5) * 30 : 0), rx = straight ? 0 : 7 + (t ? (0.5 - t.y) * 18 : 0)
  return (
    <div className="flex flex-col items-center">
      <button type="button" onClick={onOpen} aria-label={`Open ${book.book.name}`}
        onPointerMove={(e) => { if (e.pointerType !== 'mouse') return; const r = e.currentTarget.getBoundingClientRect(); setTilt({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }) }}
        onPointerLeave={() => setTilt(null)}
        style={away ? { visibility: 'hidden' } : undefined}
        className="relative w-[200px] md:w-[250px] lg:w-[280px] aspect-[0.71] outline-none [perspective:1100px] cursor-pointer">
        {/* its shadow on the page, moving opposite the tilt */}
        <span aria-hidden className="absolute left-[8%] right-[2%] bottom-[-7%] h-[12%] rounded-[50%] bg-[#2b1a0c]/40 blur-xl transition-transform duration-200"
          style={{ transform: `translateX(${(-ry - 18) * 0.6}px) scaleX(${t ? 0.92 : 1})` }} />
        <span ref={coverRef} className="absolute inset-0 transition-transform duration-200 ease-out [transform-style:preserve-3d]"
          style={{ transform: `rotateY(${ry}deg) rotateX(${rx}deg) rotateZ(${straight ? 0 : -2}deg) ${t ? 'translateY(-8px) scale(1.02)' : ''}`, containerType: 'inline-size', filter: 'drop-shadow(18px 26px 22px rgba(40,22,8,0.45)) drop-shadow(4px 6px 4px rgba(40,22,8,0.35))' }}>
          <BookThickness look={book.book.coverStyle} />
          <span className="absolute inset-0"><BookCover set={book.book} badges={null} defs={book.badges} /></span>
          {/* the light catching the cover as it turns */}
          <span aria-hidden className="absolute inset-0 rounded-[10px] pointer-events-none mix-blend-overlay transition-opacity duration-200"
            style={{ opacity: t ? 1 : straight ? 0 : 0.35, background: `linear-gradient(${105 + (t ? (t.x - 0.5) * 60 : 0)}deg, transparent 25%, rgba(255,255,255,0.6) ${45 + (t ? (t.x - 0.5) * 30 : 0)}%, transparent 65%)` }} />
        </span>
      </button>
    </div>
  )
}

interface RankedMember { uid: string; profile: Profile | null; badges: number; cards: number; hidden: boolean; joinedAt: number; fake?: boolean /* a Dev panel member */ }

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
  // Dev panel → Community → Members: fake members on this device (dev server only)
  const [fakes, setFakes] = useState<RankedMember[]>([])
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const total = ids ? ids.split(',').length : 0
    const add = (e: Event) => {
      const d = (e as CustomEvent<DevMember>).detail
      const profile = { uid: d.key, username: '', displayName: d.name, photoURL: '', bio: '', privacy: { cardex: false, badges: false }, pinDisplay: [] }
      setFakes((f) => [...f, { uid: d.key, profile, hidden: false, joinedAt: d.at, badges: Math.round(d.badges * total), cards: d.cards, fake: true }])
    }
    const clear = () => setFakes([])
    window.addEventListener(DEV_MEMBER_EVENT, add)
    window.addEventListener(DEV_MEMBER_CLEAR_EVENT, clear)
    return () => { window.removeEventListener(DEV_MEMBER_EVENT, add); window.removeEventListener(DEV_MEMBER_CLEAR_EVENT, clear) }
  }, [ids])
  const ranked = list === null ? null : [...list, ...fakes].sort((a, b) => Number(a.hidden) - Number(b.hidden) || b.badges - a.badges || b.cards - a.cards || a.joinedAt - b.joinedAt)
  const shown = ranked ? (all ? ranked : ranked.slice(0, 12)) : []
  const medal = ['#a8771f', '#7d8590', '#9a5b2e'] // flat gold, silver, bronze
  return (
    <section className="haven-panel haven-grain relative w-full !p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="pinbook-serif text-xl font-bold text-ink">Members</h2>
        <span className="text-xs text-slate-500 tabular-nums">{members === null && !list ? '–' : (members ?? list?.length ?? 0) + fakes.length}</span>
      </div>
      <p className="text-[11px] text-slate-500">Top collectors first</p>
      <Divider className="mt-2.5 mb-3" />
      {list === null ? <Loader2 size={18} className="animate-spin text-slate-500" />
        : ranked!.length === 0 ? <p className="text-sm text-slate-500">No members yet — be the first to join.</p>
        : (
          <ol>
            {shown.map((m, i) => (
              <li key={m.uid} className="border-b border-[#d6c49f]/70 last:border-b-0">
                {(() => {
                  const row = (<>
                  {/* rank: a flat engraved numeral — gold, silver, bronze for the top three */}
                  <span className="w-5 shrink-0 text-center pinbook-serif text-[15px] font-bold tabular-nums leading-none"
                    style={{ color: !m.hidden && i < 3 ? medal[i] : '#a8957a' }}>
                    {m.hidden ? '–' : i + 1}
                  </span>
                  <Avatar seed={m.uid} name={m.profile?.displayName ?? 'Collector'} photoURL={m.profile?.photoURL} size={28} className="!rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink truncate group-hover:underline underline-offset-2">{m.profile?.displayName ?? 'Collector'}</span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {m.hidden ? 'Badges kept private' : `${m.badges} badge${m.badges === 1 ? '' : 's'} · ${m.cards} card${m.cards === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  </>)
                  // Every member's name opens their profile (fake dev members have none)
                  return m.fake ? <div className="flex items-center gap-2.5 px-1.5 py-2">{row}</div>
                    : <Link href={profilePath(m.uid, m.profile?.username)} title={`View ${m.profile?.displayName ?? 'this collector'}'s profile`} className="group flex items-center gap-2.5 px-1.5 py-2 hover:bg-[#e8dbbd]/60">{row}</Link>
                })()}
              </li>
            ))}
          </ol>
        )}
      {ranked && ranked.length > 12 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 w-full text-xs font-semibold text-[#7a5230] hover:underline">{all ? 'Show fewer' : `Show all ${ranked.length}`}</button>
      )}
    </section>
  )
}

