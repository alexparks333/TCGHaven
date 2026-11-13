'use client'

// A community page's blocks, as fans see them (docs/creators.md "Community page blocks";
// lib/communityBlocks.ts): About, Badge Achievements, Creator Wall, Announcements, Highlighted Cards, Text,
// Picture, and the coming Community Board. The page (CommunityPage) stacks the ones on the open tab; the
// Studio draws the very same ones, with its builder around them.

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { Loader2, Trophy, Megaphone, Pin, Sparkles, MessagesSquare, Eye } from 'lucide-react'
import { Avatar } from '@/components/friends/Avatar'
import { BadgePin } from '@/components/badges/BadgePin'
import { Corners, Divider } from '@/components/creator/Ornaments'
import { getProfile, profilePath, type Profile } from '@/lib/firebase/friends'
import { watchAchievements, type Achievement, type CommunityEntry } from '@/lib/communities'
import type { CreatorBook } from '@/lib/creatorBooks'
import type { Block } from '@/lib/communityBlocks'
import { blockLook, lookVars, panelStyle, type BlockLook } from '@/lib/blockStyle'
import { DEV_EARNER_EVENT, DEV_EARNER_CLEAR_EVENT, type DevEarner } from '@/lib/devBoard'
import { badgeArt } from '@/lib/badgeAssets'
import { cardImage } from '@/lib/cardImage'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
import { CardZoomOverlay, type ZoomCardData } from '@/components/pages/CardexPage'
import { cn } from '@/lib/utils'

export interface BlockContext { uid: string; community: CommunityEntry; book: CreatorBook | null }

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
          <p className="text-[15px] text-[color:var(--b-text)] whitespace-pre-line leading-relaxed">{ctx.community.about || 'No description yet.'}</p>
        </Section>
      )
    case 'badges': return <AchievementBoard community={ctx.uid} book={ctx.book} title={block.title} />
    case 'wall': return <CreatorWall block={block} ctx={ctx} />
    case 'announcements': return <Announcements block={block} />
    case 'cards': return <HighlightedCards block={block} />
    case 'text':
      return (
        <Section title={block.title || undefined}>
          {block.body.trim()
            ? <div className="text-[15px] text-[color:var(--b-text)] whitespace-pre-line leading-relaxed">{block.body}</div>
            : <p className="text-sm text-[color:var(--b-muted)] italic">Nothing here yet.</p>}
        </Section>
      )
    case 'picture': {
      const pic = (
        <figure className="relative">
          {block.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badgeArt(block.image, 1600)} alt={block.caption ?? ''} className={cn('w-full max-h-[520px] object-cover', !l.frame && 'shadow-[0_18px_36px_-20px_rgba(40,25,10,0.7)]')}
              style={{ borderRadius: l.frame ? Math.max(0, l.radius - 6) : l.radius }} />
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
export function AchievementBoard({ community, book, title, sample }: { community: string; book: CreatorBook | null; title?: string; sample?: Array<Achievement & { profile: Profile | null }> /* dev checks */ }) {
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

  const cols = 'grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] items-center gap-3'
  return (
    <Section title={title || 'Badge Achievements'} icon={<Trophy size={19} />} sub="The newest badges earned from this book.">
      {real === null ? <Loader2 size={18} className="animate-spin text-[color:var(--b-muted)]" />
        : shown.length === 0 ? <p className="text-sm text-[color:var(--b-muted)]">No one has earned a badge yet — collect the cards and be the first.</p>
        : (
          <div className="-mx-1">
            <div className={cn(cols, 'px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--b-muted)] border-b border-[color:var(--b-line)]')}>
              <span>Collector</span><span>Badge</span><span className="text-right">Earned</span>
            </div>
            <ol>
              {[...shown, ...leaving.filter((r) => !shown.some((a) => a.key === r.key))].map((a, i) => {
                const out = i >= shown.length // sliding off the bottom
                const def = defOf(a.badge)!
                const name = a.profile?.displayName ?? 'A collector'
                const how = entry.current.get(a.key)
                return (
                  <li key={a.key}
                    className={cn(cols, 'relative h-12 sm:h-11 px-3 border-b border-[color:var(--b-hair)] last:border-b-0 transition-colors duration-700',
                      i === 0 ? 'bg-[color:var(--b-tint)]' : 'hover:bg-[color:var(--b-hover)]', out ? 'board-row-leave pointer-events-none' : how === 'arrive' ? 'board-row-arrive' : 'board-row-in')}
                    style={how === 'in' && !out ? { animationDelay: `${i * 70}ms` } : undefined}>
                    {how === 'arrive' && <span className="board-row-flash absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--b-accent) 40%, transparent), color-mix(in srgb, var(--b-accent) 15%, transparent) 50%, transparent)' }} />}
                    {i === 0 && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[color:var(--b-accent)]" />}
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
                      <span className={cn('relative shrink-0 w-8 h-9 flex items-center justify-center', how === 'arrive' && 'board-pin-pop')}>
                        <BadgePin art={def.art} imageUrl={def.imageUrl} size={30} />
                      </span>
                      <span className="hidden sm:block truncate [font-family:var(--b-title-font)] text-[13px] font-bold text-[color:var(--b-accent)]">{def.name}</span>
                    </span>
                    <span className={cn('relative text-right text-[11px] tabular-nums whitespace-nowrap', i === 0 ? 'text-[color:var(--b-accent)] font-semibold' : 'text-[color:var(--b-muted)]')}>
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

/** The Creator Wall: the creator's own posts — words and pictures — newest first */
function CreatorWall({ block, ctx }: { block: Extract<Block, { type: 'wall' }>; ctx: BlockContext }) {
  const posts = [...block.posts].sort((a, b) => b.at - a.at)
  const c = ctx.community
  return (
    <Section title={block.title || 'Creator Wall'} icon={<Sparkles size={19} />} sub={`Straight from ${c.name}`}>
      {posts.length === 0 ? <p className="text-sm text-[color:var(--b-muted)]">Nothing posted yet.</p> : (
        <div className="space-y-5">
          {posts.map((p, i) => (
            <article key={p.id} className={cn('flex gap-3.5', i > 0 && 'pt-5 border-t border-[color:var(--b-hair)]')}>
              <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center pinbook-serif text-lg font-bold text-white shadow-[inset_0_-3px_6px_rgba(0,0,0,0.25)]" style={{ background: c.color }}>
                {(c.name.trim()[0] || '★').toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm"><b className="text-[color:var(--b-title)]">{c.name}</b> <span className="text-xs text-[color:var(--b-muted)]">· {timeAgo(p.at)}</span></p>
                {p.text && <p className="mt-1 text-[15px] text-[color:var(--b-text)] whitespace-pre-line leading-relaxed">{p.text}</p>}
                {p.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={badgeArt(p.image, 1200)} alt="" className="mt-3 w-full max-h-[460px] object-cover rounded-xl shadow-[0_10px_24px_-14px_rgba(40,25,10,0.6)]" />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </Section>
  )
}

/** Announcements: the pinned one first, then newest */
function Announcements({ block }: { block: Extract<Block, { type: 'announcements' }> }) {
  const items = [...block.items].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at)
  return (
    <Section title={block.title || 'Announcements'} icon={<Megaphone size={19} />}>
      {items.length === 0 ? <p className="text-sm text-[color:var(--b-muted)]">No announcements yet.</p> : (
        <div className="space-y-3">
          {items.map((a) => (
            <article key={a.id} className={cn('rounded-xl p-4', a.pinned ? 'bg-[color:var(--b-tint)] border border-[color:var(--b-corner)]' : 'bg-[color:var(--b-hover)] border border-[color:var(--b-hair)]')}>
              <div className="flex items-start gap-2">
                {a.pinned && <Pin size={14} className="mt-1 shrink-0 text-[color:var(--b-accent)]" />}
                <h3 className="[font-family:var(--b-title-font)] text-base font-bold text-[color:var(--b-title)] flex-1">{a.title || 'Announcement'}</h3>
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

/** Highlighted Cards: the cards the creator picked to show off, each one looked at big with a tap */
function HighlightedCards({ block }: { block: Extract<Block, { type: 'cards' }> }) {
  const [zoom, setZoom] = useState<ZoomCardData | null>(null)
  return (
    <Section title={block.title || 'Highlighted Cards'} sub={block.note}>
      {block.cards.length === 0 ? <p className="text-sm text-[color:var(--b-muted)]">No cards picked yet.</p> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
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
                    className="w-full aspect-[63/88] object-cover rounded-lg shadow-[0_10px_20px_-10px_rgba(40,25,10,0.6)] transition-transform group-hover:-translate-y-1" />
                  <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Eye size={13} /></span>
                </span>
                <span className="mt-2 block text-sm font-bold text-[color:var(--b-title)] truncate">{s.label}</span>
                <span className="block text-[11px] text-[color:var(--b-muted)] truncate">{c?.setName}{c?.number ? ` · #${c.number}` : ''}{g ? ` · ${GAME_LABELS[g]}` : ''}</span>
              </button>
            )
          })}
        </div>
      )}
      {typeof document !== 'undefined' && createPortal(<div className="relative z-[85]"><CardZoomOverlay data={zoom} onClose={() => setZoom(null)} viewOnly /></div>, document.body)}
    </Section>
  )
}
