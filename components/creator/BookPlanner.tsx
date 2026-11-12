'use client'

// The Creator Book, open: its pages of pin spots in the book's own leather and velvet. A filled spot
// is a badge (tap to edit it); an empty one is a "+" pinhole (tap to make a badge there). Chapters
// run down the side — rename one by tapping its title, add more. Each chapter starts on a fresh
// page, 6 pins a page, and always keeps one empty spot to add to. docs/creators.md.

import { PAGE_PATTERNS, pagePatternOf, patternCss, patternParams, type PagePatternDef } from '@/lib/pagePatterns'
import { ACCENT_COLORS } from '@/components/badges/CoverSpine'
import { ColorPick, Group, PicturePlacer, ValueSlider, shrink } from '@/components/creator/CoverDesigner'
import { PAGE_FRAMES, pageFrameOf, frameCss, FRAME_W } from '@/lib/pageFrames'
import { EDGE_COLORS, EDGE_TEXTURES, edgeBackground } from '@/lib/bookEdges'
import { badgeArt, badgeAsset } from '@/lib/badgeAssets'
import { appStorage } from '@/lib/firebase/appStorage'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStickyCenter } from '@/lib/useStickyCenter'
import { SaveBar } from '@/components/creator/SaveBar'
import { Portal } from '@/components/creator/Portal'
import { BINDINGS, BookBinding, bindingOf, bindingParams, type BindingDef } from '@/components/badges/BookBinding'
import { ChevronLeft, ChevronRight, Plus, Pencil, ArrowUp, ArrowDown, Trash2, BookOpen, Palette, RotateCcw, Eye, Dices, ImagePlus, Loader2, Sparkles, Frame, Link2, Check, Sun } from 'lucide-react'
import { INSIDE_DEFAULTS, PIN_SHADOW, insideLook, isLive, pinShadowCss, pagePin, pinDrawSize, type BadgeDef, type BadgeSet, type InsideStyle } from '@/lib/badges'
import { BadgePin } from '@/components/badges/BadgePin'
import { Corners } from '@/components/creator/Ornaments'
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

export function BookPlanner({ uid, book, badges, onAdd, onEdit, onRenameChapter, onAddChapter, onChapters, onInside, insideDirty = false, onSaveInside, onUndoInside, onRevertInside }: {
  book: BadgeSet
  badges: BadgeDef[]
  onAdd: (chapter: string) => void
  onEdit: (badge: BadgeDef) => void
  onRenameChapter: (from: string, to: string) => void
  onAddChapter: () => void
  onChapters: (next: string[]) => void          // reordered / one removed (only an empty one)
  onInside: (style: InsideStyle | undefined) => void
  uid: string
  insideDirty?: boolean          // the Inside look has changes not saved yet ("Save page changes")
  onSaveInside?: () => void
  onUndoInside?: () => void
  onRevertInside?: () => void   // back to the classic inside, saved at once (after a warning)
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
  const inside = insideLook(book.insideStyle ?? {}, book.coverImage)
  const [panel, setPanel] = useState<'chapters' | 'inside' | 'accessories'>('chapters')
  const stick = useStickyCenter()
  const goTo = (chapter: number) => {
    const i = pages.findIndex((p) => p.chapterIndex === chapter)
    if (i >= 0) setSpread(Math.floor(i / 2))
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] items-start" style={inside.style /* the trim colour for the side panel too */}>
    {/* The book stays in the middle of the window while the edit panel beside it scrolls */}
    <div ref={stick.ref} className={cn(inside.className, 'haven-panel haven-grain relative !px-3 !py-8 md:!px-12 md:!py-10 xl:sticky xl:self-start')} style={{ ...inside.style, top: stick.top }}>
      {/* It lies open on the binder paper, inside a thin rule with engraved corners */}
      <div className="absolute inset-[6px] rounded-[10px] border border-[#d6c49f] pointer-events-none" />
      <Corners inset={12} size={44} />
      {/* The open book: leather all round, two felt pages, trim frames */}
      <div className="pinbook-rim relative mx-auto max-w-[980px] rounded-[18px] shadow-[0_24px_50px_-20px_rgba(0,0,0,0.6)]" style={{ background: `linear-gradient(150deg, ${from}, ${to})`, padding: 'calc(1.6% * var(--edge-k, 1))' }}>
        <div className="pinbook-rim-stitch absolute inset-[0.8%] rounded-[14px] border border-dashed pointer-events-none" style={{ borderColor: book.cover.accent + '70' }} />
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-0">
          <Page page={left} accent={accent} side="left" onAdd={onAdd} onEdit={onEdit} onRename={onRenameChapter} />
          <div className="hidden md:block">
            {right ? <Page page={right} accent={accent} side="right" onAdd={onAdd} onEdit={onEdit} onRename={onRenameChapter} /> : <EmptyPage accent={accent} onAddChapter={onAddChapter} />}
          </div>
          {/* The spine and the Center rings, as fans will see them */}
          <div className="hidden md:block absolute inset-0 pointer-events-none z-20"><BookBinding st={book.insideStyle} /></div>
        </div>
      </div>

      {/* Turning pages + chapters */}
      <div className="relative mt-5 flex items-center justify-center gap-2">
        <button type="button" onClick={() => setSpread(Math.max(0, at - 1))} disabled={at === 0} className="haven-medallion w-9 h-9 hover:border-[#7a5230] disabled:opacity-30" aria-label="Previous pages"><ChevronLeft size={17} /></button>
        <span className="text-xs font-semibold text-slate-500 tabular-nums px-2">Pages {at * 2 + 1}{right ? `–${at * 2 + 2}` : ''} of {pages.length}</span>
        <button type="button" onClick={() => setSpread(Math.min(spreads - 1, at + 1))} disabled={at >= spreads - 1} className="haven-medallion w-9 h-9 hover:border-[#7a5230] disabled:opacity-30" aria-label="Next pages"><ChevronRight size={17} /></button>
      </div>
      <div className="relative mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {chapters.map((c, i) => {
          const on = left?.chapterIndex === i || right?.chapterIndex === i
          return (
            <button key={c + i} type="button" onClick={() => goTo(i)}
              className={cn('haven-chip px-3 py-1 text-xs font-semibold', on && 'haven-chip-on')}>
              {romanOf(i)} · {c}
            </button>
          )
        })}
        <button type="button" onClick={onAddChapter} className="haven-chip !border-dashed px-3 py-1 text-xs font-semibold inline-flex items-center gap-1"><Plus size={12} />Chapter</button>
      </div>
    </div>

    {/* The side panel: Chapters | Inside look */}
    <div className="haven-panel !p-0 overflow-clip">
      {/* Two tabs */}
      <div className="grid grid-cols-3 gap-1.5 p-2 border-b border-[#d6c49f]">
        {([['chapters', 'Chapters', BookOpen], ['inside', 'Page Design', Palette], ['accessories', 'Badge Accessories', Sun]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setPanel(id)}
            className={cn('haven-chip px-1.5 py-2 text-[12px] leading-tight font-semibold inline-flex items-center justify-center gap-1.5 text-center', panel === id && 'haven-chip-on')}>
            <Icon size={14} className="shrink-0" />{label}
          </button>
        ))}
      </div>
      <div className="p-4">
      {panel === 'chapters'
        ? <ChaptersPanel chapters={chapters} badges={badges} showing={[left?.chapterIndex, right?.chapterIndex]} onGo={goTo}
            onRename={onRenameChapter} onAdd={onAddChapter} onChapters={onChapters} onAddBadge={onAdd} />
        : <InsidePanel uid={uid} part={panel === 'accessories' ? 'badge' : 'page'} style={book.insideStyle} onChange={onInside} onRevert={onRevertInside} coverImage={book.coverImage} />}
      </div>
      {/* The look of the pages is kept only when saved */}
      <SaveBar dirty={insideDirty} onSave={() => onSaveInside?.()} onUndo={() => onUndoInside?.()} saveLabel="Save pages" savedLabel="Page look saved" className="mx-4 mb-4" />
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
            <li key={c} className={cn('relative rounded-xl border p-2.5 pl-3 transition-colors overflow-hidden bg-[#f6eedb]', on ? 'border-[#c4ae83] shadow-[inset_0_0_0_2px_#f6eedb,inset_0_0_0_3px_rgba(148,128,95,0.28)]' : 'border-[#d6c49f] hover:border-[#c4ae83]')}>
              <div className="flex items-center gap-2">
                <span className="haven-medallion pinbook-serif w-8 h-8 text-[11px] font-bold shrink-0">{romanOf(i)}</span>
                <ChapterName name={c} onRename={(to) => onRename(c, to)} taken={chapters} />
                <button type="button" onClick={() => onGo(i)} title="Show this chapter" aria-label={`Show ${c}`} className="p-1.5 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800"><Eye size={15} /></button>
              </div>
              {/* Its pins so far, small (the six spots of its last page), as pinholes in the paper */}
              <div className="mt-2 pl-10 flex items-center gap-1.5">
                {Array.from({ length: PER_PAGE }, (_, k) => {
                  const inCh = badges.filter((b) => b.page === c)
                  const lastPage = Math.floor(Math.max(0, inCh.length - 1) / PER_PAGE)
                  const pin = inCh[lastPage * PER_PAGE + k]
                  return pin
                    ? <span key={k} className="w-6 h-6 flex items-center justify-center" title={pin.name}><BadgePin art={pin.art} imageUrl={pin.imageUrl} size={24} /></span>
                    : <span key={k} className="w-6 h-6 rounded-full bg-[#ebdfc3] shadow-[inset_0_1px_3px_rgba(60,35,15,0.28)]" />
                })}
              </div>
              <div className="mt-1.5 flex items-center gap-1 pl-10">
                <span className="text-[11px] text-slate-500 flex-1 whitespace-nowrap italic" style={{ fontFamily: 'Georgia, serif' }}>{count} badge{count === 1 ? '' : 's'} · {Math.max(1, Math.ceil((count + 1) / PER_PAGE))} page{Math.ceil((count + 1) / PER_PAGE) > 1 ? 's' : ''}</span>
                <button type="button" onClick={() => onAddBadge(c)} title={`Make a new badge in ${c}`}
                  className="mr-1 haven-chip haven-chip-on px-2 py-0.5 text-[11px] font-semibold inline-flex items-center gap-0.5"><Plus size={11} />Badge</button>
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
      <button type="button" onClick={onAdd} className="mt-3 w-full rounded-xl border border-dashed border-[#c4ae83] hover:border-[#7a5230] py-2.5 text-sm font-semibold text-slate-500 hover:text-ink inline-flex items-center justify-center gap-1.5"><Plus size={15} />Add a chapter</button>
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

function InsidePanel({ uid, part, style, onChange, onRevert, coverImage }: { uid: string; part: 'page' | 'badge'; style: InsideStyle | undefined; onChange: (s: InsideStyle | undefined) => void; onRevert?: () => void; coverImage?: string }) {
  const [reverting, setReverting] = useState(false)
  const s = style ?? {}
  const set = (p: Partial<InsideStyle>) => onChange({ ...s, ...p })
  const page = s.page || INSIDE_DEFAULTS.page, trim = s.trim || INSIDE_DEFAULTS.trim
  const [open, setOpen] = useState<string | null>('pages')
  const swatches = (list: Array<[string, string]>, value: string, key: 'page' | 'trim') => (
    <div className="flex flex-wrap gap-2">
      {list.map(([name, col]) => (
        <button key={col} type="button" title={name} aria-label={name} onClick={() => set({ [key]: col })}
          className={cn('w-8 h-8 rounded-xl shadow-sm transition-transform hover:scale-110', value.toLowerCase() === col && 'ring-2 ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a] scale-110')}
          style={{ background: key === 'page' ? `radial-gradient(circle at 50% 40%, ${col}, color-mix(in srgb, ${col} 35%, black))` : `linear-gradient(135deg, color-mix(in srgb, ${col} 35%, white), ${col} 50%, color-mix(in srgb, ${col} 65%, black))` }} />
      ))}
      <label title="Any colour" className="relative w-8 h-8 rounded-xl border-2 border-dashed border-slate-600 flex items-center justify-center text-slate-500 hover:text-ink cursor-pointer overflow-hidden">
        <Palette size={14} />
        <input type="color" value={value} onChange={(e) => set({ [key]: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
      </label>
    </div>
  )
  const toggle = (label: string, on: boolean, flip: () => void) => (
    <button type="button" onClick={flip} className="w-full flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-ink">
      {label}
      <span className={cn('w-9 h-5 rounded-full p-0.5 transition-colors', on ? 'bg-violet-600' : 'bg-slate-700')}>
        <span className={cn('block w-4 h-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')} />
      </span>
    </button>
  )
  const frameDef = pageFrameOf(s.frameStyle)
  const edgeName = EDGE_TEXTURES.find((t) => t.id === s.edgeTexture)?.name
  return (
    <div className="space-y-2">
      {part === 'badge' ? (
        <>
          <p className="text-xs text-slate-500 mb-3">How every badge sits on your pages — fans see it exactly like this.</p>
          <div className="rounded-2xl border border-slate-700 bg-slate-950/30 p-4">
            <p className="flex items-center gap-2 font-bold text-ink mb-3"><span className="haven-medallion w-8 h-8"><Sun size={15} /></span>Badge shadow</p>
            <ShadowPicker s={s} page={page} set={set} />
          </div>
        </>
      ) : (<>
      <p className="text-xs text-slate-500 mb-3">How the pages of your book look — fans see it exactly like this.</p>
      <Group id="pages" open={open} setOpen={setOpen} icon={Palette} title="Pages" summary="Felt colour, trim and texture">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Felt</p>
        {swatches(FELTS, page, 'page')}
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-4 mb-2">Trim <span className="normal-case font-normal tracking-normal">· titles, nameplates, the classic border</span></p>
        {swatches(TRIMS, trim, 'trim')}
        <div className="mt-4">{toggle('Felt texture', s.texture !== false, () => set({ texture: s.texture === false ? undefined : false }))}</div>
      </Group>
      <Group id="picture" open={open} setOpen={setOpen} icon={ImagePlus} title="Page picture" summary={s.pageImage ? 'Your picture on every page' : 'Add your own background'}>
        <PagePicture uid={uid} s={s} set={set} />
      </Group>
      <Group id="pattern" open={open} setOpen={setOpen} icon={Sparkles} title="Pattern" summary={pagePatternOf(s.pattern)?.name ?? 'Plain'}>
        <PatternPicker s={s} page={page} set={set} />
      </Group>
      <Group id="border" open={open} setOpen={setOpen} icon={Frame} title="Border" summary={s.frame === false ? 'None' : frameDef?.name ?? 'Classic'}>
        <FramePicker s={s} page={page} trim={trim} set={set} />
      </Group>
      <Group id="rings" open={open} setOpen={setOpen} icon={Link2} title="Center rings" summary={s.binding === 'none' ? 'None' : bindingOf(s.binding)?.name ?? 'Silver rings (classic)'}>
        <RingsPicker s={s} page={page} set={set} />
      </Group>
      <Group id="edge" open={open} setOpen={setOpen} icon={BookOpen} title="Book edge" summary={edgeName ? `${edgeName}${s.edgeStitch === false ? '' : ' · stitched'}` : 'The book’s usual rim'}>
        <EdgePicker s={s} set={set} coverImage={coverImage} />
      </Group>
      </>)}
      {style && (
        <button type="button" onClick={() => setReverting(true)} className="pt-2 text-xs font-semibold text-slate-500 hover:text-ink inline-flex items-center gap-1"><RotateCcw size={12} />Back to the classic inside</button>
      )}
      {reverting && (
        <PaperDialog title="Back to the classic inside?" onClose={() => setReverting(false)}>
          <p className="text-sm text-ink font-semibold">This can not be undone.</p>
          <p className="mt-1 text-sm text-slate-500">This will revert all pages back to the default — the felt, pattern, page picture, border, book edge and center rings. Are you sure?</p>
          <div className="mt-5 flex flex-col gap-2">
            <button type="button" onClick={() => { setReverting(false); (onRevert ?? (() => onChange(undefined)))() }} className="btn-primary justify-center !bg-[#a8452a]"><RotateCcw size={15} />Yes, revert all pages</button>
            <button type="button" onClick={() => setReverting(false)} className="py-1.5 text-sm font-semibold text-slate-500 hover:text-ink">Cancel</button>
          </div>
        </PaperDialog>
      )}
    </div>
  )
}

/** The shadow behind every badge, even all round: on/off, colour, strength, softness */
function ShadowPicker({ s, page, set }: { s: InsideStyle; page: string; set: (p: Partial<InsideStyle>) => void }) {
  const on = s.pinShadow !== false
  return (
    <div>
      <button type="button" onClick={() => set({ pinShadow: on ? false : undefined })} className="w-full flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-ink">
        Shadow behind badges
        <span className={cn('w-9 h-5 rounded-full p-0.5 transition-colors', on ? 'bg-violet-600' : 'bg-slate-700')}>
          <span className={cn('block w-4 h-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')} />
        </span>
      </button>
      {/* A pin on the felt, lit the way it'll be */}
      <div className="mt-3 h-28 rounded-xl flex items-center justify-center" style={{ background: `radial-gradient(120% 90% at 50% 42%, ${page}, color-mix(in srgb, ${page} 40%, black))` }}>
        <span className="w-16 h-[72px]" style={{ filter: pinShadowCss(s) }}>
          <svg viewBox="0 0 64 72" className="w-full h-full" aria-hidden>
            <defs><radialGradient id="shadow-demo-pin" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor="#fff3cf" /><stop offset="0.45" stopColor="#d6b168" /><stop offset="1" stopColor="#7a5a20" /></radialGradient></defs>
            <path d="M32 2 L58 14 L58 44 Q58 60 32 70 Q6 60 6 44 L6 14 Z" fill="url(#shadow-demo-pin)" stroke="#8a6420" strokeWidth="2" />
            <path d="M32 12 L49 20 L49 42 Q49 53 32 60 Q15 53 15 42 L15 20 Z" fill="none" stroke="#fff3cf" strokeOpacity="0.6" strokeWidth="1.5" />
          </svg>
        </span>
      </div>
      {on && (
        <div className="mt-1">
          <ColorPick label="Colour" value={s.pinShadowColor ?? '#000000'} palette={[{ name: 'Black', color: '#000000' }, { name: 'Brown', color: '#2b1a0f' }, { name: 'Navy', color: '#0b1430' }, { name: 'Plum', color: '#2a0f26' }, { name: 'Gold glow', color: '#d6b168' }, { name: 'White glow', color: '#ffffff' }]} onChange={(c) => set({ pinShadowColor: c })} />
          <ValueSlider label="Strength" min={0} max={1} step={0.05} value={s.pinShadowStrength ?? PIN_SHADOW.strength} onChange={(v) => set({ pinShadowStrength: v })} />
          <ValueSlider label="Spread" min={0} max={24} step={0.5} value={s.pinShadowSpread ?? PIN_SHADOW.spread} unit="px" onChange={(v) => set({ pinShadowSpread: v })} />
          <ValueSlider label="Softness" min={0} max={30} step={0.5} value={s.pinShadowBlur ?? PIN_SHADOW.blur} unit="px" onChange={(v) => set({ pinShadowBlur: v })} />
          {(s.pinShadowColor || s.pinShadowStrength !== undefined || s.pinShadowBlur !== undefined || s.pinShadowSpread !== undefined) && (
            <button type="button" onClick={() => set({ pinShadowColor: undefined, pinShadowStrength: undefined, pinShadowBlur: undefined, pinShadowSpread: undefined })} className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-ink inline-flex items-center gap-1"><RotateCcw size={11} />Back to the usual shadow</button>
          )}
        </div>
      )}
    </div>
  )
}

/** The creator's own picture on every page: upload, Strength, Fade edges */
function PagePicture({ uid, s, set }: { uid: string; s: InsideStyle; set: (p: Partial<InsideStyle>) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true); setError('')
    try {
      const blob = await shrink(file)
      const r = ref(appStorage, `creators/${uid}/page-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`)
      await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' })
      set({ pageImage: await getDownloadURL(r), pageImageFit: undefined })
    } catch (e) {
      setError('Couldn’t upload that picture — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div>
      {s.pageImage ? (
        <>
          {/* Drag and zoom it on a page, like the cover picture */}
          <PicturePlacer src={badgeArt(s.pageImage)!} fit={s.pageImageFit} onChange={(pageImageFit) => set({ pageImageFit })} aspect={0.78} fillLabel="Fill page"
            base={`radial-gradient(120% 90% at 50% 42%, ${s.page || INSIDE_DEFAULTS.page}, color-mix(in srgb, ${s.page || INSIDE_DEFAULTS.page} 40%, black))`} />
          <ValueSlider label="Strength" min={0.05} max={1} step={0.05} value={s.pageImageOpacity ?? 0.5} onChange={(v) => set({ pageImageOpacity: v })} />
          <ValueSlider label="Fade edges" min={0} max={1} step={0.05} value={s.pageImageFade ?? 0.4} onChange={(v) => set({ pageImageFade: v })} />
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="haven-chip px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Change picture
            </button>
            <button type="button" onClick={() => set({ pageImage: undefined, pageImageFit: undefined })} className="ml-auto haven-chip px-3 py-1.5 text-xs font-semibold">Remove</button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className="w-full rounded-2xl border-2 border-dashed border-[#c4ae83] hover:border-[#7a5230] bg-[#f6eedb] py-6 flex flex-col items-center gap-1.5 text-slate-500 hover:text-ink transition-colors">
          <span className="haven-medallion w-10 h-10">{busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}</span>
          <span className="text-sm font-bold text-ink">{busy ? 'Uploading…' : 'Upload a page picture'}</span>
          <span className="text-[11px] px-5 text-center">It shows softly behind your badges on every page, over the felt.</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  )
}

/** The page border: None, Classic, then 20 styles in three groups; colours and width */
function FramePicker({ s, page, trim, set }: { s: InsideStyle; page: string; trim: string; set: (p: Partial<InsideStyle>) => void }) {
  const def = s.frame === false ? null : pageFrameOf(s.frameStyle)
  const felt = `radial-gradient(120% 90% at 50% 42%, ${page}, color-mix(in srgb, ${page} 45%, black))`
  const tile = (id: string, label: string, on: boolean, onClick: () => void, inner: React.ReactNode) => (
    <button key={id} type="button" onClick={onClick} title={label}
      className={cn('rounded-lg border p-0.5 transition-colors', on ? 'border-[#7a5230] shadow-[0_0_0_1px_#7a5230]' : 'border-[#d6c49f] hover:border-[#a8875c]')}>
      <span className="relative block w-full aspect-[0.78] rounded-[5px] overflow-hidden" style={{ background: felt }}>{inner}</span>
      <span className={cn('block mt-0.5 text-[9px] leading-tight font-semibold truncate', on ? 'text-ink' : 'text-slate-500')}>{label}</span>
    </button>
  )
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5">
        {tile('none', 'None', s.frame === false, () => set({ frame: false }), <span className="absolute inset-0 flex items-center justify-center text-white/40 text-sm">∅</span>)}
        {tile('classic', 'Classic', s.frame !== false && !s.frameStyle, () => set({ frame: undefined, frameStyle: undefined }),
          <span className="absolute inset-[12%] rounded-[2px]" style={{ border: `1px solid color-mix(in srgb, ${trim} 55%, transparent)`, boxShadow: `inset 0 0 0 3px transparent, inset 0 0 0 4px color-mix(in srgb, ${trim} 25%, transparent)` }} />)}
      </div>
      {(['Elegant', 'Retro', 'Fun'] as const).map((g) => (
        <div key={g} className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 mb-1.5">{g}</p>
          <div className="grid grid-cols-5 gap-1.5">
            {PAGE_FRAMES.filter((f) => f.group === g).map((f) => tile(f.id, f.name, def?.id === f.id, () => set({ frame: undefined, frameStyle: f.id }),
              <span className="absolute inset-[9%]" style={{ border: '9px solid transparent', borderImage: `${frameCss({ ...s, frameStyle: f.id }, trim)} 40 / 9px / 0 round` }} />))}
          </div>
        </div>
      ))}
      {def && (
        <div className="mt-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3">
          <p className="pinbook-serif font-bold text-ink">{def.name}</p>
          <ColorPick label={def.two ? 'Colour one' : 'Colour'} value={s.frameColor ?? def.color ?? trim} palette={ACCENT_COLORS} onChange={(c) => set({ frameColor: c })} />
          {def.two && <ColorPick label={def.two[0]} value={s.frameColor2 ?? def.two[1]} palette={ACCENT_COLORS} onChange={(c) => set({ frameColor2: c })} />}
          <ValueSlider label="Width" min={6} max={40} step={1} value={s.frameWidth ?? FRAME_W} unit="px" onChange={(v) => set({ frameWidth: v })} />
          {(s.frameColor || s.frameColor2) && (
            <button type="button" onClick={() => set({ frameColor: undefined, frameColor2: undefined })} className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-ink inline-flex items-center gap-1"><RotateCcw size={11} />This border’s own colours</button>
          )}
        </div>
      )}
    </div>
  )
}

/** The center rings (shown to fans only): tiles with a mini spread each, then a bigger live
 *  preview and the chosen binding's colours and sliders */
function RingsPicker({ s, page, set }: { s: InsideStyle; page: string; set: (p: Partial<InsideStyle>) => void }) {
  const def = s.binding === 'none' ? undefined : bindingOf(s.binding)
  const spreadBg = `linear-gradient(90deg, color-mix(in srgb, ${page} 45%, black), ${page} 40%, color-mix(in srgb, ${page} 55%, black) 50%, ${page} 60%, color-mix(in srgb, ${page} 45%, black))`
  const mini = (st: InsideStyle, big = false) => (
    <span className={cn('relative block w-full rounded-[5px] overflow-hidden', big ? 'aspect-[1.5]' : 'aspect-[1.3]')} style={{ background: spreadBg }}>
      <BookBinding st={st} />
    </span>
  )
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]
  const surprise = (d: BindingDef) => set({
    bindingColor: pick(ACCENT_COLORS).color, bindingColor2: pick([...ACCENT_COLORS, ...EDGE_COLORS]).color, bindingColor3: pick(ACCENT_COLORS).color,
    bindingParams: { ...(s.bindingParams ?? {}), [d.id]: Object.fromEntries(d.sliders.map((x) => [x.key, x.min + Math.round((Math.random() * (x.max - x.min)) / x.step) * x.step])) },
  })
  const reset = (d: BindingDef) => set({
    bindingColor: undefined, bindingColor2: undefined, bindingColor3: undefined,
    bindingParams: { ...(s.bindingParams ?? {}), [d.id]: Object.fromEntries(d.sliders.map((x) => [x.key, x.def])) },
  })
  const tiles: Array<[string, string, InsideStyle]> = [
    ['none', 'None', { ...s, binding: 'none' }],
    ...BINDINGS.map((b): [string, string, InsideStyle] => [b.id, b.name, { ...s, binding: b.id }]),
  ]
  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">What holds your pages together down the middle. It shows when fans open your book — try <b>Preview as a fan</b>.</p>
      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map(([id, name, st]) => {
          const on = (s.binding ?? 'classic') === id
          return (
            <button key={id} type="button" onClick={() => set({ binding: id })} title={name}
              className={cn('rounded-lg border p-0.5 transition-colors', on ? 'border-[#7a5230] shadow-[0_0_0_1px_#7a5230]' : 'border-[#d6c49f] hover:border-[#a8875c]')}>
              {mini(st)}
              <span className={cn('block mt-0.5 text-[9px] leading-tight font-semibold truncate', on ? 'text-ink' : 'text-slate-500')}>{name}</span>
            </button>
          )
        })}
      </div>
      {def && (
        <div className="mt-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3">
          <div className="flex items-center gap-2">
            <p className="pinbook-serif font-bold text-ink flex-1 truncate">{def.name}</p>
            <button type="button" onClick={() => surprise(def)} className="haven-chip px-2 py-1 text-[11px] font-semibold inline-flex items-center gap-1"><Dices size={12} />Surprise</button>
            <button type="button" onClick={() => reset(def)} className="haven-chip px-2 py-1 text-[11px] font-semibold inline-flex items-center gap-1" title="Back to this binding's defaults"><RotateCcw size={12} />Reset</button>
          </div>
          {/* A bigger live look at it */}
          <div className="mt-2.5">{mini({ ...s, binding: def.id }, true)}</div>
          {def.colors.map(([label, d], i) => {
            const key = (['bindingColor', 'bindingColor2', 'bindingColor3'] as const)[i]
            return <ColorPick key={key} label={label} value={s[key] ?? d} palette={i === 0 ? ACCENT_COLORS : [...ACCENT_COLORS, ...EDGE_COLORS]} onChange={(c) => set({ [key]: c })} />
          })}
          <div className="mt-1" />
          {def.sliders.map((x) => (
            <ValueSlider key={x.key} label={x.label} min={x.min} max={x.max} step={x.step} value={bindingParams(def, s)[x.key]}
              onChange={(v) => set({ bindingParams: { ...(s.bindingParams ?? {}), [def.id]: { ...bindingParams(def, s), [x.key]: v } } })} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The open book's outer edge: texture, colour, grain, width, stitching */
function EdgePicker({ s, set, coverImage }: { s: InsideStyle; set: (p: Partial<InsideStyle>) => void; coverImage?: string }) {
  const on = !!s.edgeTexture
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" onClick={() => set({ edgeTexture: undefined })} title="The book's usual rim"
          className={cn('rounded-lg border p-0.5', !on ? 'border-[#7a5230] shadow-[0_0_0_1px_#7a5230]' : 'border-[#d6c49f] hover:border-[#a8875c]')}>
          <span className="block w-full h-10 rounded-[5px] bg-[#e6d7b6] flex items-center justify-center text-[10px] text-slate-500">Usual</span>
          <span className={cn('block mt-0.5 text-[9px] font-semibold truncate', !on ? 'text-ink' : 'text-slate-500')}>Usual</span>
        </button>
        {EDGE_TEXTURES.map((t) => {
          const bg = edgeBackground({ ...s, edgeTexture: t.id }, badgeAsset(coverImage))!
          const picked = s.edgeTexture === t.id
          return (
            <button key={t.id} type="button" onClick={() => set({ edgeTexture: t.id })} title={t.name}
              className={cn('rounded-lg border p-0.5', picked ? 'border-[#7a5230] shadow-[0_0_0_1px_#7a5230]' : 'border-[#d6c49f] hover:border-[#a8875c]')}>
              <span className="block w-full h-10 rounded-[5px]" style={{ backgroundImage: bg.image, backgroundSize: bg.size }} />
              <span className={cn('block mt-0.5 text-[9px] font-semibold truncate', picked ? 'text-ink' : 'text-slate-500')}>{t.name}</span>
            </button>
          )
        })}
      </div>
      {on && (
        <div className="mt-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3">
          {s.edgeTexture !== 'picture' && <ColorPick label="Colour" value={s.edgeColor ?? EDGE_COLORS[0].color} palette={EDGE_COLORS} onChange={(c) => set({ edgeColor: c })} />}
          {s.edgeTexture !== 'picture' && s.edgeTexture !== 'smooth' && <ValueSlider label="Texture" min={0} max={1} step={0.05} value={s.edgeGrain ?? 0.6} onChange={(v) => set({ edgeGrain: v })} />}
          <ValueSlider label="Edge width" min={0.5} max={2.5} step={0.05} value={s.edgeWidth ?? 1} onChange={(v) => set({ edgeWidth: v })} />
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => set({ edgeStitch: s.edgeStitch === false ? undefined : false })} className="flex items-center gap-2 text-xs font-semibold text-ink">
              <span className={cn('w-9 h-5 rounded-full p-0.5 transition-colors', s.edgeStitch !== false ? 'bg-violet-600' : 'bg-slate-700')}>
                <span className={cn('block w-4 h-4 rounded-full bg-white shadow transition-transform', s.edgeStitch !== false && 'translate-x-4')} />
              </span>
              Stitching
            </button>
          </div>
          {s.edgeStitch !== false && <ColorPick label="Thread" value={s.edgeStitchColor ?? '#d6b168'} palette={ACCENT_COLORS} onChange={(c) => set({ edgeStitchColor: c })} />}
        </div>
      )}
    </div>
  )
}

/** The pages' pattern: a tile for each (drawn on the felt), then the chosen one's colours and sliders */
function PatternPicker({ s, page, set }: { s: InsideStyle; page: string; set: (p: Partial<InsideStyle>) => void }) {
  const def = pagePatternOf(s.pattern)
  const felt = `radial-gradient(120% 90% at 50% 42%, ${page}, color-mix(in srgb, ${page} 45%, black))`
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]
  const surprise = (d: PagePatternDef) => set({
    patternColor: pick(ACCENT_COLORS).color, patternDetail: pick(ACCENT_COLORS).color,
    patternOpacity: 0.15 + Math.round(Math.random() * 10) * 0.05, patternFade: Math.round(Math.random() * 10) / 10,
    patternParams: { ...(s.patternParams ?? {}), [d.id]: Object.fromEntries(d.sliders.map((x) => [x.key, x.min + Math.round((Math.random() * (x.max - x.min)) / x.step) * x.step])) },
  })
  const reset = (d: PagePatternDef) => set({
    patternColor: undefined, patternDetail: undefined, patternOpacity: undefined, patternFade: undefined,
    patternParams: { ...(s.patternParams ?? {}), [d.id]: Object.fromEntries(d.sliders.map((x) => [x.key, x.def])) },
  })
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5">
        {[undefined, ...PAGE_PATTERNS].map((d) => {
          const on = def?.id === d?.id
          const bg = d ? patternCss({ ...s, patternOpacity: Math.max(0.45, s.patternOpacity ?? 0.3), patternFade: 0 }, d.id) : null
          return (
            <button key={d?.id ?? 'none'} type="button" onClick={() => set({ pattern: d?.id })} title={d?.name ?? 'No pattern'}
              className={cn('rounded-lg border p-0.5 transition-colors', on ? 'border-[#7a5230] shadow-[0_0_0_1px_#7a5230]' : 'border-[#d6c49f] hover:border-[#a8875c]')}>
              <span className="block w-full aspect-[0.78] rounded-[5px]" style={{ background: bg ? `${bg} center / cover no-repeat, ${felt}` : felt }} />
              <span className={cn('block mt-0.5 text-[9px] leading-tight font-semibold truncate', on ? 'text-ink' : 'text-slate-500')}>{d?.name ?? 'Plain'}</span>
            </button>
          )
        })}
      </div>
      {def && (
        <div className="mt-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3">
          <div className="flex items-center gap-2">
            <p className="pinbook-serif font-bold text-ink flex-1 truncate">{def.name}</p>
            <button type="button" onClick={() => surprise(def)} className="haven-chip px-2 py-1 text-[11px] font-semibold inline-flex items-center gap-1"><Dices size={12} />Surprise</button>
            <button type="button" onClick={() => reset(def)} className="haven-chip px-2 py-1 text-[11px] font-semibold inline-flex items-center gap-1" title="Back to this pattern's defaults"><RotateCcw size={12} />Reset</button>
          </div>
          <ColorPick label={def.color[0]} value={s.patternColor ?? def.color[1]} palette={ACCENT_COLORS} onChange={(c) => set({ patternColor: c })} />
          {def.detail && <ColorPick label={def.detail[0]} value={s.patternDetail ?? def.detail[1]} palette={ACCENT_COLORS} onChange={(c) => set({ patternDetail: c })} />}
          <div className="mt-2" />
          <ValueSlider label="Strength" min={0.05} max={1} step={0.05} value={s.patternOpacity ?? 0.3} onChange={(v) => set({ patternOpacity: v })} />
          <ValueSlider label="Fade edges" min={0} max={1} step={0.05} value={s.patternFade ?? 0.35} onChange={(v) => set({ patternFade: v })} />
          {def.sliders.map((x) => (
            <ValueSlider key={x.key} label={x.label} min={x.min} max={x.max} step={x.step} value={patternParams(def, s.patternParams)[x.key]}
              onChange={(v) => set({ patternParams: { ...(s.patternParams ?? {}), [def.id]: { ...patternParams(def, s.patternParams), [x.key]: v } } })} />
          ))}
        </div>
      )}
    </div>
  )
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const romanOf = (i: number) => ROMAN[i] ?? String(i + 1)

function Velvet({ children, side, boxRef }: { children: React.ReactNode; accent?: string; side: 'left' | 'right'; boxRef?: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={boxRef}
      className={cn('pinbook-page relative aspect-[0.78] min-h-0 p-[6%] flex flex-col', /* min-h-0: the page keeps its shape whatever's on it */ side === 'left' ? 'pinbook-page-left md:rounded-l-[10px]' : 'pinbook-page-right md:rounded-r-[10px]')}
    >
      <div className="pinbook-page-art" /><div className="pinbook-page-pattern" />
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
  // The first empty spot is the "+"; the rest of the page stays blank
  const plusAt = page.spots.findIndex((s) => !s)
  // Pins sized by the pin book's own rule for a page this big, so the Studio matches what fans see
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [pin, setPin] = useState(90)
  useEffect(() => {
    if (!box) return
    // from the width only (the height follows the page's shape) — sizing by a height the pins themselves
    // push on made the page and its pins grow each other
    const fit = () => setPin(pagePin(box.clientWidth, box.clientWidth / 0.78))
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    fit()
    return () => ro.disconnect()
  }, [box])
  return (
    <Velvet accent={accent} side={side} boxRef={setBox}>
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
      {/* Laid out like the pin book's page (BadgeBook PinPage): a fixed area, 2 × 3, that never resizes the page */}
      <div className="absolute inset-x-[7%] top-[15%] bottom-[4%] grid grid-cols-2 grid-rows-3 gap-x-[4%]">
        {page.spots.map((b, i) =>
          b ? (
            <button key={b.id} type="button" onClick={() => onEdit(b)} className="group relative min-h-0 min-w-0 flex flex-col items-center justify-center gap-1.5 rounded-xl hover:bg-white/5 transition-colors">
              <span className="pinbook-pin-shadow relative !flex shrink-0 items-center justify-center transition-transform group-hover:scale-105" style={{ width: pin, height: pin * 1.12 }} /* !flex: .pinbook-pin-shadow is inline-block in the pin book */>
                {/* its Size on the page, as the pin book draws it — in its own box, centred, so a pin over 100%
                    isn't held to the spot's width (an <img> never grows past its parent) */}
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center" style={{ width: pinDrawSize(b, pin), height: pinDrawSize(b, pin) * 1.12 }}>
                  <BadgePin art={b.art} imageUrl={b.imageUrl} size={pinDrawSize(b, pin)} />
                </span>
              </span>
              {!isLive(b) && <span className="absolute top-1 right-1 z-10 rounded-full bg-[#2b2014]/80 border border-[#d6b168]/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#f2d38a]" title="Only you can see it — open it and Publish to make it live">Draft</span>}
              <span className="pinbook-serif shrink-0 max-w-full truncate rounded px-2 py-0.5 text-[clamp(8px,1.1vw,11px)] font-bold uppercase tracking-wider" style={{ background: 'linear-gradient(180deg, var(--trim), color-mix(in srgb, var(--trim) 45%, black))', color: '#1c1206' }}>{b.name}</span>
            </button>
          ) : i === plusAt ? (
            <button key={'plus' + i} type="button" onClick={() => onAdd(page.chapter)}
              className="group min-h-0 min-w-0 flex flex-col items-center justify-center gap-1.5">
              <span
                className="flex items-center justify-center w-[52%] aspect-square rounded-full border-2 border-dashed transition-all group-hover:scale-110 group-hover:bg-white/5"
                style={{ borderColor: 'color-mix(in srgb, var(--trim) 80%, transparent)', color: accent, background: 'var(--page-solid)' /* plain page inside the ring — no pattern, no shadow */ }}
              >
                <Plus className="w-[42%] h-[42%] transition-transform group-hover:rotate-90" strokeWidth={2.5} />
              </span>
              <span className="text-[clamp(8px,1.05vw,11px)] font-semibold uppercase tracking-wider opacity-80" style={{ color: accent }}>Add a badge</span>
            </button>
          ) : (
            // Blank page until a badge goes here (only the next "+" shows)
            <span key={'empty' + i} aria-hidden />
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

/** A paper dialog over the Studio (Escape or a click outside closes it) */
export function PaperDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <Portal>
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#2b2014]/45 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="haven-panel haven-grain relative w-full max-w-md !p-6 text-center shadow-[0_30px_60px_-20px_rgba(40,25,10,0.6)]">
        <Corners inset={8} size={34} />
        <span className="haven-medallion w-12 h-12 mx-auto"><RotateCcw size={20} /></span>
        <h2 className="pinbook-serif mt-3 mb-2 text-xl font-bold text-ink">{title}</h2>
        {children}
      </div>
    </div>
    </Portal>
  )
}
