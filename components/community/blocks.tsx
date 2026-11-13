'use client'

// A community page's blocks, as fans see them (docs/creators.md "Community page blocks";
// lib/communityBlocks.ts): About, Badge Achievements, Creator Wall, Announcements, Highlighted Cards, Text,
// Picture, and the coming Community Board. The page (CommunityPage) stacks the ones on the open tab; the
// Studio draws the very same ones, with its builder around them.

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { Loader2, Trophy, Megaphone, Pin, PinOff, Trash2, Plus, MessagesSquare, Eye } from 'lucide-react'
import { Avatar } from '@/components/friends/Avatar'
import { BadgePin } from '@/components/badges/BadgePin'
import { Corners, Divider } from '@/components/creator/Ornaments'
import { getProfile, profilePath, type Profile } from '@/lib/firebase/friends'
import { watchAchievements, type Achievement, type CommunityEntry } from '@/lib/communities'
import type { CreatorBook } from '@/lib/creatorBooks'
import type { Block } from '@/lib/communityBlocks'
import { blockLook, lookVars, panelStyle, type BlockLook, type BlockStyle } from '@/lib/blockStyle'
import { CreatorWall } from '@/components/community/CreatorWall'
import { addPost, pinPost, removePost, useBlockPosts, type CommunityPost } from '@/lib/communityPosts'
import { DEV_EARNER_EVENT, DEV_EARNER_CLEAR_EVENT, type DevEarner } from '@/lib/devBoard'
import { badgeArt } from '@/lib/badgeAssets'
import { cardImage } from '@/lib/cardImage'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
import { CardZoomOverlay, type ZoomCardData } from '@/components/pages/CardexPage'
import { cn } from '@/lib/utils'

export interface BlockContext {
  uid: string; community: CommunityEntry; book: CreatorBook | null
  canReact?: boolean // a member, or the creator
  owner?: boolean    // the community's owner looking at their own page (not the Studio): posts and announces right here
}

/** The look of the block being drawn (lib/blockStyle.ts), from BlockView */
const LookCtx = createContext<BlockLook>(blockLook('text'))
export const useLook = () => useContext(LookCtx)

/** A block's panel — its colour, paper dots, border and corner flourishes, all from the block's look — with
 *  its title (in the look's title font) over an ornament divider. Every block sits in one. */
export function Section({ title, icon, sub, children, className }: { title?: string; icon?: React.ReactNode; sub?: string; children: React.ReactNode; className?: string }) {
  const l = useLook()
  return (
    <section className={cn('relative p-6 md:p-7', className)} style={panelStyle(l)}>
      {l.corners && <Corners inset={8} size={30} className="!text-[color:var(--b-corner)] !opacity-100" />}
      {title && (
        <h2 className="font-bold flex items-center gap-2.5 leading-tight [&>svg]:shrink-0 [&>svg]:text-[color:var(--b-accent)]"
          style={{ fontFamily: l.titleFont, fontSize: `${1.25 * l.titleSize}rem`, color: l.title }}>{icon}{title}</h2>
      )}
      {sub && <p className="text-xs mt-1" style={{ color: l.muted }}>{sub}</p>}
      {title && <Divider className="mt-3 mb-4 !text-[color:var(--b-corner)] [&>span]:!to-[color:var(--b-line)]" />}
      {children}
    </section>
  )
}

export function timeAgo(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** An About or Text block's alignment and text size (Style → Layout) */
function textLayout(b: Block): React.CSSProperties {
  const o = b.style?.layout ?? {}
  return { textAlign: o.align ?? 'left', fontSize: o.size ?? 15 }
}

/** timeAgo, phone-short: "now", "5m", "3h", "2d", "4w" */
function shortAgo(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return m + 'm'
  const h = Math.round(m / 60)
  if (h < 24) return h + 'h'
  const d = Math.round(h / 24)
  return d < 30 ? d + 'd' : Math.round(d / 7) + 'w'
}

/** One block, as fans see it */
export function BlockView({ block, ctx }: { block: Block; ctx: BlockContext }) {
  const look = blockLook(block.type, block.style)
  return <LookCtx.Provider value={look}><div style={lookVars(look)}><BlockBody block={block} ctx={ctx} /></div></LookCtx.Provider>
}

function BlockBody({ block, ctx }: { block: Block; ctx: BlockContext }) {
  const l = useLook()
  switch (block.type) {
    case 'about':
      return (
        <Section title="About">
          <p className="text-[color:var(--b-text)] whitespace-pre-line leading-relaxed" style={textLayout(block)}>{ctx.community.about || 'No description yet.'}</p>
        </Section>
      )
    case 'badges': return <AchievementBoard community={ctx.uid} book={ctx.book} title={block.title} styleOf={block.style} />
    case 'wall': return <CreatorWall block={block} ctx={ctx} />
    case 'announcements': return <Announcements block={block} ctx={ctx} />
    case 'cards': return <HighlightedCards block={block} />
    case 'text':
      return (
        <Section title={block.title || undefined}>
          {block.body.trim()
            ? <div className="text-[color:var(--b-text)] whitespace-pre-line leading-relaxed" style={textLayout(block)}>{block.body}</div>
            : <p className="text-sm text-[color:var(--b-muted)] italic">Nothing here yet.</p>}
        </Section>
      )
    case 'picture': {
      const pic = (
        <figure className="relative">
          {block.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badgeArt(block.image, 1600)} alt={block.caption ?? ''} className="w-full object-cover"
              style={{ borderRadius: l.frame ? Math.max(0, l.radius - 6) : l.radius, maxHeight: block.style?.picture?.height ?? 520 }} />
          ) : (
            <div className="w-full aspect-[16/7] border-2 border-dashed border-[color:var(--b-line)] flex items-center justify-center text-sm text-[color:var(--b-muted)]" style={{ borderRadius: l.radius }}>A picture goes here</div>
          )}
          {block.caption && <figcaption className="mt-2.5 text-center text-sm italic" style={{ fontFamily: l.titleFont, color: l.frame ? l.text : l.muted }}>{block.caption}</figcaption>}
        </figure>
      )
      return l.frame ? <Section className="!p-3 md:!p-4">{pic}</Section> : pic
    }
    case 'board':
      return (
        <Section title={block.title || 'Community Board'} icon={<MessagesSquare size={19} />}>
          <p className="text-sm text-[color:var(--b-muted)]">Coming soon — members will post here and upvote the best.</p>
        </Section>
      )
  }
}

interface BoardRow { key: string; member: string; badge: string; earnedAt: number; profile: Profile | null; fake?: boolean }
const BOARD_ROWS = 6 // the newest six; when a seventh arrives the oldest slides off the bottom

/** Badge Achievements: a dark leaderboard of the newest members to earn one of this creator's badges. It
 *  stays live (watchAchievements): a new earner slides in at the top with a gold flash and their pin pops
 *  on. On the dev server, the Dev panel's Community tab can send fake earners (lib/devBoard.ts). */
export function AchievementBoard({ community, book, title, sample, styleOf }: { community: string; book: CreatorBook | null; title?: string; styleOf?: BlockStyle; sample?: Array<Achievement & { profile: Profile | null }> /* dev checks */ }) {
  const [real, setReal] = useState<BoardRow[] | null>(sample ? sample.map((a) => ({ ...a, key: a.member + a.badge })) : null)
  const [fakes, setFakes] = useState<BoardRow[]>([])
  const profiles = useRef(new Map<string, Promise<Profile | null>>())
  useEffect(() => {
    if (sample) return
    let alive = true
    const stop = watchAchievements(community, BOARD_ROWS, (rows) => {
      Promise.all(rows.map(async (r) => {
        if (!profiles.current.has(r.member)) profiles.current.set(r.member, getProfile(r.member).catch(() => null))
        return { ...r, key: r.member + r.badge, profile: await profiles.current.get(r.member)! }
      })).then((list) => { if (alive) setReal(list) })
    }, () => { if (alive) setReal((r) => r ?? []) })
    return () => { alive = false; stop() }
  }, [community, sample])

  // Dev panel → Community → fake earners (dev server only)
  const badgeIds = (book?.badges ?? []).map((b) => b.id).join(',')
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const ids = badgeIds ? badgeIds.split(',') : []
    const add = (e: Event) => {
      const d = (e as CustomEvent<DevEarner>).detail
      const badge = d.badge && ids.includes(d.badge) ? d.badge : ids[Math.floor(Math.random() * ids.length)]
      if (!badge) return
      const profile = { uid: d.key, username: '', displayName: d.name, photoURL: '', bio: '', privacy: { cardex: false, badges: false }, pinDisplay: [] }
      setFakes((f) => [{ key: d.key, member: d.key, badge, earnedAt: d.at, profile, fake: true }, ...f].slice(0, BOARD_ROWS))
    }
    const clear = () => setFakes([])
    window.addEventListener(DEV_EARNER_EVENT, add)
    window.addEventListener(DEV_EARNER_CLEAR_EVENT, clear)
    return () => { window.removeEventListener(DEV_EARNER_EVENT, add); window.removeEventListener(DEV_EARNER_CLEAR_EVENT, clear) }
  }, [badgeIds])

  // "2 min ago" keeps counting
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t) }, [])

  const defOf = (id: string) => book?.badges.find((b) => b.id === id)
  const shown = real === null ? [] : [...fakes, ...real].filter((a) => defOf(a.badge)).sort((a, b) => b.earnedAt - a.earnedAt).slice(0, BOARD_ROWS)

  // How each row came on: the first load fades in one after another; anyone after that arrives.
  const entry = useRef(new Map<string, 'in' | 'arrive'>())
  const loaded = useRef(false)
  shown.forEach((a) => { if (!entry.current.has(a.key)) entry.current.set(a.key, loaded.current ? "arrive" : "in") })
  useEffect(() => { if (real !== null) loaded.current = true }, [real])

  // A row pushed off the bottom stays a moment to slide away (board-row-leave)
  const [leaving, setLeaving] = useState<BoardRow[]>([])
  const before = useRef<BoardRow[]>([])
  const shownKeys = shown.map((a) => a.key).join()
  useEffect(() => {
    const gone = before.current.filter((r) => !shown.some((a) => a.key === r.key))
    before.current = shown
    if (!gone.length) return
    setLeaving((l) => [...l, ...gone])
    const t = setTimeout(() => setLeaving((l) => l.filter((r) => !gone.includes(r))), 900)
    return () => clearTimeout(t)
  }, [shownKeys]) // eslint-disable-line react-hooks/exhaustive-deps

  const lo = { headers: true, highlight: true, pin: 30, ...(styleOf?.leader ?? {}) } // Style → Leaderboard
  const cols = 'grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] items-center gap-3'
  return (
    <Section title={title || 'Badge Achievements'} icon={<Trophy size={19} />} sub="The newest badges earned from this book.">
      {real === null ? <Loader2 size={18} className="animate-spin text-[color:var(--b-muted)]" />
        : shown.length === 0 ? <p className="text-sm text-[color:var(--b-muted)]">No one has earned a badge yet — collect the cards and be the first.</p>
        : (
          <div className="-mx-1">
            {lo.headers && <div className={cn(cols, 'px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--b-muted)] border-b border-[color:var(--b-line)]')}>
              <span>Collector</span><span>Badge</span><span className="text-right">Earned</span>
            </div>}
            <ol>
              {[...shown, ...leaving.filter((r) => !shown.some((a) => a.key === r.key))].map((a, i) => {
                const out = i >= shown.length // sliding off the bottom
                const def = defOf(a.badge)!
                const name = a.profile?.displayName ?? 'A collector'
                const how = entry.current.get(a.key)
                return (
                  <li key={a.key}
                    className={cn(cols, 'relative h-12 sm:h-11 px-3 border-b border-[color:var(--b-hair)] last:border-b-0 transition-colors duration-700',
                      i === 0 && lo.highlight ? 'bg-[color:var(--b-tint)]' : 'hover:bg-[color:var(--b-hover)]', out ? 'board-row-leave pointer-events-none' : how === 'arrive' ? 'board-row-arrive' : 'board-row-in')}
                    style={how === 'in' && !out ? { animationDelay: `${i * 70}ms` } : undefined}>
                    {how === 'arrive' && <span className="board-row-flash absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--b-accent) 40%, transparent), color-mix(in srgb, var(--b-accent) 15%, transparent) 50%, transparent)' }} />}
                    {i === 0 && lo.highlight && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[color:var(--b-accent)]" />}
                    {(() => {
                      const who = (<>
                      <span className="shrink-0"><Avatar seed={a.member} name={name} photoURL={a.profile?.photoURL} size={26} className="!rounded-md" /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-[color:var(--b-title)] group-hover:underline underline-offset-2 decoration-[color:var(--b-accent)]">{name}</span>
                        <span className="sm:hidden block truncate [font-family:var(--b-title-font)] text-[11px] font-bold text-[color:var(--b-accent)]">{def.name}</span>
                      </span>
                      </>)
                      // Every real member's name opens their profile (fake dev earners have none)
                      return a.fake ? <span className="relative flex items-center gap-2.5 min-w-0">{who}</span>
                        : <Link href={profilePath(a.member, a.profile?.username)} title={`View ${name}'s profile`} className="relative z-[1] flex items-center gap-2.5 min-w-0 group rounded-md">{who}</Link>
                    })()}
                    <span className="relative flex items-center gap-2 min-w-0">
                      <span className={cn('relative shrink-0 flex items-center justify-center', how === 'arrive' && 'board-pin-pop')} style={{ width: lo.pin + 2, height: Math.min(lo.pin + 6, 44) }}>
                        <BadgePin art={def.art} imageUrl={def.imageUrl} size={lo.pin} />
                      </span>
                      <span className="hidden sm:block truncate [font-family:var(--b-title-font)] text-[13px] font-bold text-[color:var(--b-accent)]">{def.name}</span>
                    </span>
                    <span className={cn('relative text-right text-[11px] tabular-nums whitespace-nowrap', i === 0 && lo.highlight ? 'text-[color:var(--b-accent)] font-semibold' : 'text-[color:var(--b-muted)]')}>
                      <span className="hidden sm:inline">{timeAgo(a.earnedAt)}</span><span className="sm:hidden">{shortAgo(a.earnedAt)}</span>
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
    </Section>
  )
}

/** Announcements: the pinned one first, then newest */
function Announcements({ block, ctx }: { block: Extract<Block, { type: 'announcements' }>; ctx: BlockContext }) {
  const items = block.style?.layout?.items ?? 'filled'
  // The owner's (community_posts, put up on the page) and any older ones saved inside the block
  const live = useBlockPosts(ctx.uid, block.id)
  const list = [
    ...live.map((p) => ({ id: p.id, title: p.title ?? '', body: p.text, at: p.at, pinned: !!p.pinned, live: true })),
    ...block.items.map((a) => ({ ...a, live: false })),
  ].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at)
  const fail = () => alert('That didn\'t save — check your connection and try again.')
  return (
    <Section title={block.title || 'Announcements'} icon={<Megaphone size={19} />}>
      {ctx.owner && <AnnounceComposer uid={ctx.uid} block={block.id} live={live} />}
      {/* the items' look: filled cards, outlines, or plain with a rule between (Style → Layout) */}
      {list.length === 0 ? <p className="text-sm text-[color:var(--b-muted)]">No announcements yet.</p> : (
        <div className="space-y-3">
          {list.map((a) => (
            <article key={a.id} className={cn('group/ann', items === 'plain' ? 'py-3 border-b border-[color:var(--b-hair)] last:border-b-0' : 'rounded-md p-4 border',
              items === 'filled' && (a.pinned ? 'bg-[color:var(--b-tint)] border-[color:var(--b-corner)]' : 'bg-[color:var(--b-hover)] border-[color:var(--b-hair)]'),
              items === 'outlined' && (a.pinned ? 'border-[color:var(--b-accent)]' : 'border-[color:var(--b-line)]'))}>
              <div className="flex items-start gap-2">
                {a.pinned && <Pin size={14} className="mt-1 shrink-0 text-[color:var(--b-accent)]" />}
                <h3 className="[font-family:var(--b-title-font)] text-base font-bold text-[color:var(--b-title)] flex-1">{a.title || 'Announcement'}</h3>
                {ctx.owner && a.live && (
                  <span className="flex items-center gap-0.5 opacity-0 group-hover/ann:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button type="button" onClick={() => pinPost(live, a.id, !a.pinned).catch(fail)} title={a.pinned ? 'Unpin' : 'Pin to the top'}
                      className="p-1 text-[color:var(--b-muted)] hover:text-[color:var(--b-title)]">{a.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
                    <button type="button" onClick={() => { if (confirm('Remove this announcement? This can\'t be undone.')) removePost(a.id).catch(fail) }} title="Remove"
                      className="p-1 text-[color:var(--b-muted)] hover:text-[#b8402f]"><Trash2 size={14} /></button>
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-[color:var(--b-muted)]">{new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              {a.body && <p className="mt-1.5 text-sm text-[color:var(--b-text)] whitespace-pre-line leading-relaxed">{a.body}</p>}
            </article>
          ))}
        </div>
      )}
    </Section>
  )
}

/** The owner's "New announcement", right on their community page */
function AnnounceComposer({ uid, block, live }: { uid: string; block: string; live: CommunityPost[] }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const reset = () => { setTitle(''); setBody(''); setPinned(false); setErr(''); setOpen(false) }
  async function post() {
    if (!title.trim()) return
    setBusy(true); setErr('')
    try {
      if (pinned) await Promise.all(live.filter((p) => p.pinned).map((p) => pinPost(live, p.id, false))) // one pinned at a time
      await addPost({ community: uid, block, kind: 'announcement', title: title.trim(), text: body.trim(), pinned })
      reset()
    } catch { setErr('Couldn\'t post it — check your connection and try again.') } finally { setBusy(false) }
  }
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)}
      className="mb-4 w-full rounded-md border border-dashed border-[color:var(--b-line)] py-2.5 text-sm font-bold text-[color:var(--b-accent)] inline-flex items-center justify-center gap-2 hover:bg-[color:var(--b-hover)] transition-colors">
      <Plus size={16} />New announcement
    </button>
  )
  return (
    <div className="mb-4 rounded-md border border-[color:var(--b-line)] bg-[color:var(--b-hover)] p-3.5">
      <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Headline — e.g. New badge drops Friday"
        className="w-full bg-transparent [font-family:var(--b-title-font)] text-base font-bold text-[color:var(--b-title)] placeholder:text-[color:var(--b-muted)] outline-none" />
      <textarea value={body} maxLength={1500} onChange={(e) => setBody(e.target.value)} placeholder="The details (optional)"
        className="mt-1.5 w-full min-h-[70px] resize-y bg-transparent text-sm text-[color:var(--b-text)] placeholder:text-[color:var(--b-muted)] outline-none" />
      <div className="flex items-center gap-2 border-t border-[color:var(--b-hair)] pt-2.5">
        <button type="button" onClick={() => setPinned((p) => !p)}
          className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold', pinned ? 'border-[color:var(--b-accent)] text-[color:var(--b-accent)]' : 'border-[color:var(--b-line)] text-[color:var(--b-muted)]')}>
          <Pin size={12} />{pinned ? 'Pinned to the top' : 'Pin to the top'}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={reset} className="px-2.5 py-1 text-xs font-bold text-[color:var(--b-muted)] hover:text-[color:var(--b-title)]">Cancel</button>
        <button type="button" onClick={post} disabled={busy || !title.trim()}
          className="rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5" style={{ background: 'var(--b-accent)', color: 'var(--b-bg)' }}>
          {busy && <Loader2 size={12} className="animate-spin" />}Announce
        </button>
      </div>
      {err && <p className="mt-2 text-xs font-semibold text-[#b8402f]">{err}</p>}
    </div>
  )
}

/** Highlighted Cards: the cards the creator picked to show off, each one looked at big with a tap */
function HighlightedCards({ block }: { block: Extract<Block, { type: 'cards' }> }) {
  const [zoom, setZoom] = useState<ZoomCardData | null>(null)
  const o = block.style?.cards ?? {}
  const grid = ({ 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 5: 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-5' } as Record<number, string>)[o.columns ?? 4] ?? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4'
  return (
    <Section title={block.title || 'Highlighted Cards'} sub={block.note}>
      {block.cards.length === 0 ? <p className="text-sm text-[color:var(--b-muted)]">No cards picked yet.</p> : (
        <div className={cn('grid gap-4', grid)}>
          {block.cards.map((s, i) => {
            const c = s.cards?.[0]
            const g = (s as { game?: Game }).game
            return (
              <button key={s.cardIds.join() + i} type="button" className="group text-left"
                onClick={(e) => setZoom({
                  imageUrl: c?.imageUrl ?? '', name: c?.name ?? s.label, number: c?.number ?? '', setName: c?.setName, rarityLabel: '', rarityColor: '#7a6a55',
                  marketPrice: 0, owned: true, quantity: 0, glowColor: g ? GAME_COLORS[g] : '#d6b168', originRect: e.currentTarget.getBoundingClientRect(),
                } as ZoomCardData)}>
                <span className="relative block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cardImage(c?.imageUrl, 'grid') ?? c?.imageUrl} alt={s.label} loading="lazy"
                    className="w-full aspect-[63/88] object-cover transition-transform group-hover:-translate-y-1" style={{ borderRadius: o.round ?? 8 }} />
                  <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Eye size={13} /></span>
                </span>
                {o.names !== false && <>
                <span className="mt-2 block text-sm font-bold text-[color:var(--b-title)] truncate">{s.label}</span>
                <span className="block text-[11px] text-[color:var(--b-muted)] truncate">{c?.setName}{c?.number ? ` · #${c.number}` : ''}{g ? ` · ${GAME_LABELS[g]}` : ''}</span>
                </>}
              </button>
            )
          })}
        </div>
      )}
      {typeof document !== 'undefined' && createPortal(<div className="relative z-[85]"><CardZoomOverlay data={zoom} onClose={() => setZoom(null)} viewOnly /></div>, document.body)}
    </Section>
  )
}
