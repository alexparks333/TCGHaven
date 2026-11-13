'use client'

// A community page's blocks, as fans see them (docs/creators.md "Community page blocks";
// lib/communityBlocks.ts): About, Badge Achievements, Creator Wall, Announcements, Highlighted Cards, Text,
// Picture, and the coming Community Board. The page (CommunityPage) stacks the ones on the open tab; the
// Studio draws the very same ones, with its builder around them.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { Loader2, Trophy, Megaphone, Pin, Sparkles, MessagesSquare, Eye } from 'lucide-react'
import { Avatar } from '@/components/friends/Avatar'
import { BadgePin } from '@/components/badges/BadgePin'
import { Corners, Divider } from '@/components/creator/Ornaments'
import { getProfile, profilePath, type Profile } from '@/lib/firebase/friends'
import { newestAchievements, type Achievement, type CommunityEntry } from '@/lib/communities'
import type { CreatorBook } from '@/lib/creatorBooks'
import type { Block } from '@/lib/communityBlocks'
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

/** Badge Achievements: the newest members to earn one of this creator's badges */
export function AchievementBoard({ community, book, title, sample }: { community: string; book: CreatorBook | null; title?: string; sample?: Array<Achievement & { profile: Profile | null }> /* dev checks */ }) {
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
    <section className="relative overflow-hidden rounded-2xl text-[#efe3c8] ring-1 ring-[#d6b168]/25 shadow-[0_22px_44px_-24px_rgba(20,12,4,0.85)]"
      style={{ background: 'radial-gradient(120% 80% at 50% -10%, #3a2a18 0%, #1d150d 55%, #140e08 100%)' }}>
      {/* a faint gold sheen along the top edge */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#e7c37a]/70 to-transparent" />
      <header className="flex items-center gap-3 px-5 md:px-6 pt-5 pb-4">
        <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-b from-[#e9c77e] to-[#a8771f] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_2px_6px_rgba(0,0,0,0.5)]">
          <Trophy size={18} className="text-[#2a1c0c]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="pinbook-serif text-base sm:text-lg md:text-xl font-bold tracking-wide text-[#f3dfae] leading-tight">{title || 'Badge Achievements'}</h2>
          <p className="text-[11px] text-[#a8957a]">The newest badges earned from this book</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-[#e7c37a]/10 ring-1 ring-[#e7c37a]/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#e7c37a]">
          <span className="relative flex w-1.5 h-1.5"><span className="absolute inset-0 rounded-full bg-[#7fdc8a] animate-ping opacity-70" /><span className="relative w-1.5 h-1.5 rounded-full bg-[#7fdc8a]" /></span>
          Live
        </span>
      </header>
      {list === null ? <div className="px-6 pb-6"><Loader2 size={18} className="animate-spin text-[#a8957a]" /></div>
        : shown.length === 0 ? <p className="px-6 pb-6 text-sm text-[#a8957a]">No one has earned a badge yet — collect the cards and be the first.</p>
        : (
          <div className="px-3 md:px-4 pb-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] gap-3 px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#8a785e]">
              <span>Collector</span><span className="sm:block">Badge</span><span className="text-right">Earned</span>
            </div>
            <ol className="space-y-1">
              {shown.map((a, i) => {
                const def = defOf(a.badge)!
                const name = a.profile?.displayName ?? 'A collector'
                return (
                  <li key={a.member + a.badge}
                    className={cn('relative grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] items-center gap-3 h-12 sm:h-11 px-3 rounded-lg transition-colors',
                      i === 0 ? 'bg-gradient-to-r from-[#e7c37a]/[0.16] via-[#e7c37a]/[0.06] to-transparent ring-1 ring-[#e7c37a]/30'
                        : i % 2 ? 'bg-white/[0.035] hover:bg-white/[0.07]' : 'bg-white/[0.015] hover:bg-white/[0.07]')}>
                    {i === 0 && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#e7c37a] shadow-[0_0_8px_#e7c37a]" />}
                    <Link href={a.profile ? profilePath(a.member, a.profile.username) : '#'} className="flex items-center gap-2.5 min-w-0 group">
                      <span className="shrink-0 rounded-full ring-1 ring-[#e7c37a]/40"><Avatar seed={a.member} name={name} photoURL={a.profile?.photoURL} size={26} /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-[#f3e7cf] group-hover:text-[#f3dfae] group-hover:underline underline-offset-2">{name}</span>
                        <span className="sm:hidden block truncate pinbook-serif text-[11px] font-bold text-[#e7c37a]">{def.name}</span>
                      </span>
                    </Link>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="relative shrink-0 w-8 h-9 flex items-center justify-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
                        <BadgePin art={def.art} imageUrl={def.imageUrl} size={30} />
                      </span>
                      <span className="hidden sm:block truncate pinbook-serif text-[13px] font-bold text-[#e7c37a]">{def.name}</span>
                    </span>
                    <span className="text-right text-[11px] tabular-nums whitespace-nowrap text-[#a8957a]"><span className={cn(i === 0 && 'text-[#e7c37a] font-semibold')}><span className="hidden sm:inline">{timeAgo(a.earnedAt)}</span><span className="sm:hidden">{shortAgo(a.earnedAt)}</span></span></span>
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
