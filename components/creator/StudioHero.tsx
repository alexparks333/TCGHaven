'use client'

// The Creator Studio's header (docs/creators.md), in TCG Haven's paper: the community's stamp and
// name, live stats, a checklist of what to do next, and the Studio's tabs as paper index tabs into
// the panel below.

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
  const badges = book?.badges.length ?? 0
  const chapters = book ? chaptersFor(book.book, book.badges).length : 0
  const steps = studioSteps(community, book)
  const done = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)

  return (
    <div className="relative rounded-t-[22px] border border-b-0 border-slate-800 bg-[#efe4cc]"
      style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(122, 101, 74, 0.08) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
      {/* A thin inner rule, like the binder pages */}
      <div className="absolute inset-[6px] bottom-0 rounded-t-[17px] border border-b-0 border-[#d6c49f] pointer-events-none" />

      <div className="relative px-5 md:px-8 pt-6 md:pt-7">
        <div className="flex flex-wrap items-center gap-4 md:gap-5">
          {/* The community's stamp, pressed into the paper */}
          <span className="haven-medallion w-16 h-16 md:w-[72px] md:h-[72px] shrink-0 pinbook-serif text-3xl md:text-[34px] font-bold"
            style={{ boxShadow: 'inset 0 0 0 4px #f3e9d3, inset 0 0 0 5px rgba(148, 128, 95, 0.35)' }}>
            {(community.name.trim()[0] || '★').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#7a5230] flex items-center gap-1.5"><Wand2 size={13} />Creator Studio</p>
            <h1 className="pinbook-serif text-[26px] md:text-[32px] font-bold text-ink leading-tight truncate">{community.name || 'Your community'}</h1>
            <p className="text-sm text-slate-500 truncate">{since ? `Creator since ${since} · Premium included` : community.tagline || 'Make something fans will want to collect'}</p>
          </div>
          <div className="flex w-full sm:w-auto divide-x divide-[#d6c49f] rounded-xl border border-[#d6c49f] bg-[#f6eedb]">
            {([['Badges', badges], ['Chapters', chapters], ['Members', members ?? '–']] as const).map(([label, value]) => (
              <div key={label} className="flex-1 sm:flex-none sm:min-w-[84px] px-3 py-2 text-center">
                <div className="pinbook-serif text-xl md:text-2xl font-bold text-ink tabular-nums leading-none">{value}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* The checklist: a ring per step, and the next thing to do */}
        <div className="haven-rule mt-5" />
        <div className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-xs font-semibold text-slate-500 tabular-nums">Checklist {done}/{steps.length}</span>
          <div className="flex items-center gap-1.5">
            {steps.map((s) => (
              <button key={s.label} type="button" onClick={() => onTab(s.tab)} title={(s.done ? '✓ ' : '') + s.label}
                className={cn('w-[18px] h-[18px] rounded-full flex items-center justify-center transition-colors',
                  s.done ? 'bg-[#7a5230] text-[#fbf6ea]' : 'border border-[#c4ae83] bg-[#f3e9d3] hover:border-[#7a5230]')}>
                {s.done && <Check size={11} strokeWidth={3} />}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-[100px] h-[3px] rounded-full bg-[#d8c9a8] overflow-hidden">
            <div className="h-full bg-[#7a5230] transition-all duration-700" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          {next ? (
            <button type="button" onClick={() => onTab(next.tab)} className="text-xs font-semibold text-[#7a5230] hover:underline inline-flex items-center gap-1">
              Next: {next.label}<ArrowRight size={13} />
            </button>
          ) : (
            <span className="text-xs font-semibold text-[#7a5230] inline-flex items-center gap-1"><Trophy size={13} />All set</span>
          )}
        </div>

        {/* The tabs: paper index tabs into the panel below */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar -mb-px">
          {STUDIO_TABS.map(([id, label, Icon]) => {
            const on = tab === id
            return (
              <button key={id} type="button" onClick={() => onTab(id)}
                className={cn('relative shrink-0 flex items-center gap-2 rounded-t-xl border border-b-0 px-4 md:px-5 text-sm font-semibold transition-colors',
                  on ? 'bg-slate-950 border-slate-800 text-ink py-3' : 'mt-1 py-2.5 bg-[#e6d7b6] border-[#d6c49f] text-slate-500 hover:text-ink')}>
                <Icon size={15} className={on ? 'text-[#7a5230]' : undefined} />{label}
                {dirtyTabs.includes(id) && <span className="w-1.5 h-1.5 rounded-full bg-[#a8452a]" title="Unsaved changes" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
