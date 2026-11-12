'use client'

// The Creator Book, open: its pages of pin spots in the book's own leather and velvet. A filled spot
// is a badge (tap to edit it); an empty one is a "+" pinhole (tap to make a badge there). Chapters
// run down the side — rename one by tapping its title, add more. Each chapter starts on a fresh
// page, 6 pins a page, and always keeps one empty spot to add to. docs/creators.md.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Pencil, ArrowUp, ArrowDown, Trash2, BookOpen, Palette, RotateCcw, Eye } from 'lucide-react'
import { INSIDE_DEFAULTS, insideLook, type BadgeDef, type BadgeSet, type InsideStyle } from '@/lib/badges'
import { BadgePin } from '@/components/badges/BadgePin'
import { cn } from '@/lib/utils'

const PER_PAGE = 6

interface PlannedPage { chapter: string; chapterIndex: number; first: boolean; spots: Array<BadgeDef | null> }

export function chaptersFor(book: BadgeSet, badges: BadgeDef[]): string[] {
  const out = [...(book.chapters ?? [])]
  for (const b of badges) if (!out.includes(b.page)) out.push(b.page)
  return out.length ? out : ['Chapter One']
}

export function plan(book: BadgeSet, badges: BadgeDef[]): PlannedPage[] {
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

export function BookPlanner({ book, badges, onAdd, onEdit, onRenameChapter, onAddChapter, onChapters, onInside }: {
  book: BadgeSet
  badges: BadgeDef[]
  onAdd: (chapter: string) => void
  onEdit: (badge: BadgeDef) => void
  onRenameChapter: (from: string, to: string) => void
  onAddChapter: () => void
  onChapters: (next: string[]) => void          // reordered / one removed (only an empty one)
  onInside: (style: InsideStyle | undefined) => void
}) {
  const pages = useMemo(() => plan(book, badges), [book, badges])
  const chapters = chaptersFor(book, badges)
  const [spread, setSpread] = useState(0)
  const spreads = Math.ceil(pages.length / 2)
  const at = Math.min(spread, spreads - 1)
  const left = pages[at * 2]
  const right = pages[at * 2 + 1] ?? null
  const { from, to } = book.cover
  const accent = 'var(--trim)' // the inside's trim (Inside look), not the cover's foil
  const inside = insideLook(book.insideStyle ?? {})
  const [panel, setPanel] = useState<'chapters' | 'inside'>('chapters')
  const goTo = (chapter: number) => {
    const i = pages.findIndex((p) => p.chapterIndex === chapter)
    if (i >= 0) setSpread(Math.floor(i / 2))
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] items-start" style={inside.style /* the trim colour for the side panel too */}>
    <div className={cn(inside.className, 'relative overflow-hidden rounded-[24px] px-3 py-6 md:px-8 md:py-9')}
      style={{ ...inside.style, background: 'radial-gradient(ellipse at 50% 35%, #6a4a32 0%, #3a281b 55%, #1d140d 100%)' }}>
      {/* The desk it lies open on: walnut grain and a lamp's pool of light */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.22] mix-blend-overlay"
        style={{ backgroundImage: 'repeating-linear-gradient(92deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 7px), repeating-linear-gradient(88deg, rgba(0,0,0,0.25) 0 2px, transparent 2px 19px)' }} />
      <div className="absolute inset-x-[10%] top-0 h-2/3 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(255,226,170,0.22), transparent 70%)' }} />
      {/* The open book: leather all round, two felt pages, trim frames */}
      <div className="relative mx-auto max-w-[980px] rounded-[18px] p-[1.6%] shadow-[0_24px_50px_-20px_rgba(0,0,0,0.6)]" style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}>
        <div className="absolute inset-[0.8%] rounded-[14px] border border-dashed pointer-events-none" style={{ borderColor: book.cover.accent + '70' }} />
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
      <div className="relative mt-5 mx-auto w-fit flex items-center gap-1 rounded-full bg-black/35 border border-white/10 backdrop-blur p-1">
        <button type="button" onClick={() => setSpread(Math.max(0, at - 1))} disabled={at === 0} className="p-2 rounded-full text-white hover:bg-white/10 disabled:opacity-25" aria-label="Previous pages"><ChevronLeft size={18} /></button>
        <span className="text-xs font-semibold text-white/75 tabular-nums px-2">Pages {at * 2 + 1}{right ? `–${at * 2 + 2}` : ''} of {pages.length}</span>
        <button type="button" onClick={() => setSpread(Math.min(spreads - 1, at + 1))} disabled={at >= spreads - 1} className="p-2 rounded-full text-white hover:bg-white/10 disabled:opacity-25" aria-label="Next pages"><ChevronRight size={18} /></button>
      </div>
      <div className="relative mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {chapters.map((c, i) => {
          const on = left?.chapterIndex === i || right?.chapterIndex === i
          return (
            <button key={c + i} type="button" onClick={() => goTo(i)}
              className={cn('rounded-full px-3 py-1 text-xs font-semibold border transition-colors', on ? 'border-transparent' : 'bg-black/20 border-white/10 text-white/60 hover:text-white')}
              style={on ? { background: 'var(--trim)', color: '#1c1206' } : undefined}>
              {romanOf(i)} · {c}
            </button>
          )
        })}
        <button type="button" onClick={onAddChapter} className="rounded-full px-3 py-1 text-xs font-semibold border border-dashed border-white/25 text-white/60 hover:text-white inline-flex items-center gap-1"><Plus size={12} />Chapter</button>
      </div>
    </div>

    {/* The side panel: Chapters | Inside look */}
    <div className="card-glass !bg-slate-900 overflow-hidden xl:sticky xl:top-4">
      {/* Two tabs, in the book's own leather */}
      <div className="grid grid-cols-2 gap-1 p-1.5" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
        {([['chapters', 'Chapters', BookOpen], ['inside', 'Inside look', Palette]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setPanel(id)}
            className={cn('rounded-xl py-2.5 text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-all', panel === id ? 'bg-slate-900 text-ink shadow' : 'text-white/75 hover:text-white hover:bg-white/10')}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>
      <div className="p-4">
      {panel === 'chapters'
        ? <ChaptersPanel chapters={chapters} badges={badges} showing={[left?.chapterIndex, right?.chapterIndex]} onGo={goTo}
            onRename={onRenameChapter} onAdd={onAddChapter} onChapters={onChapters} onAddBadge={onAdd} />
        : <InsidePanel style={book.insideStyle} onChange={onInside} />}
      </div>
    </div>
    </div>
  )
}

// ── Chapters: rename, reorder, remove an empty one, jump to it ────────────────────────────────
function ChaptersPanel({ chapters, badges, showing, onGo, onRename, onAdd, onChapters, onAddBadge }: {
  chapters: string[]
  badges: BadgeDef[]
  showing: Array<number | undefined>
  onGo: (i: number) => void
  onRename: (from: string, to: string) => void
  onAdd: () => void
  onChapters: (next: string[]) => void
  onAddBadge: (chapter: string) => void   // straight to a new badge in this chapter (it grows a page when full)
}) {
  const move = (i: number, by: -1 | 1) => {
    const next = [...chapters]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    onChapters(next)
  }
  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">Click a name to rename it. Each chapter starts on a fresh page and grows another when its 6 spots fill.</p>
      <ol className="space-y-2">
        {chapters.map((c, i) => {
          const count = badges.filter((b) => b.page === c).length
          const on = showing.includes(i)
          return (
            <li key={c} className={cn('relative rounded-2xl border p-2.5 pl-3 transition-all overflow-hidden', on ? 'border-violet-500/50 bg-violet-600/5 shadow-sm' : 'border-slate-800 bg-slate-950/50 hover:border-slate-700')}>
              {on && <span className="absolute left-0 inset-y-2 w-1 rounded-r-full bg-violet-600" />}
              <div className="flex items-center gap-2">
                <span className="pinbook-serif w-8 h-8 rounded-full text-[11px] font-bold shrink-0 flex items-center justify-center shadow-[inset_0_-2px_3px_rgba(0,0,0,0.3)]"
                  style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--trim) 70%, white), var(--trim))', color: '#1c1206' }}>{romanOf(i)}</span>
                <ChapterName name={c} onRename={(to) => onRename(c, to)} taken={chapters} />
                <button type="button" onClick={() => onGo(i)} title="Show this chapter" aria-label={`Show ${c}`} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800"><Eye size={15} /></button>
              </div>
              {/* Its pins so far, small (the six spots of its last page) */}
              <div className="mt-2 pl-10 flex items-center gap-1">
                {Array.from({ length: PER_PAGE }, (_, k) => {
                  const inCh = badges.filter((b) => b.page === c)
                  const lastPage = Math.floor(Math.max(0, inCh.length - 1) / PER_PAGE)
                  const pin = inCh[lastPage * PER_PAGE + k]
                  return pin
                    ? <span key={k} className="w-6 h-6 flex items-center justify-center" title={pin.name}><BadgePin art={pin.art} imageUrl={pin.imageUrl} size={24} /></span>
                    : <span key={k} className="w-6 h-6 rounded-full border border-dashed border-slate-700" />
                })}
              </div>
              <div className="mt-1.5 flex items-center gap-1 pl-10">
                <span className="text-[11px] text-slate-500 flex-1">{count} badge{count === 1 ? '' : 's'} · {Math.max(1, Math.ceil((count + 1) / PER_PAGE))} page{Math.ceil((count + 1) / PER_PAGE) > 1 ? 's' : ''}</span>
                <button type="button" onClick={() => onAddBadge(c)} title={`Make a new badge in ${c}`}
                  className="mr-1 rounded-full px-2 py-0.5 text-[11px] font-bold bg-violet-600 text-white hover:bg-violet-500 inline-flex items-center gap-0.5"><Plus size={11} />Badge</button>
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up" className="p-1 rounded text-slate-500 hover:text-ink hover:bg-slate-800 disabled:opacity-25"><ArrowUp size={14} /></button>
                <button type="button" disabled={i === chapters.length - 1} onClick={() => move(i, 1)} aria-label="Move down" title="Move down" className="p-1 rounded text-slate-500 hover:text-ink hover:bg-slate-800 disabled:opacity-25"><ArrowDown size={14} /></button>
                <button type="button" disabled={count > 0 || chapters.length < 2}
                  onClick={() => { if (confirm(`Remove the empty chapter “${c}”?`)) onChapters(chapters.filter((x) => x !== c)) }}
                  title={count > 0 ? 'Move or delete its badges first — only an empty chapter can be removed' : chapters.length < 2 ? 'A book needs at least one chapter' : 'Remove this empty chapter'}
                  aria-label="Remove chapter" className="p-1 rounded text-slate-500 hover:text-red-600 hover:bg-slate-800 disabled:opacity-25"><Trash2 size={14} /></button>
              </div>
            </li>
          )
        })}
      </ol>
      <button type="button" onClick={onAdd} className="mt-3 w-full rounded-xl border-2 border-dashed border-slate-700 hover:border-violet-500 py-2.5 text-sm font-semibold text-slate-500 hover:text-ink inline-flex items-center justify-center gap-1.5"><Plus size={15} />Add a chapter</button>
    </div>
  )
}

function ChapterName({ name, onRename, taken }: { name: string; onRename: (to: string) => void; taken: string[] }) {
  const [text, setText] = useState(name)
  const commit = () => {
    const t = text.trim()
    if (!t || (t !== name && taken.includes(t))) return setText(name) // empty or another chapter's name: back
    if (t !== name) onRename(t)
  }
  return (
    <input value={text} maxLength={28} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(name); (e.target as HTMLInputElement).blur() } }}
      className="flex-1 min-w-0 bg-transparent border border-transparent hover:border-slate-700 focus:border-violet-500 rounded-lg px-2 py-1 text-sm font-semibold text-ink outline-none" />
  )
}

// ── Inside look: felt colour, trim colour, frame, texture ───────────────────────────────────
const FELTS: Array<[string, string]> = [
  ['Classic brown', '#2a221c'], ['Midnight purple', '#2c2240'], ['Navy', '#1b2540'], ['Emerald', '#163428'],
  ['Crimson', '#3a1518'], ['Plum', '#34182f'], ['Teal', '#123336'], ['Charcoal', '#26262a'],
  ['Forest', '#1f2e18'], ['Wine', '#3b1a26'], ['Sky', '#27425e'], ['Sand', '#4a3f2e'],
]
const TRIMS: Array<[string, string]> = [
  ['Gold', '#d6b168'], ['Silver', '#c7ccd3'], ['Rose gold', '#e0a08c'], ['Copper', '#d08a52'],
  ['Bronze', '#a8793f'], ['Emerald', '#6fd3a2'], ['Sapphire', '#8fb2ff'], ['Amethyst', '#c49bff'],
]

function InsidePanel({ style, onChange }: { style: InsideStyle | undefined; onChange: (s: InsideStyle | undefined) => void }) {
  const s = style ?? {}
  const set = (p: Partial<InsideStyle>) => onChange({ ...s, ...p })
  const page = s.page || INSIDE_DEFAULTS.page, trim = s.trim || INSIDE_DEFAULTS.trim
  const swatches = (list: Array<[string, string]>, value: string, key: 'page' | 'trim') => (
    <div className="flex flex-wrap gap-2">
      {list.map(([name, col]) => (
        <button key={col} type="button" title={name} aria-label={name} onClick={() => set({ [key]: col })}
          className={cn('w-9 h-9 rounded-xl shadow-sm transition-transform hover:scale-110', value.toLowerCase() === col && 'ring-2 ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a] scale-110')}
          style={{ background: key === 'page' ? `radial-gradient(circle at 50% 40%, ${col}, color-mix(in srgb, ${col} 35%, black))` : `linear-gradient(135deg, color-mix(in srgb, ${col} 35%, white), ${col} 50%, color-mix(in srgb, ${col} 65%, black))` }} />
      ))}
      <label title="Any colour" className="relative w-9 h-9 rounded-xl border-2 border-dashed border-slate-600 flex items-center justify-center text-slate-500 hover:text-ink cursor-pointer overflow-hidden">
        <Palette size={14} />
        <input type="color" value={value} onChange={(e) => set({ [key]: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
      </label>
    </div>
  )
  const toggle = (label: string, on: boolean, flip: () => void) => (
    <button type="button" onClick={flip} className="w-full flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-sm font-semibold text-ink">
      {label}
      <span className={cn('w-9 h-5 rounded-full p-0.5 transition-colors', on ? 'bg-violet-600' : 'bg-slate-700')}>
        <span className={cn('block w-4 h-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')} />
      </span>
    </button>
  )
  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">How the inside of your book looks — fans see it exactly like this.</p>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Pages</p>
        {swatches(FELTS, page, 'page')}
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Trim <span className="normal-case font-normal tracking-normal">· frames, chapter titles, nameplates</span></p>
        {swatches(TRIMS, trim, 'trim')}
      </div>
      <div className="space-y-2">
        {toggle('Page frame', s.frame !== false, () => set({ frame: s.frame === false ? undefined : false }))}
        {toggle('Felt texture', s.texture !== false, () => set({ texture: s.texture === false ? undefined : false }))}
      </div>
      {style && (
        <button type="button" onClick={() => onChange(undefined)} className="text-xs font-semibold text-slate-500 hover:text-ink inline-flex items-center gap-1"><RotateCcw size={12} />Back to the classic inside</button>
      )}
    </div>
  )
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const romanOf = (i: number) => ROMAN[i] ?? String(i + 1)

function Velvet({ children, side }: { children: React.ReactNode; accent?: string; side: 'left' | 'right' }) {
  return (
    <div
      className={cn('pinbook-page relative aspect-[0.78] p-[6%] flex flex-col', side === 'left' ? 'pinbook-page-left md:rounded-l-[10px]' : 'pinbook-page-right md:rounded-r-[10px]')}
    >
      {/* The trim's frame (the same as the real pin book's) */}
      <div className="pinbook-frame absolute inset-[3.2%] pointer-events-none" />
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
            style={{ color: accent, borderColor: 'color-mix(in srgb, var(--trim) 55%, transparent)' }}
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
              <span className="pinbook-serif max-w-full truncate rounded px-2 py-0.5 text-[clamp(8px,1.1vw,11px)] font-bold uppercase tracking-wider" style={{ background: 'linear-gradient(180deg, var(--trim), color-mix(in srgb, var(--trim) 45%, black))', color: '#1c1206' }}>{b.name}</span>
            </button>
          ) : i === plusAt ? (
            <button key={'plus' + i} type="button" onClick={() => onAdd(page.chapter)}
              className="group flex flex-col items-center justify-center gap-[6%]">
              <span
                className="flex items-center justify-center w-[52%] aspect-square rounded-full border-2 border-dashed transition-all group-hover:scale-110 group-hover:bg-white/5"
                style={{ borderColor: 'color-mix(in srgb, var(--trim) 80%, transparent)', color: accent, boxShadow: 'inset 0 3px 10px rgba(0,0,0,0.7)' }}
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
