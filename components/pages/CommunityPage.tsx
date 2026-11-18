'use client'

// /c/{uid} — a community: the creator's header picture (CommunityHeader), their book pinned in the top
// right (opened into the real pin book), name, tagline, Join / Leave and the member count, then the
// sections the creator switched on (About, Newest members — lib/creatorBooks.ts COMMUNITY_SECTIONS).
// Shown only while its creator can still run one (lib/communities.ts getCommunity). docs/creators.md.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Users, Check, LogOut, Sparkles, Wand2, Plus, ArrowUp, ArrowDown, Trash2, Palette } from 'lucide-react'
import { LogoLoader } from '@/components/LogoLoader'
import { BlockView, LookScope, Section, type BlockContext } from '@/components/community/blocks'
import { Medal, METALS } from '@/components/community/Medals'
import { blockName, homeBlocks, tabBlocks, type Block } from '@/lib/communityBlocks'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { Avatar } from '@/components/friends/Avatar'
import { getProfile, profilePath, type Profile } from '@/lib/firebase/friends'
import { getCommunity, joinCommunity, leaveCommunity, memberCount, newestMembers, useMyCommunities, type CommunityEntry } from '@/lib/communities'
import { useFriends } from '@/components/friends/FriendsProvider'
import { loadBadges } from '@/lib/firebase/badges'
import { cn } from '@/lib/utils'
import { badgeArt } from '@/lib/badgeAssets'
import { blockLook } from '@/lib/blockStyle'
import { DEV_MEMBER_EVENT, DEV_MEMBER_CLEAR_EVENT, type DevMember } from '@/lib/devBoard'
import { Divider } from '@/components/creator/Ornaments'
import { CommunityHeader } from '@/components/creator/CommunityHeader'
import { sectionOn, useCreatorBook, type CreatorBook, type MembersLook } from '@/lib/creatorBooks'
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

  if (community === undefined) return <LogoLoader label="Loading community…" />
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
    <div className="relative flex flex-col pb-12">
      {/* The header — the creator's picture (or colour) */}
      <div className="relative">
        <CommunityHeader community={community} className="rounded-3xl shadow-[0_24px_50px_-28px_rgba(40,25,10,0.8)]" />
        {/* The community's emblem, half over the header's bottom edge in a frosted frame */}
        <div className="absolute left-5 md:left-9 bottom-0 translate-y-1/2 z-[5] w-[104px] h-[104px] md:w-[136px] md:h-[136px] rounded-[32px] p-2 md:p-2.5 bg-[#3a2a1a]/25 backdrop-blur-md ring-1 ring-white/35 shadow-[0_16px_34px_-12px_rgba(30,18,8,0.65)]">
          {community.page?.emblem ? (
            // the creator's own picture (Studio → Page details → Community picture)
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badgeArt(community.page.emblem, 400)} alt="" className="w-full h-full rounded-[24px] object-cover shadow-[0_2px_6px_rgba(0,0,0,0.25)]" />
          ) : (
            <div className="w-full h-full rounded-[24px] flex items-center justify-center pinbook-serif text-5xl md:text-6xl font-bold text-white shadow-[inset_0_-6px_12px_rgba(0,0,0,0.25),inset_0_2px_0_rgba(255,255,255,0.25)]"
              style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${community.color} 82%, white), ${community.color} 55%, color-mix(in srgb, ${community.color} 70%, black))` }}>
              {(community.name.trim()[0] || '★').toUpperCase()}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        {/* ── Who it is ── */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 px-2 md:px-4">
          {/* beside the emblem (below it on a phone) */}
          {/* clear of the book on the right (phones and tablets) */}
          <div className={cn('pt-16 sm:pt-4 sm:pl-[124px] md:pl-[164px]', book && 'pr-[128px] sm:pr-[180px] lg:pr-0')}>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#8a6420]">Community</p>
              <h1 className="pinbook-serif text-3xl md:text-[40px] font-bold text-ink leading-[1.05] mt-0.5">{community.name}</h1>
              {community.tagline && <p className="mt-1.5 text-base md:text-lg italic text-slate-500" style={{ fontFamily: 'Georgia, serif' }}>{community.tagline}</p>}
            </div>
          </div>

          {/* A byline (who runs it · how many members), then the games on their own row as coloured tags, then Join */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-slate-500">
            {creator && (
              <Link href={profilePath(uid, creator.username)} className="group inline-flex items-center gap-2 hover:text-ink">
                <Avatar seed={uid} name={creator.displayName} photoURL={creator.photoURL} size={26} className="ring-2 ring-[#fbf6ea] shadow-sm" />
                <span>Run by <b className="text-ink group-hover:underline underline-offset-2">{creator.displayName}</b></span>
              </Link>
            )}
            {creator && <span aria-hidden className="w-1 h-1 rounded-full bg-[#b9a27c]" />}
            <span className="inline-flex items-center gap-1.5"><Users size={15} className="text-[#8a6420]" /><b className="text-ink tabular-nums">{members ?? '–'}</b> {members === 1 ? 'member' : 'members'}</span>
          </div>
          {(community.games ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#8a6420]">Collects</span>
              {(community.games ?? []).map((g) => (
                // a tag in the game's own colour: a solid edge on the left, its colour washed behind the name
                <span key={g} className="inline-flex items-center rounded-[5px] pl-2 pr-2.5 py-[3px] text-[11px] font-bold uppercase tracking-[0.08em] border-l-[3px]"
                  style={{ borderColor: GAME_COLORS[g], background: `color-mix(in srgb, ${GAME_COLORS[g]} 16%, #fbf6ea)`, color: `color-mix(in srgb, ${GAME_COLORS[g]} 65%, #2b2014)` }}>
                  {GAME_LABELS[g]}
                </span>
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {/* the owner's Edit / a fan's Join: always on its own line under the byline and games */}
            <div className="basis-full">
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
        {/* On a phone or tablet it sits the same way as on a computer — top right, over the header's corner — just
            smaller (the header is a quarter of the page's width tall, so mt-[25%] is its bottom edge) */}
        <aside className="absolute right-1 sm:right-4 top-0 mt-[calc(25%-74px)] sm:mt-[calc(25%-108px)] lg:relative lg:right-auto lg:-mt-48 lg:col-start-2 lg:row-start-1 z-10 flex flex-col items-center">
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
            {builder ? (
              // the Studio: click Members to set it up, the palette for its look — like a block
              <div style={{ borderRadius: blockLook('members', community.page?.members?.style).radius }}
                className={cn('group/blk relative transition-shadow', builder.selected === MEMBERS_ID ? 'shadow-[0_0_0_3px_#7a5230]' : 'hover:shadow-[0_0_0_2px_rgba(122,82,48,0.55)]')}>
                <MembersColumn community={uid} book={book} members={members} look={community.page?.members} />
                <button type="button" onClick={() => builder.onSelect(MEMBERS_ID)} className="absolute inset-0 z-10 cursor-pointer" style={{ borderRadius: 'inherit' }} aria-label="Edit Members" />
                <div className={cn('absolute -top-3.5 left-4 right-4 z-20 flex items-center gap-1 transition-opacity', builder.selected === MEMBERS_ID ? 'opacity-100' : 'opacity-0 group-hover/blk:opacity-100')}>
                  <span className="rounded-full bg-[#7a5230] text-[#fbf6ea] px-2.5 py-0.5 text-[11px] font-bold shadow">Members</span>
                  <span className="flex-1" />
                  <button type="button" onClick={() => builder.onStyle(MEMBERS_ID)} className="rounded-full bg-[#f6eedb] border border-[#c4ae83] shadow p-1.5 text-[#7a5230] hover:text-ink" aria-label="Style Members — colours and fonts" title="Style — colours and fonts"><Palette size={13} /></button>
                </div>
              </div>
            ) : <MembersColumn community={uid} book={book} members={members} look={community.page?.members} />}
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

/** The id the Studio's builder uses for the Members panel beside the page (it's not a block, but is picked like one) */
export const MEMBERS_ID = '__members'

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
        className="relative w-[118px] sm:w-[170px] lg:w-[280px] aspect-[0.71] outline-none [perspective:1100px] cursor-pointer">
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
export function MembersColumn({ community, book, members, sample, look }: { community: string; book: CreatorBook | null; members: number | null; sample?: RankedMember[] /* dev checks */; look?: MembersLook /* the owner's setup (Studio → click Members) */ }) {
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
  const o = { order: 'top' as const, shown: 12, detail: 'both' as const, medals: true, bars: true, count: true, round: false, medalStyle: 'ribbon' as const, shine: true, podium: true, ...(look ?? {}) }
  const top = o.order !== 'newest'
  const ranked = list === null ? null : [...list, ...fakes].sort(top
    ? (a, b) => Number(a.hidden) - Number(b.hidden) || b.badges - a.badges || b.cards - a.cards || a.joinedAt - b.joinedAt
    : (a, b) => b.joinedAt - a.joinedAt)
  const limit = Math.max(3, Math.min(25, o.shown))
  const shown = ranked ? (all ? ranked : ranked.slice(0, limit)) : []
  const total = book?.badges.length ?? 0
  const count = members === null && !list ? '–' : (members ?? list?.length ?? 0) + fakes.length
  const detail = (m: RankedMember) => m.hidden ? 'Badges kept private'
    : o.detail === 'badges' ? `${m.badges} badge${m.badges === 1 ? '' : 's'}`
    : o.detail === 'cards' ? `${m.cards} card${m.cards === 1 ? '' : 's'}`
    : o.detail === 'none' ? null
    : `${m.badges} badge${m.badges === 1 ? '' : 's'} · ${m.cards} card${m.cards === 1 ? '' : 's'}`
  return (
    <LookScope type="members" style={o.style}>
      <Section title={o.title || 'Members'} icon={<Users size={19} />} sub={o.sub ?? (top ? 'Top collectors first' : 'Newest first')} className="w-full !p-5">
        {o.count && (
          <span className="absolute top-5 right-5 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums border border-[color:var(--b-line)] text-[color:var(--b-accent)] bg-[color:var(--b-tint)]">{count}</span>
        )}
        {list === null ? <Loader2 size={18} className="animate-spin text-[color:var(--b-muted)]" />
          : ranked!.length === 0 ? <p className="text-sm text-[color:var(--b-muted)]">No members yet — be the first to join.</p>
          : (
            <ol className="-mx-1.5 space-y-0.5">
              {shown.map((m, i) => {
                const place = top && o.medals && !m.hidden && i < 3 ? (i as 0 | 1 | 2) : null
                const metal = place !== null ? METALS[place] : null
                const name = m.profile?.displayName ?? 'Collector'
                const line = detail(m)
                const row = (<>
                  {/* rank: a medal for the top three (the owner's style — Medals.tsx), then a quiet numeral (newest-first shows no rank) */}
                  {top && (place !== null ? (
                    <span className="w-8 shrink-0 flex justify-center"><Medal place={place} style={o.medalStyle} art={o.medalArt?.[place] || undefined} shine={o.shine} size={place === 0 ? 32 : 28} /></span>
                  ) : (
                    <span className="w-8 shrink-0 text-center pinbook-serif text-[14px] font-bold tabular-nums text-[color:var(--b-muted)]">{m.hidden ? '–' : i + 1}</span>
                  ))}
                  <span className="shrink-0 rounded-[9px] p-[2px]" style={{ background: metal ? `linear-gradient(150deg, ${metal.hi}, ${metal.mid} 55%, ${metal.lo})` : 'transparent', borderRadius: o.round ? 999 : 9 }}>
                    <Avatar seed={m.uid} name={name} photoURL={m.profile?.photoURL} size={30} className={o.round ? '!rounded-full' : '!rounded-md'} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate text-[color:var(--b-title)] group-hover:underline underline-offset-2 decoration-[color:var(--b-accent)]">{name}</span>
                    {line && <span className="block text-[11px] truncate text-[color:var(--b-muted)]">{line}</span>}
                    {o.bars && total > 0 && !m.hidden && (
                      <span className="mt-1 block h-[3px] rounded-full overflow-hidden bg-[color:var(--b-hair)]">
                        <span className="block h-full rounded-full bg-[color:var(--b-accent)]" style={{ width: `${Math.min(100, (m.badges / total) * 100)}%` }} />
                      </span>
                    )}
                  </span>
                </>)
                const cls = 'group flex items-center gap-2.5 rounded-lg px-1.5 py-2 transition-colors hover:bg-[color:var(--b-hover)]'
                // Podium: the top three rows washed in their metal from the left, fading out
                const wash = metal && o.podium ? { background: `linear-gradient(90deg, color-mix(in srgb, ${metal.row} ${place === 0 ? 30 : 20}%, transparent), transparent 85%)` } : undefined
                // Every member's name opens their profile (fake dev members have none)
                return (
                  <li key={m.uid}>
                    {m.fake ? <div className={cls} style={wash}>{row}</div>
                      : <Link href={profilePath(m.uid, m.profile?.username)} title={`View ${name}'s profile`} className={cls} style={wash}>{row}</Link>}
                  </li>
                )
              })}
            </ol>
          )}
        {ranked && ranked.length > limit && (
          <button type="button" onClick={() => setAll((a) => !a)} className="mt-2.5 w-full rounded-md border border-dashed border-[color:var(--b-line)] py-1.5 text-xs font-bold text-[color:var(--b-accent)] hover:bg-[color:var(--b-hover)]">{all ? 'Show fewer' : `Show all ${ranked.length}`}</button>
        )}
      </Section>
    </LookScope>
  )
}

