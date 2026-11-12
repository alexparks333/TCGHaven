'use client'

// The Creator Studio's header (docs/creators.md): a leather banner in the creator's own book and
// community colours — their community's name, live stats, a checklist of what to do next — with the
// Studio's tabs hanging off its bottom edge like bookmarks into the parchment panel below.

import { useEffect, useState } from 'react'
import { BookOpen, Check, Palette, Users, Wand2, ArrowRight, Trophy } from 'lucide-react'
import { memberCount } from '@/lib/communities'
import { LEATHERS, FOILS, type Community, type CreatorBook } from '@/lib/creatorBooks'
import { chaptersFor } from '@/components/creator/BookPlanner'
import { cn } from '@/lib/utils'

export type StudioTab = 'cover' | 'pages' | 'community'

export const STUDIO_TABS: Array<[StudioTab, string, typeof BookOpen]> = [
  ['pages', 'Pages & badges', BookOpen],
  ['cover', 'Cover', Palette],
  ['community', 'Community', Users],
]

interface Step { label: string; done: boolean; tab: StudioTab }

/** What a creator has left to do, in order — the hero's checklist */
export function studioSteps(community: Community, book: CreatorBook | null): Step[] {
  const badges = book?.badges ?? []
  const b = book?.book
  const dressed = !!b && (!!b.coverImage || Object.keys(b.coverStyle ?? {}).length > 0
    || b.cover.from !== LEATHERS[0].from || b.cover.accent !== FOILS[0].color)
  const fullChapter = !!b && chaptersFor(b, badges).some((c) => badges.filter((x) => x.page === c).length >= 6)
  return [
    { label: 'Launch your community', done: true, tab: 'community' },
    { label: 'Make your book', done: !!book, tab: 'cover' },
    { label: 'Dress up the cover', done: dressed, tab: 'cover' },
    { label: 'Make your first badge', done: badges.length > 0, tab: 'pages' },
    { label: 'Give a badge a 3D pin', done: badges.some((x) => !!x.reliefKit || !!x.relief), tab: 'pages' },
    { label: 'Fill a whole chapter (6)', done: fullChapter, tab: 'pages' },
    { label: 'Tell fans about your community', done: !!community.about.trim(), tab: 'community' },
  ]
}

export function StudioHero({ uid, community, book, since, tab, onTab, dirtyTabs = [] }: {
  uid: string
  community: Community
  book: CreatorBook | null
  since: string | null
  tab: StudioTab
  onTab: (t: StudioTab) => void
  dirtyTabs?: StudioTab[]
}) {
  const [members, setMembers] = useState<number | null>(null)
  useEffect(() => { memberCount(uid).then(setMembers).catch(() => {}) }, [uid])
  const cover = book?.book.cover ?? { from: '#8a5d36', to: '#2e1a08', accent: '#e8b35a' }
  const foil = cover.accent
  const badges = book?.badges.length ?? 0
  const chapters = book ? chaptersFor(book.book, book.badges).length : 0
  const steps = studioSteps(community, book)
  const done = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)

  return (
    <div className="relative overflow-hidden rounded-t-[28px] text-white"
      style={{ background: `radial-gradient(120% 160% at 0% 0%, ${community.color}cc 0%, transparent 55%), linear-gradient(135deg, ${cover.from}, ${cover.to})`, transition: 'background 0.6s' }}>
      {/* Leather grain + the stitched edge, in the book's own thread */}
      <div className="absolute inset-0 opacity-[0.18] mix-blend-overlay pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1.2px)', backgroundSize: '5px 5px' }} />
      <div className="absolute inset-x-[8px] top-[8px] bottom-0 rounded-t-[22px] border border-b-0 border-dashed pointer-events-none" style={{ borderColor: foil + '70' }} />
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="creator-spark absolute rounded-full pointer-events-none"
          style={{ left: `${(i * 43) % 100}%`, bottom: '-8px', width: 2 + (i % 3), height: 2 + (i % 3), background: foil, color: foil, animationDelay: `${(i * 0.61) % 6}s`, animationDuration: `${6 + (i % 5)}s` }} />
      ))}

      <div className="relative px-5 md:px-8 pt-6 md:pt-8">
        <div className="flex flex-wrap items-center gap-4 md:gap-5">
          {/* The community's stamp */}
          <span className="w-16 h-16 md:w-[76px] md:h-[76px] rounded-[22px] flex items-center justify-center text-3xl md:text-4xl font-black shadow-[0_10px_24px_-8px_rgba(0,0,0,0.6)] shrink-0 rotate-[-4deg]"
            style={{ background: `linear-gradient(145deg, ${community.color}, color-mix(in srgb, ${community.color} 45%, black))`, border: `3px solid ${foil}` }}>
            {(community.name.trim()[0] || '★').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] flex items-center gap-1.5" style={{ color: foil }}><Wand2 size={13} />Creator Studio</p>
            <h1 className="pinbook-serif text-[26px] md:text-[34px] font-bold leading-tight truncate drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]">{community.name || 'Your community'}</h1>
            <p className="text-sm text-white/60 truncate">{since ? `Creator since ${since} · Premium included` : community.tagline || 'Make something fans will want to collect'}</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            {([['Badges', badges], ['Chapters', chapters], ['Members', members ?? '–']] as const).map(([label, value]) => (
              <div key={label} className="flex-1 sm:flex-none sm:min-w-[84px] rounded-2xl bg-black/25 border border-white/10 backdrop-blur-sm px-3 py-2 text-center">
                <div className="text-xl md:text-2xl font-black tabular-nums leading-none">{value}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* The checklist: a dot per step, and the next thing to do */}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-black/25 border border-white/10 px-3.5 py-2.5">
          <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: foil }}>
            <Trophy size={14} />{done}/{steps.length}
          </span>
          <div className="flex items-center gap-1.5">
            {steps.map((s) => (
              <button key={s.label} type="button" onClick={() => onTab(s.tab)} title={(s.done ? '✓ ' : '') + s.label}
                className={cn('w-5 h-5 rounded-full flex items-center justify-center transition-transform hover:scale-125', !s.done && 'border border-dashed border-white/40')}
                style={s.done ? { background: foil, color: '#1c1206' } : undefined}>
                {s.done && <Check size={12} strokeWidth={3} />}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-[120px] h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(done / steps.length) * 100}%`, background: `linear-gradient(90deg, ${foil}, #fff6d6)` }} />
          </div>
          {next ? (
            <button type="button" onClick={() => onTab(next.tab)} className="text-xs font-bold text-white/85 hover:text-white inline-flex items-center gap-1">
              Next: {next.label}<ArrowRight size={13} />
            </button>
          ) : (
            <span className="text-xs font-bold text-white/85">Your studio is all set ✨</span>
          )}
        </div>

        {/* The tabs: bookmarks hanging into the panel below */}
        <div className="mt-5 flex gap-1.5 overflow-x-auto no-scrollbar">
          {STUDIO_TABS.map(([id, label, Icon]) => {
            const on = tab === id
            return (
              <button key={id} type="button" onClick={() => onTab(id)}
                className={cn('relative shrink-0 flex items-center gap-2 rounded-t-2xl px-4 md:px-6 text-sm font-bold transition-all',
                  on ? 'bg-slate-950 text-ink py-3.5' : 'mt-1.5 py-3 bg-black/25 text-white/75 hover:bg-black/35 hover:text-white')}>
                <Icon size={16} style={on ? { color: cover.from } : undefined} />{label}
                {dirtyTabs.includes(id) && <span className="w-2 h-2 rounded-full bg-amber-400" title="Unsaved changes" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
