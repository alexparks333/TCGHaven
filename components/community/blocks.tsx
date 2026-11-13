'use client'

// A community page's blocks, as fans see them (docs/creators.md "Community page blocks";
// lib/communityBlocks.ts): About, Badge Achievements, Creator Wall, Announcements, Highlighted Cards, Text,
// Picture, and the coming Community Board. The page (CommunityPage) stacks the ones on the open tab; the
// Studio draws the very same ones, with its builder around them.

import { useEffect, useRef, useState } from 'react'
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
import { DEV_EARNER_EVENT, DEV_EARNER_CLEAR_EVENT, type DevEarner } from '@/lib/devBoard'
import { badgeArt } from '@/lib/badgeAssets'
import { cardImage } from '@/lib/cardImage'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
import { CardZoomOverlay, type ZoomCardData } from '@/components/pages/CardexPage'
import { cn } from '@/lib/utils'

export interface BlockContext { uid: string; community: CommunityEntry; book: CreatorBook | null }

/** A paper card with an engraved title and corner flourishes — every block sits in one */
export function Section({ title, icon, sub, children, className }: { title?: string; icon?: React.ReactNode; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('haven-panel haven-grain relative !p-6 md:!p-7', className)}>
      <Corners inset={8} size={30} />
      {title && <h2 className="pinbook-serif text-xl font-bold text-ink flex items-center gap-2.5">{icon}{title}</h2>}
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      {title && <Divider className="mt-3 mb-4" />}
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
  switch (block.type) {
    case 'about':
      return (
        <Section title="About">
          <p className="text-[15px] text-slate-400 whitespace-pre-line leading-relaxed">{ctx.community.about || 'No description yet.'}</p>
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
            ? <div className="text-[15px] text-slate-400 whitespace-pre-line leading-relaxed">{block.body}</div>
            : <p className="text-sm text-slate-500 italic">Nothing here yet.</p>}
        </Section>
      )
    case 'picture':
      return (
        <figure className="relative">
          {block.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badgeArt(block.image, 1600)} alt={block.caption ?? ''} className="w-full max-h-[520px] object-cover rounded-2xl shadow-[0_18px_36px_-20px_rgba(40,25,10,0.7)]" />
          ) : (
            <div className="w-full aspect-[16/7] rounded-2xl border-2 border-dashed border-[#c4ae83] flex items-center justify-center text-sm text-slate-500">A picture goes here</div>
          )}
          {block.caption && <figcaption className="mt-2 text-center text-sm italic text-slate-500" style={{ fontFamily: 'Georgia, serif' }}>{block.caption}</figcaption>}
        </figure>
      )
    case 'board':
      return (
        <Section title={block.title || 'Community Board'} icon={<MessagesSquare size={19} className="text-[#8a6420]" />}>
          <p className="text-sm text-slate-500">Coming soon — members will post here and upvote the best.</p>
        </Section>
      )
  }
}

interface BoardRow { key: string; member: string; badge: string; earnedAt: number; profile: Profile | null; fake?: boolean }
const BOARD_ROWS = 10

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

  const cols = 'grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] items-center gap-3'
  return (
    <section className="relative rounded-[0.875rem] border border-[#4a3b2b] p-6 md:p-7 text-[#efe3c8]"
      style={{ backgroundColor: '#2a2119', backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(240,220,180,0.05) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
      <Corners inset={8} size={30} className="text-[#7d6342]" />
      <h2 className="pinbook-serif text-xl font-bold text-[#f0dfb8] flex items-center gap-2.5"><Trophy size={19} className="text-[#d6a957]" />{title || 'Badge Achievements'}</h2>
      <p className="text-xs text-[#9c8a70] mt-1">The newest badges earned from this book.</p>
      <Divider className="mt-3 mb-4 !text-[#7d6342] [&>span]:!from-transparent [&>span]:!to-[#5a4733]" />
      {real === null ? <Loader2 size={18} className="animate-spin text-[#9c8a70]" />
        : shown.length === 0 ? <p className="text-sm text-[#9c8a70]">No one has earned a badge yet — collect the cards and be the first.</p>
        : (
          <div className="-mx-1">
            <div className={cn(cols, 'px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#8a785e] border-b border-[#5a4733]')}>
              <span>Collector</span><span>Badge</span><span className="text-right">Earned</span>
            </div>
            <ol>
              {shown.map((a, i) => {
                const def = defOf(a.badge)!
                const name = a.profile?.displayName ?? 'A collector'
                const how = entry.current.get(a.key)
                return (
                  <li key={a.key}
                    className={cn(cols, 'relative h-12 sm:h-11 px-3 border-b border-white/[0.07] last:border-b-0 transition-colors duration-700',
                      i === 0 ? 'bg-[#3a2d1f]' : 'hover:bg-white/[0.04]', how === 'arrive' ? 'board-row-arrive' : 'board-row-in')}
                    style={how === 'in' ? { animationDelay: `${i * 70}ms` } : undefined}>
                    {how === 'arrive' && <span className="board-row-flash absolute inset-0 pointer-events-none bg-gradient-to-r from-[#e0b866]/40 via-[#e0b866]/15 to-transparent" />}
                    {i === 0 && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#d6a957]" />}
                    <Link href={a.profile?.username ? profilePath(a.member, a.profile.username) : '#'} className="relative flex items-center gap-2.5 min-w-0 group">
                      <span className="shrink-0"><Avatar seed={a.member} name={name} photoURL={a.profile?.photoURL} size={26} /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-[#efe3c8] group-hover:underline underline-offset-2">{name}</span>
                        <span className="sm:hidden block truncate pinbook-serif text-[11px] font-bold text-[#e0b866]">{def.name}</span>
                      </span>
                    </Link>
                    <span className="relative flex items-center gap-2 min-w-0">
                      <span className={cn('relative shrink-0 w-8 h-9 flex items-center justify-center', how === 'arrive' && 'board-pin-pop')}>
                        <BadgePin art={def.art} imageUrl={def.imageUrl} size={30} />
                      </span>
                      <span className="hidden sm:block truncate pinbook-serif text-[13px] font-bold text-[#e0b866]">{def.name}</span>
                    </span>
                    <span className={cn('relative text-right text-[11px] tabular-nums whitespace-nowrap', i === 0 ? 'text-[#e0b866] font-semibold' : 'text-[#9c8a70]')}>
                      <span className="hidden sm:inline">{timeAgo(a.earnedAt)}</span><span className="sm:hidden">{shortAgo(a.earnedAt)}</span>
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
    </section>
  )
}

/** The Creator Wall: the creator's own posts — words and pictures — newest first */
function CreatorWall({ block, ctx }: { block: Extract<Block, { type: 'wall' }>; ctx: BlockContext }) {
  const posts = [...block.posts].sort((a, b) => b.at - a.at)
  const c = ctx.community
  return (
    <Section title={block.title || 'Creator Wall'} icon={<Sparkles size={19} className="text-[#b8862b]" />} sub={`Straight from ${c.name}`}>
      {posts.length === 0 ? <p className="text-sm text-slate-500">Nothing posted yet.</p> : (
        <div className="space-y-5">
          {posts.map((p, i) => (
            <article key={p.id} className={cn('flex gap-3.5', i > 0 && 'pt-5 border-t border-[#d6c49f]/70')}>
              <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center pinbook-serif text-lg font-bold text-white shadow-[inset_0_-3px_6px_rgba(0,0,0,0.25)]" style={{ background: c.color }}>
                {(c.name.trim()[0] || '★').toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm"><b className="text-ink">{c.name}</b> <span className="text-xs text-slate-500">· {timeAgo(p.at)}</span></p>
                {p.text && <p className="mt-1 text-[15px] text-slate-400 whitespace-pre-line leading-relaxed">{p.text}</p>}
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
    <Section title={block.title || 'Announcements'} icon={<Megaphone size={19} className="text-[#8a6420]" />}>
      {items.length === 0 ? <p className="text-sm text-slate-500">No announcements yet.</p> : (
        <div className="space-y-3">
          {items.map((a) => (
            <article key={a.id} className={cn('rounded-xl p-4', a.pinned ? 'bg-[#f6e7c4] border border-[#d6b168]/70' : 'bg-[#f6eedb]/60 border border-[#d6c49f]/60')}>
              <div className="flex items-start gap-2">
                {a.pinned && <Pin size={14} className="mt-1 shrink-0 text-[#8a6420]" />}
                <h3 className="pinbook-serif text-base font-bold text-ink flex-1">{a.title || 'Announcement'}</h3>
                <span className="shrink-0 text-[11px] text-slate-500">{new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              {a.body && <p className="mt-1.5 text-sm text-slate-400 whitespace-pre-line leading-relaxed">{a.body}</p>}
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
      {block.cards.length === 0 ? <p className="text-sm text-slate-500">No cards picked yet.</p> : (
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
                <span className="mt-2 block text-sm font-bold text-ink truncate">{s.label}</span>
                <span className="block text-[11px] text-slate-500 truncate">{c?.setName}{c?.number ? ` · #${c.number}` : ''}{g ? ` · ${GAME_LABELS[g]}` : ''}</span>
              </button>
            )
          })}
        </div>
      )}
      {typeof document !== 'undefined' && createPortal(<div className="relative z-[85]"><CardZoomOverlay data={zoom} onClose={() => setZoom(null)} viewOnly /></div>, document.body)}
    </Section>
  )
}
