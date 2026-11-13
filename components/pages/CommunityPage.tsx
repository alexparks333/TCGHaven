'use client'

// /c/{uid} — a community: the creator's header picture (CommunityHeader), their book pinned in the top
// right (opened into the real pin book), name, tagline, Join / Leave and the member count, then the
// sections the creator switched on (About, Newest members — lib/creatorBooks.ts COMMUNITY_SECTIONS).
// Shown only while its creator can still run one (lib/communities.ts getCommunity). docs/creators.md.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Users, Check, LogOut, BookOpen, X, Sparkles, Wand2, Trophy, ImagePlus } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { Avatar } from '@/components/friends/Avatar'
import { getProfile, profilePath, type Profile } from '@/lib/firebase/friends'
import { getCommunity, joinCommunity, leaveCommunity, memberCount, newestAchievements, newestMembers, useMyCommunities, type Achievement, type CommunityEntry } from '@/lib/communities'
import { useFriends } from '@/components/friends/FriendsProvider'
import { BadgePin } from '@/components/badges/BadgePin'
import type { SharedBadges } from '@/lib/firebase/badges'
import { cn } from '@/lib/utils'
import { CommunityHeader } from '@/components/creator/CommunityHeader'
import { sectionOn, useCreatorBook, type Community, type CommunitySection, type CreatorBook } from '@/lib/creatorBooks'
import { useStudioDevice } from '@/lib/studioDevice'
import { isLive } from '@/lib/badges'
import { BookCover, BookThickness } from '@/components/badges/BadgeLibrary'
import { BadgeBook } from '@/components/badges/BadgeBook'
import { useScrollLock } from '@/lib/useScrollLock'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'

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
/** The Studio's Community tab edits the page in place: this switches the page into editing — text
 *  becomes fields, the header gets its picture and colour controls, every section shows with its own
 *  Shown / Hidden switch (hidden ones faded, for the creator only) */
export interface CommunityEdit {
  set: (patch: Partial<Community>) => void
  onHeader: () => void
  onEditBook: () => void
}
const BANNERS = ['#7c3aed', '#b3261e', '#2f7d6d', '#2d5bd7', '#c2571a', '#b0306a', '#4d6b1f', '#3a4660', '#9a6420', '#2f7ea0']
const fieldCls = 'w-full bg-transparent rounded-lg px-2 -mx-2 outline-none border border-transparent transition-colors hover:border-[#d6c49f] hover:bg-[#f6eedb] focus:border-[#c4ae83] focus:bg-[#f6eedb] placeholder:text-slate-600'

export function CommunityView({ uid, community, creator, members, mine, studio, isMember, busy, error, toggle, book, open, setOpen, edit }: {
  uid: string; community: CommunityEntry; creator: Profile | null; members: number | null; mine: boolean
  studio: ReturnType<typeof useStudioDevice>; isMember: boolean; busy: boolean; error: string; toggle: () => void
  book: CreatorBook | null; open: boolean; setOpen: (o: boolean) => void; edit?: CommunityEdit
}) {
  const { myBadges: progress } = useFriends()
  const on = (id: CommunitySection) => sectionOn(community, id)
  // A section as fans see it — or, while editing, every section with its Shown / Hidden switch
  const frame = (id: CommunitySection, body: React.ReactNode) => {
    if (!edit) return on(id) ? <div key={id}>{body}</div> : null
    const shown = on(id)
    const flip = () => edit.set({ page: { ...(community.page ?? {}), sections: { ...(community.page?.sections ?? {}), [id]: !shown } } })
    return (
      <div key={id} className="relative">
        <button type="button" onClick={flip} title={shown ? 'Hide it from your page' : 'Show it on your page'}
          className={cn('absolute -top-3 right-4 z-10 rounded-full border px-3 py-1 text-[11px] font-bold inline-flex items-center gap-2 shadow-sm', shown ? 'bg-[#f6eedb] border-[#c4ae83] text-ink' : 'bg-[#2b2014] border-[#2b2014] text-[#f3e6c8]')}>
          <span className={cn('w-7 h-4 rounded-full p-0.5 transition-colors', shown ? 'bg-violet-600' : 'bg-slate-600')}>
            <span className={cn('block w-3 h-3 rounded-full bg-white transition-transform', shown && 'translate-x-3')} />
          </span>
          {shown ? 'Shown on your page' : 'Hidden from fans'}
        </button>
        <div className={cn('transition-opacity', !shown && 'opacity-40 pointer-events-none select-none [&>*]:border-dashed')}>{body}</div>
      </div>
    )
  }
  return (
    <div className="flex flex-col pb-10">
      {/* The header — the creator's picture (or colour) */}
      <CommunityHeader community={community} className="rounded-2xl shadow-[0_18px_40px_-24px_rgba(40,25,10,0.7)]">
        {edit && (
          <>
            <button type="button" onClick={edit.onHeader}
              className={cn('absolute z-10 rounded-full bg-[#f6eedb]/95 border border-[#c4ae83] px-4 py-2 text-sm font-bold text-ink inline-flex items-center gap-2 shadow-md hover:bg-white',
                community.page?.header ? 'right-4 top-4' : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-5 py-2.5')}>
              <ImagePlus size={16} />{community.page?.header ? 'Change header' : 'Add a header picture'}
            </button>
            {!community.page?.header && (
              <div className="absolute left-3 bottom-3 z-10 flex flex-wrap gap-1.5 rounded-full bg-[#f6eedb]/95 border border-[#c4ae83] p-1.5 max-w-[70%]" title="Your colour (shown when there's no header picture)">
                {BANNERS.map((col) => (
                  <button key={col} type="button" onClick={() => edit.set({ color: col })} aria-label={`Colour ${col}`}
                    className={cn('w-6 h-6 rounded-full', community.color === col ? 'ring-2 ring-offset-2 ring-offset-[#f6eedb] ring-[#7a5230]' : 'hover:ring-1 hover:ring-[#c4ae83]')} style={{ background: col }} />
                ))}
              </div>
            )}
          </>
        )}
      </CommunityHeader>

      {/* Who it is · the book (top right on a computer; after the name on a phone) · the sections */}
      <div className="grid gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1fr)_260px] items-start">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="relative px-4 md:px-6 flex flex-col md:flex-row md:items-end gap-x-5 gap-y-3">
            {/* only the badge-like initial hangs over the header — the text sits below it */}
            <div className="-mt-10 md:-mt-12 w-20 h-20 md:w-24 md:h-24 rounded-3xl border-4 border-[#f3e9d3] shadow-lg flex items-center justify-center text-4xl font-black text-white shrink-0" style={{ background: community.color }}>
              {(community.name.trim()[0] || '★').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 md:pt-4">
              {edit ? (
                <>
                  <input value={community.name} maxLength={40} onChange={(e) => edit.set({ name: e.target.value })} placeholder="Your community’s name" aria-label="Community name"
                    className={cn(fieldCls, 'pinbook-serif text-2xl md:text-3xl font-bold text-ink leading-tight py-0.5')} />
                  <input value={community.tagline} maxLength={80} onChange={(e) => edit.set({ tagline: e.target.value })} placeholder="Add a one-line tagline…" aria-label="Tagline"
                    className={cn(fieldCls, 'text-sm text-slate-500 mt-1 py-0.5')} />
                </>
              ) : (
                <>
                  <h1 className="pinbook-serif text-2xl md:text-3xl font-bold text-ink leading-tight">{community.name}</h1>
                  {community.tagline && <p className="text-sm text-slate-500 mt-1">{community.tagline}</p>}
                </>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                <span className="flex items-center gap-1.5"><Users size={14} /><b className="text-ink">{members ?? '–'}</b> {members === 1 ? 'member' : 'members'}</span>
                {creator && (
                  <Link href={profilePath(uid, creator.username)} className="flex items-center gap-1.5 hover:text-ink">
                    <Avatar seed={uid} name={creator.displayName} photoURL={creator.photoURL} size={20} />by {creator.displayName}
                  </Link>
                )}
              </div>
              {edit ? (
                <div className="mt-2 flex flex-wrap gap-1.5" title="The games you collect — tap to switch on or off">
                  {(Object.keys(GAME_LABELS) as Game[]).map((g) => {
                    const has = community.games?.includes(g)
                    return (
                      <button key={g} type="button" onClick={() => edit.set({ games: has ? community.games!.filter((x) => x !== g) : [...(community.games ?? []), g] })}
                        className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold transition-colors', has ? 'text-white' : 'border border-dashed border-[#c4ae83] text-slate-500 hover:text-ink')}
                        style={has ? { background: GAME_COLORS[g] } : undefined}>{GAME_LABELS[g]}</button>
                    )
                  })}
                </div>
              ) : (community.games?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {community.games!.map((g) => <span key={g} className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: GAME_COLORS[g] }}>{GAME_LABELS[g]}</span>)}
                </div>
              )}
            </div>
            <div className="shrink-0">
              {edit ? null : mine ? (
                // the Studio is computers-only — no link to it in the app or on a phone
                studio === 'computer' ? <Link href="/creator" className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink"><Wand2 size={15} />Edit in Creator Studio</Link> : null
              ) : (
                <button type="button" onClick={toggle} disabled={busy}
                  className={isMember ? 'group btn-secondary !bg-slate-950 border border-slate-700 !text-ink' : 'btn-primary px-6'}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : isMember ? <><Check size={16} className="group-hover:hidden" /><LogOut size={16} className="hidden group-hover:block" /></> : <Sparkles size={16} />}
                  {isMember ? <><span className="group-hover:hidden">Joined</span><span className="hidden group-hover:inline">Leave</span></> : 'Join community'}
                </button>
              )}
            </div>
          </div>
          {error && <p className="px-6 mt-2 text-xs text-red-600">{error}</p>}
        </div>

        {/* The book: top right, hanging over the header's corner (on a phone: right after the name) */}
        <aside className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:-mt-28 relative z-10 flex flex-col items-center">
          {book ? (
            <div className="w-full rounded-2xl card-glass p-4 flex lg:flex-col items-center gap-4 shadow-[0_20px_40px_-20px_rgba(40,25,10,0.6)]">
              <button type="button" onClick={() => setOpen(true)} className="relative w-[110px] lg:w-[180px] aspect-[0.71] shrink-0 transition-transform hover:-translate-y-1" style={{ containerType: 'inline-size' }} aria-label={`Open ${book.book.name}`}>
                <BookThickness look={book.book.coverStyle} />
                <span className="absolute inset-0"><BookCover set={book.book} badges={null} defs={book.badges} /></span>
              </button>
              <div className="min-w-0 flex-1 lg:text-center">
                <p className="pinbook-serif font-bold text-ink truncate">{book.book.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{book.badges.length} badge{book.badges.length === 1 ? '' : 's'} to collect</p>
                <button type="button" onClick={() => setOpen(true)} className="btn-primary mt-3 lg:w-full justify-center"><BookOpen size={15} />Open the book</button>
                {edit && <button type="button" onClick={edit.onEditBook} className="mt-2 lg:w-full text-xs font-semibold text-[#7a5230] hover:underline inline-flex items-center justify-center gap-1"><Wand2 size={12} />Edit the book</button>}
                <p className="text-[11px] text-slate-500 mt-2">
                  {isMember || mine ? 'Collect the cards to earn these pins.' : 'Join to collect these pins in your own pin book.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="w-full rounded-2xl card-glass p-4 text-sm text-slate-500 text-center">{community.name} hasn&rsquo;t made their book yet.</div>
          )}
        </aside>

        <div className="min-w-0 flex flex-col gap-6 lg:col-start-1 lg:row-start-2">
          {frame('about', (
            <section className="card-glass p-5 md:p-6">
              <h2 className="pinbook-serif text-lg font-bold text-ink mb-2">About</h2>
              {edit ? (
                <>
                  <textarea value={community.about} maxLength={600} onChange={(e) => edit.set({ about: e.target.value })} aria-label="About your community"
                    placeholder="Who you are, what you collect, what members get…" className={cn(fieldCls, 'min-h-[110px] py-2 text-sm leading-relaxed text-slate-400 resize-y')} />
                  <p className="text-right text-[11px] text-slate-500 tabular-nums">{community.about.length}/600</p>
                </>
              ) : <p className="text-sm text-slate-400 whitespace-pre-line leading-relaxed">{community.about || 'No description yet.'}</p>}
            </section>
          ))}
          {frame('badgeBoard', <AchievementBoard community={uid} book={book} />)}
          {frame('members', <NewestMembers community={uid} members={members} />)}
          {edit && (
            <section className="rounded-2xl border border-dashed border-[#c4ae83] p-5 text-center">
              <p className="pinbook-serif font-bold text-ink">Community Discussion Board</p>
              <p className="text-xs text-slate-500 mt-1">Coming soon — posts your members upvote, like a forum.</p>
            </section>
          )}
        </div>

      </div>

      {open && book && <BookViewer book={book.book} defs={book.badges} badges={isMember || mine ? progress : null} onClose={() => setOpen(false)} />}
    </div>
  )
}

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
    <section className="card-glass p-5 md:p-6">
      <h2 className="pinbook-serif text-lg font-bold text-ink mb-1 flex items-center gap-2"><Trophy size={17} className="text-[#b8862b]" />Achievement Badge Board</h2>
      <p className="text-xs text-slate-500 mb-4">The newest members to earn a badge from this book.</p>
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
    </section>
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

/** The newest collectors to join */
function NewestMembers({ community, members }: { community: string; members: number | null }) {
  const [list, setList] = useState<Array<{ uid: string; profile: Profile | null }> | null>(null)
  useEffect(() => {
    newestMembers(community, 12)
      .then((rows) => Promise.all(rows.map(async (r) => ({ uid: r.uid, profile: await getProfile(r.uid).catch(() => null) }))))
      .then(setList).catch(() => setList([]))
  }, [community, members])
  return (
    <section className="card-glass p-5 md:p-6">
      <h2 className="pinbook-serif text-lg font-bold text-ink mb-3">Newest members</h2>
      {list === null ? <Loader2 size={18} className="animate-spin text-slate-500" />
        : list.length === 0 ? <p className="text-sm text-slate-500">No members yet — be the first to join.</p>
        : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3">
            {list.map(({ uid, profile }) => (
              <Link key={uid} href={profile ? profilePath(uid, profile.username) : '#'} className="flex flex-col items-center gap-1.5 rounded-xl p-2 hover:bg-slate-900/60 text-center">
                <Avatar seed={uid} name={profile?.displayName ?? 'Collector'} photoURL={profile?.photoURL} size={44} />
                <span className="text-xs font-semibold text-ink truncate w-full">{profile?.displayName ?? 'Collector'}</span>
              </Link>
            ))}
          </div>
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
