'use client'

// The Creator Book, open: its pages of pin spots in the book's own leather and velvet. A filled spot
// is a badge (tap to edit it); an empty one is a "+" pinhole (tap to make a badge there). Chapters
// run down the side — rename one by tapping its title, add more. Each chapter starts on a fresh
// page, 6 pins a page, and always keeps one empty spot to add to. docs/creators.md.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Pencil } from 'lucide-react'
import type { BadgeDef, BadgeSet } from '@/lib/badges'
import { BadgePin } from '@/components/badges/BadgePin'
import { cn } from '@/lib/utils'

const PER_PAGE = 6

interface PlannedPage { chapter: string; chapterIndex: number; first: boolean; spots: Array<BadgeDef | null> }

export function chaptersFor(book: BadgeSet, badges: BadgeDef[]): string[] {
  const out = [...(book.chapters ?? [])]
  for (const b of badges) if (!out.includes(b.page)) out.push(b.page)
  return out.length ? out : ['Chapter One']
}

function plan(book: BadgeSet, badges: BadgeDef[]): PlannedPage[] {
  const pages: PlannedPage[] = []
  chaptersFor(book, badges).forEach((chapter, chapterIndex) => {
    const inChapter = badges.filter((b) => b.page === chapter)
    // Room for one more: the "+" a creator taps to add the next badge
    const count = Math.max(1, Math.ceil((inChapter.length + 1) / PER_PAGE))
    for (let p = 0; p < count; p++) {
      const spots: Array<BadgeDef | null> = []
      for (let i = 0; i < PER_PAGE; i++) spots.push(inChapter[p * PER_PAGE + i] ?? null)
      pages.push({ chapter, chapterIndex, first: p === 0, spots })
    }
  })
  return pages
}

export function BookPlanner({ book, badges, onAdd, onEdit, onRenameChapter, onAddChapter }: {
  book: BadgeSet
  badges: BadgeDef[]
  onAdd: (chapter: string) => void
  onEdit: (badge: BadgeDef) => void
  onRenameChapter: (from: string, to: string) => void
  onAddChapter: () => void
}) {
  const pages = useMemo(() => plan(book, badges), [book, badges])
  const chapters = chaptersFor(book, badges)
  const [spread, setSpread] = useState(0)
  const spreads = Math.ceil(pages.length / 2)
  const at = Math.min(spread, spreads - 1)
  const left = pages[at * 2]
  const right = pages[at * 2 + 1] ?? null
  const { from, to, accent } = book.cover
  const goTo = (chapter: number) => {
    const i = pages.findIndex((p) => p.chapterIndex === chapter)
    if (i >= 0) setSpread(Math.floor(i / 2))
  }

  return (
    <div>
      {/* The open book: leather all round, two velvet pages, gold frames */}
      <div className="relative mx-auto max-w-[980px] rounded-[18px] p-[1.6%] shadow-[0_24px_50px_-20px_rgba(0,0,0,0.6)]" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
        <div className="absolute inset-[0.8%] rounded-[14px] border border-dashed pointer-events-none" style={{ borderColor: accent + '70' }} />
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-0">
          <Page page={left} accent={accent} side="left" onAdd={onAdd} onEdit={onEdit} onRename={onRenameChapter} />
          <div className="hidden md:block">
            {right ? <Page page={right} accent={accent} side="right" onAdd={onAdd} onEdit={onEdit} onRename={onRenameChapter} /> : <EmptyPage accent={accent} onAddChapter={onAddChapter} />}
          </div>
          {/* The spine */}
          <div className="hidden md:block absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3%] pointer-events-none" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.45), rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0.45))' }} />
        </div>
      </div>

      {/* Turning pages + chapters */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={() => setSpread(Math.max(0, at - 1))} disabled={at === 0} className="p-2 rounded-full bg-slate-900 border border-slate-800 text-ink disabled:opacity-30" aria-label="Previous pages"><ChevronLeft size={18} /></button>
        <span className="text-xs text-slate-500 tabular-nums px-1">Pages {at * 2 + 1}{right ? `–${at * 2 + 2}` : ''} of {pages.length}</span>
        <button type="button" onClick={() => setSpread(Math.min(spreads - 1, at + 1))} disabled={at >= spreads - 1} className="p-2 rounded-full bg-slate-900 border border-slate-800 text-ink disabled:opacity-30" aria-label="Next pages"><ChevronRight size={18} /></button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {chapters.map((c, i) => {
          const on = left?.chapterIndex === i || right?.chapterIndex === i
          return (
            <button key={c + i} type="button" onClick={() => goTo(i)}
              className={cn('rounded-full px-3 py-1 text-xs font-semibold border transition-colors', on ? 'text-white border-transparent' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-ink')}
              style={on ? { background: `linear-gradient(135deg, ${from}, ${to})` } : undefined}>
              {romanOf(i)} · {c}
            </button>
          )
        })}
        <button type="button" onClick={onAddChapter} className="rounded-full px-3 py-1 text-xs font-semibold border border-dashed border-slate-700 text-slate-500 hover:text-ink inline-flex items-center gap-1"><Plus size={12} />Chapter</button>
      </div>
    </div>
  )
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const romanOf = (i: number) => ROMAN[i] ?? String(i + 1)

function Velvet({ children, accent, side }: { children: React.ReactNode; accent: string; side: 'left' | 'right' }) {
  return (
    <div
      className={cn('relative aspect-[0.78] p-[6%] flex flex-col', side === 'left' ? 'md:rounded-l-[10px]' : 'md:rounded-r-[10px]')}
      style={{
        background: 'radial-gradient(ellipse at 50% 40%, #2c2240 0%, #1a1427 55%, #0f0b18 100%)',
        boxShadow: 'inset 0 0 40px rgba(0,0,0,0.6)',
      }}
    >
      {/* Gold foil double frame */}
      <div className="absolute inset-[3.2%] rounded-[6px] border pointer-events-none" style={{ borderColor: accent + 'aa' }} />
      <div className="absolute inset-[4.4%] rounded-[4px] border pointer-events-none" style={{ borderColor: accent + '55' }} />
      {children}
    </div>
  )
}

function Page({ page, accent, side, onAdd, onEdit, onRename }: {
  page: PlannedPage
  accent: string
  side: 'left' | 'right'
  onAdd: (chapter: string) => void
  onEdit: (b: BadgeDef) => void
  onRename: (from: string, to: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(page.chapter)
  // The first empty spot is the "+"; the rest of the page stays quiet velvet
  const plusAt = page.spots.findIndex((s) => !s)
  return (
    <Velvet accent={accent} side={side}>
      {/* The chapter's title, engraved in gold between rules — tap to rename */}
      <div className="relative flex items-center gap-[4%] px-[4%] mb-[5%] min-h-[9%]">
        <span className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent})` }} />
        {page.first && editing ? (
          <input
            autoFocus
            value={name}
            maxLength={28}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { setEditing(false); if (name.trim() && name.trim() !== page.chapter) onRename(page.chapter, name.trim()) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="pinbook-serif bg-black/40 border rounded px-2 py-0.5 text-center text-sm uppercase tracking-[0.18em] outline-none"
            style={{ color: accent, borderColor: accent + '88' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => page.first && (setName(page.chapter), setEditing(true))}
            className={cn('pinbook-serif text-[clamp(10px,1.6vw,15px)] font-bold uppercase tracking-[0.2em] whitespace-nowrap inline-flex items-center gap-1.5', page.first && 'hover:brightness-125')}
            style={{ color: accent }}
            title={page.first ? 'Rename this chapter' : undefined}
          >
            {page.chapter}{!page.first && ' (cont.)'}
            {page.first && <Pencil size={11} className="opacity-60" />}
          </button>
        )}
        <span className="flex-1 h-px" style={{ background: `linear-gradient(270deg, transparent, ${accent})` }} />
      </div>
      {/* 2 × 3 pin spots */}
      <div className="relative flex-1 grid grid-cols-2 grid-rows-3 gap-[5%] px-[4%] pb-[2%]">
        {page.spots.map((b, i) =>
          b ? (
            <button key={b.id} type="button" onClick={() => onEdit(b)} className="group flex flex-col items-center justify-center gap-[6%] rounded-xl hover:bg-white/5 transition-colors">
              <span className="relative flex items-center justify-center w-[62%] aspect-square transition-transform group-hover:scale-105 drop-shadow-[0_6px_6px_rgba(0,0,0,0.55)]">
                <BadgePin art={b.art} imageUrl={b.imageUrl} size={90} />
              </span>
              <span className="pinbook-serif max-w-full truncate rounded px-2 py-0.5 text-[clamp(8px,1.1vw,11px)] font-bold uppercase tracking-wider" style={{ background: `linear-gradient(180deg, ${accent}, #6b4a17)`, color: '#1c1206' }}>{b.name}</span>
            </button>
          ) : i === plusAt ? (
            <button key={'plus' + i} type="button" onClick={() => onAdd(page.chapter)}
              className="group flex flex-col items-center justify-center gap-[6%]">
              <span
                className="flex items-center justify-center w-[52%] aspect-square rounded-full border-2 border-dashed transition-all group-hover:scale-110 group-hover:bg-white/5"
                style={{ borderColor: accent + 'cc', color: accent, boxShadow: `inset 0 3px 10px rgba(0,0,0,0.7), 0 0 0 0 ${accent}` }}
              >
                <Plus className="w-[42%] h-[42%] transition-transform group-hover:rotate-90" strokeWidth={2.5} />
              </span>
              <span className="text-[clamp(8px,1.05vw,11px)] font-semibold uppercase tracking-wider opacity-80" style={{ color: accent }}>Add a badge</span>
            </button>
          ) : (
            // An empty felt pinhole — the spots after the "+" fill in as badges are added
            <span key={'empty' + i} className="flex items-center justify-center">
              <span className="w-[40%] aspect-square rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.5), rgba(0,0,0,0.15) 65%, transparent 70%)' }} />
            </span>
          ),
        )}
      </div>
    </Velvet>
  )
}

function EmptyPage({ accent, onAddChapter }: { accent: string; onAddChapter: () => void }) {
  return (
    <Velvet accent={accent} side="right">
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-[10%]">
        <p className="pinbook-serif text-sm uppercase tracking-[0.2em]" style={{ color: accent }}>A blank page</p>
        <p className="text-xs text-[#cbbfa8]/70">Start a new chapter to group more badges — a game, a season, a theme.</p>
        <button type="button" onClick={onAddChapter} className="mt-1 rounded-full px-4 py-1.5 text-xs font-bold inline-flex items-center gap-1.5" style={{ background: accent, color: '#1c1206' }}>
          <Plus size={13} /> New chapter
        </button>
      </div>
    </Velvet>
  )
}
