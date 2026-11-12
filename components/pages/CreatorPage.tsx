'use client'

// /creator — the Creator Studio (docs/creators.md). For Creators (lib/accountRoles.ts) and staff.
// A leather header in the creator's own colours (StudioHero: stats, a what-to-do-next checklist)
// with three bookmark tabs into the parchment panel below:
//   • Pages & badges: the open book (BookPlanner) on a desk — tap "+" on an empty spot to make a
//     badge (BadgeMaker, with the Relief Studio for 3D); chapters and the inside look beside it.
//   • Cover: the closed book under a spotlight, the cover designer always open beside it — changes
//     show live; "Save cover" keeps them (a dot on the tab while they're unsaved).
//   • Community: the community page, edited right on it (CommunityStudio), saving itself.
// "Preview" shows the book exactly as fans will see it. Everything saves through lib/creatorBooks.ts
// (creator_books/{uid}, communities/{uid}).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, PauseCircle, BookOpen, Eye, X, Check, Sparkles, Palette, RotateCcw, ArrowRight } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useAccountRole, canUseCreatorStudio } from '@/lib/accountRoles'
import { useCreatorBook, saveCreatorBook, newCreatorBook, newBadgeId, useCommunity, monogramOf, LEATHERS, FOILS, type CreatorBook } from '@/lib/creatorBooks'
import { DEFAULT_TIERS, type BadgeDef, type BadgeSet } from '@/lib/badges'
import { CoverDesigner } from '@/components/creator/CoverDesigner'
import { CreateCommunity } from '@/components/creator/CreateCommunity'
import { CommunityStudio } from '@/components/creator/CommunityStudio'
import { StudioHero, type StudioTab } from '@/components/creator/StudioHero'
import { StudioEntrance } from '@/components/creator/StudioEntrance'
import { StudioBar } from '@/components/creator/StudioBar'
import { BookPlanner, chaptersFor } from '@/components/creator/BookPlanner'
import { BadgeMaker } from '@/components/creator/BadgeMaker'
import { BookCover, BookThickness } from '@/components/badges/BadgeLibrary'
import { BadgeBook } from '@/components/badges/BadgeBook'
import { useScrollLock } from '@/lib/useScrollLock'
import { useStickyCenter } from '@/lib/useStickyCenter'
import { Corners } from '@/components/creator/Ornaments'
import { cn } from '@/lib/utils'

export default function CreatorPage() {
  return (
    <AuthGuard>
      <Body />
    </AuthGuard>
  )
}

function Body() {
  const { user } = useAuth()
  const { record, loaded } = useAccountRole(user?.uid)
  // The community comes first: until it's launched, the Studio is the "Create Community" set-up
  const { community, loaded: communityLoaded } = useCommunity(user?.uid)
  const { book, loaded: bookLoaded } = useCreatorBook(user?.uid)
  const [picked, setPicked] = useState<StudioTab | null>(null)
  const [coverDirty, setCoverDirty] = useState(false)
  // The loading screen (StudioEntrance): shown on every visit until it has opened its doors
  const [entered, setEntered] = useState(false)
  const [opening, setOpening] = useState(false)
  const onOpen = useCallback(() => setOpening(true), [])
  const onDone = useCallback(() => setEntered(true), [])
  const ready = loaded && communityLoaded && bookLoaded
  // The Studio fills the screen (ClientWrapper drops the app's sidebar here); its bar has the way out
  const entrance = <>{!entered && <StudioEntrance ready={ready} onOpen={onOpen} onDone={onDone} />}<StudioBar unsaved={coverDirty} /></>

  if (!ready) return <>{entrance}</>

  if (!canUseCreatorStudio(record)) {
    return (
      <>{entrance}<div className="card-glass max-w-lg mx-auto mt-10 p-6 text-center">
        <PauseCircle size={32} className="mx-auto text-slate-500 mb-3" />
        <h1 className="text-lg font-bold text-ink">{record.suspended ? 'Your Creator Studio is suspended' : record.formerCreator ? 'Your Creator Studio is paused' : 'Creator Studio'}</h1>
        <p className="text-sm text-slate-400 mt-2">
          {record.suspended || record.formerCreator
            ? 'Your Creator status is off for now, so your community and badges are hidden. Nothing has been deleted — it all comes back if your status is restored.'
            : 'The Creator Studio is for TCG Haven creators.'}
        </p>
      </div></>
    )
  }
  if (!user) return null
  const creatorName = user.displayName || 'Creator'
  if (!community) return <>{entrance}<div className={cn(opening && 'studio-reveal')}><CreateCommunity uid={user.uid} creatorName={creatorName} onLaunched={() => setPicked('cover')} /></div></>

  // No book yet: the book tabs are where it's made
  const tab: StudioTab = picked ?? 'cover'
  const since = record.role === 'creator'
    ? (record.creatorSince ? new Date(record.creatorSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'today')
    : null

  return (
    <>{entrance}<div className={cn('pb-6', opening && 'studio-reveal')}>
      <StudioHero uid={user.uid} community={community} book={book} since={since} tab={tab} onTab={setPicked} dirtyTabs={coverDirty ? ['cover'] : []} />
      {/* The parchment panel the tabs open onto (both halves stay mounted, so nothing's lost switching) */}
      <div className="rounded-b-[22px] rounded-tr-[22px] bg-slate-950 border border-slate-800 p-4 md:p-6">
        <div hidden={tab === 'community'}>
          <BookTab uid={user.uid} creatorName={creatorName} saved={book} view={tab === 'cover' ? 'cover' : 'pages'} onView={setPicked} onCoverDirty={setCoverDirty} />
        </div>
        <div hidden={tab !== 'community'}>
          <CommunityStudio uid={user.uid} book={book} onEditBook={() => setPicked(book ? 'pages' : 'cover')} />
        </div>
      </div>
    </div></>
  )
}

// ── Your Book ─────────────────────────────────────────────────────────────

// The parts of the book the cover designer changes — a cover save writes only these, so chapters or
// the inside look changed meanwhile on the Pages tab aren't put back
const COVER_KEYS = ['name', 'collection', 'subtitle', 'monogram', 'cover', 'coverStyle', 'coverImage', 'coverFit'] as const
const coverPart = (b: BadgeSet) => JSON.stringify(COVER_KEYS.map((k) => b[k] ?? null))

function BookTab({ uid, creatorName, saved, view, onView, onCoverDirty }: {
  uid: string
  creatorName: string
  saved: CreatorBook | null
  view: 'cover' | 'pages'
  onView: (v: StudioTab) => void
  onCoverDirty: (dirty: boolean) => void
}) {
  const [draft, setDraft] = useState<CreatorBook | null>(null)
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [making, setMaking] = useState<{ badge: BadgeDef; isNew: boolean } | null>(null)
  const [preview, setPreview] = useState(false)
  // The cover being designed: unsaved until "Save cover" (null = no changes)
  const [coverDraft, setCoverDraft] = useState<BadgeSet | null>(null)
  const stick = useStickyCenter()
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // The saved book arrives (and later changes elsewhere) — take it unless there are unsaved edits
  useEffect(() => { if (saved && state === 'saved' && !timer.current) setDraft(saved) }, [saved, state])

  const b0 = draft ?? saved
  const coverDirty = !!coverDraft && !!b0 && coverPart(coverDraft) !== coverPart(b0.book)
  useEffect(() => { onCoverDirty(coverDirty) }, [coverDirty, onCoverDirty])
  // Don't lose an unsaved cover to a closed tab
  useEffect(() => {
    if (!coverDirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [coverDirty])

  // Saves a moment after the last change (typing a title doesn't save every letter)
  function change(next: CreatorBook, now = false) {
    setDraft(next)
    setState('saving')
    clearTimeout(timer.current)
    const run = () => {
      timer.current = undefined
      saveCreatorBook(uid, next).then(() => setState('saved')).catch(() => setState('error'))
    }
    if (now) run()
    else timer.current = setTimeout(run, 700)
  }

  // Made for good: the book is shown only once it's really saved (refreshing must find it again)
  if (!b0) return (
    <StartBook
      creatorName={creatorName}
      onCreate={async (name, cover) => { const b = newCreatorBook(uid, name, creatorName); b.book.cover = cover; await saveCreatorBook(uid, b, true); return b }}
      onOpened={(b) => { setDraft(b); onView('cover') }}
    />
  )
  const b = b0
  const setBook = (book: BadgeSet) => change({ ...b, book })
  const designing = coverDraft ?? { ...b.book, coverStyle: b.book.coverStyle ?? {} }

  const blankBadge = (chapter: string): BadgeDef => ({
    id: newBadgeId(uid, 'badge'), set: b.book.id, page: chapter, name: '', description: '', game: 'pokemon',
    slotNoun: 'cards', slots: [], art: 'crest', tiers: [...DEFAULT_TIERS] as [number, number],
  })

  return (
    <div>
      {/* The book's bar: its name, saving, and the fan's-eye preview */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-5">
        <span className="haven-medallion w-9 h-9 shrink-0">
          {view === 'cover' ? <Palette size={16} /> : <BookOpen size={16} />}
        </span>
        <div className="min-w-0">
          <h2 className="pinbook-serif text-xl font-bold text-ink truncate leading-tight">{view === 'cover' ? 'Design your cover' : b.book.name}</h2>
          <p className="text-xs text-slate-500">
            {view === 'cover' ? 'Every change shows on the book as you go' : `${b.badges.length} badge${b.badges.length === 1 ? '' : 's'} · ${chaptersFor(b.book, b.badges).length} chapter${chaptersFor(b.book, b.badges).length === 1 ? '' : 's'} · tap a “+” to make a badge`}
          </p>
        </div>
        <span className={cn('ml-auto text-xs flex items-center gap-1', state === 'error' ? 'text-red-600' : 'text-slate-500')}>
          {state === 'saving' ? <><Loader2 size={12} className="animate-spin" />Saving…</> : state === 'error' ? 'Not saved — check your connection (or the security rules aren’t published yet)' : <><Check size={12} className="text-emerald-600" />Saved</>}
        </span>
        <button type="button" onClick={() => setPreview(true)} className="btn-secondary !bg-slate-900 border border-slate-700 !text-ink"><Eye size={15} />Preview as a fan</button>
      </div>

      {view === 'cover' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
          {/* The book under a spotlight, pinned mid-window while the designer scrolls */}
          <div ref={stick.ref} className="lg:sticky self-start" style={{ top: stick.top }}>
            <CoverStage book={designing} badges={b.badges} dirty={coverDirty} onOpen={() => onView('pages')} />
          </div>
          <div className="haven-panel !p-4 md:!p-5">
            <CoverDesigner uid={uid} book={designing} onChange={setCoverDraft} initialOpen="cover" />
            {/* Unsaved changes: keep them or put the saved cover back */}
            <div className={cn('haven-label sticky bottom-3 mt-5 !py-2 !pr-2', coverDirty && 'shadow-[0_10px_20px_-12px_rgba(60,35,15,0.5)]')}>
              <span className="text-xs font-semibold flex-1 flex items-center gap-1.5 text-slate-500">
                {coverDirty ? <><span className="w-1.5 h-1.5 rounded-full bg-[#a8452a]" /><span className="text-ink">Unsaved cover changes</span></> : <><Check size={13} className="text-emerald-600" />Cover saved</>}
              </span>
              {coverDirty && (
                <>
                  <button type="button" onClick={() => setCoverDraft(null)} className="haven-chip px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1"><RotateCcw size={13} />Undo all</button>
                  {!designing.coverImage ? (
                    <span className="text-[11px] font-semibold text-[#a8452a] px-1">Add a cover picture to save</span>
                  ) : <button type="button" onClick={() => {
                    const keep: Partial<BadgeSet> = {}
                    for (const k of COVER_KEYS) (keep as Record<string, unknown>)[k] = designing[k]
                    setBook({ ...b.book, ...keep }); setCoverDraft(null)
                  }} className="btn-primary !py-1.5">
                    <Check size={15} />Save cover
                  </button>}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <BookPlanner
          uid={uid}
          book={b.book}
          badges={b.badges}
          onAdd={(chapter) => setMaking({ badge: blankBadge(chapter), isNew: true })}
          onEdit={(badge) => setMaking({ badge, isNew: false })}
          onRenameChapter={(from, to) => change({
            ...b,
            book: { ...b.book, chapters: chaptersFor(b.book, b.badges).map((c) => (c === from ? to : c)) },
            badges: b.badges.map((x) => (x.page === from ? { ...x, page: to } : x)),
          }, true)}
          onChapters={(next) => change({ ...b, book: { ...b.book, chapters: next } }, true)}
          onInside={(insideStyle) => change({ ...b, book: { ...b.book, insideStyle } })}
          onAddChapter={() => {
            const list = chaptersFor(b.book, b.badges)
            let n = list.length + 1, name = `Chapter ${n}`
            while (list.includes(name)) name = `Chapter ${++n}`
            change({ ...b, book: { ...b.book, chapters: [...list, name] } }, true)
          }}
        />
      )}

      {making && (
        <BadgeMaker
          uid={uid}
          book={b.book}
          badge={making.badge}
          onClose={() => setMaking(null)}
          onSave={async (badge) => {
            const exists = b.badges.some((x) => x.id === badge.id)
            const next = { ...b, badges: exists ? b.badges.map((x) => (x.id === badge.id ? badge : x)) : [...b.badges, badge] }
            setDraft(next)
            clearTimeout(timer.current); timer.current = undefined
            setState('saving')
            await saveCreatorBook(uid, next)
            setState('saved')
          }}
          onDelete={making.isNew ? undefined : async () => {
            const next = { ...b, badges: b.badges.filter((x) => x.id !== making.badge.id) }
            setDraft(next)
            await saveCreatorBook(uid, next)
          }}
        />
      )}
      {preview && <Preview book={coverDraft ? { ...b.book, ...designing } : b.book} badges={b.badges} onClose={() => setPreview(false)} />}
    </div>
  )
}

/** No book yet — step one is just naming it: a book that reacts to you (it tilts toward the pointer
 *  on a spotlight in its leather), its title writing itself on the cover as you type. Create: a gold
 *  foil sweep stamps it, then the cover swings open onto its first velvet page and the Studio opens
 *  on the cover designer (colours, picture — the next step). */
function StartBook({ creatorName, onCreate, onOpened }: {
  creatorName: string
  onCreate: (name: string, cover: BadgeSet['cover']) => Promise<CreatorBook>
  onOpened: (book: CreatorBook) => void
}) {
  const [name, setName] = useState('')
  // The cover's colours are picked on the next page (the cover designer); it starts in crimson and gold
  const leather = 0, foil = 0
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [phase, setPhase] = useState<'idle' | 'stamping' | 'opening'>('idle')
  const [error, setError] = useState('')
  const l = LEATHERS[leather], f = FOILS[foil]
  const cover = { from: l.from, to: l.to, accent: f.color }
  const title = name.trim()
  const sample: BadgeSet = {
    id: 'sample', name: title || 'Your Book', subtitle: `${creatorName} · Creator Book`, monogram: monogramOf(title || '★'),
    game: 'pokemon', cover, coverStyle: {},
  }
  const first = creatorName.split(' ')[0] || 'My'
  const ideas = [`${first}'s Vault`, `${first}'s Legends`, 'The Collection', 'Pin Masters', 'Holo Hunters']

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!title || phase !== 'idle') return
    setError(''); setPhase('stamping')
    try {
      const [book] = await Promise.all([onCreate(title, cover), new Promise((r) => setTimeout(r, 900))])
      setPhase('opening')
      setTimeout(() => onOpened(book), 1100)
    } catch (err) {
      setPhase('idle')
      const code = (err as { code?: string })?.code
      setError(code === 'permission-denied'
        ? 'Couldn’t create your book — creator saving isn’t switched on for this account.'
        : 'Couldn’t create your book — ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className="card-glass overflow-hidden grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] max-w-5xl mx-auto">
      {/* The stage: a spotlight in the book's leather, gold sparks drifting up, the book tilting to you */}
      <div
        className="relative min-h-[420px] md:min-h-[520px] flex items-center justify-center overflow-hidden"
        style={{ background: `radial-gradient(ellipse at 50% 45%, ${l.from}55 0%, ${l.to}cc 45%, #0d0a08 100%)`, transition: 'background 0.6s' }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -14, y: ((e.clientX - r.left) / r.width - 0.5) * 22 })
        }}
        onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      >
        {Array.from({ length: 16 }, (_, i) => (
          <span key={i} className="creator-spark absolute rounded-full pointer-events-none"
            style={{ left: `${(i * 37) % 100}%`, bottom: '-8px', width: 3 + (i % 3), height: 3 + (i % 3), background: f.color, animationDelay: `${(i * 0.53) % 6}s`, animationDuration: `${5 + (i % 5)}s` }} />
        ))}
        {/* Its shadow on the floor */}
        <div className="absolute bottom-[12%] w-[52%] h-6 rounded-[50%] bg-black/50 blur-xl" />
        <div className="relative w-[min(260px,62vw)] aspect-[0.71] [perspective:1200px]" style={{ containerType: 'inline-size' }}>
          <div
            className={cn('absolute inset-0', phase === 'idle' && 'creator-bob')}
            style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transformStyle: 'preserve-3d', transition: 'transform 0.25s ease-out' }}
          >
            <BookThickness />
            {/* The first page, under the cover — what the cover swings open onto */}
            <div className="absolute inset-0 rounded-[12px] overflow-hidden flex flex-col items-center justify-center text-center p-[12%]"
              style={{ background: 'radial-gradient(ellipse at 50% 40%, #2c2240 0%, #1a1427 60%, #0f0b18 100%)' }}>
              <div className="absolute inset-[6%] rounded-md border" style={{ borderColor: f.color + 'aa' }} />
              <p className="pinbook-serif text-[9cqw] uppercase tracking-[0.18em]" style={{ color: f.color }}>Chapter One</p>
              <span className="mt-[8%] w-[34%] aspect-square rounded-full border-2 border-dashed flex items-center justify-center text-[14cqw]" style={{ borderColor: f.color, color: f.color }}>+</span>
            </div>
            {/* The cover, hinged at the spine */}
            <div className="absolute inset-0 origin-left"
              style={{ transform: phase === 'opening' ? 'rotateY(-158deg)' : 'rotateY(0deg)', transition: 'transform 1s cubic-bezier(.5,.05,.25,1)', transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}>
              <BookCover set={sample} badges={null} defs={[]} emptyLabel="First edition" />
              {/* The moving shine */}
              <span className="absolute inset-0 rounded-[14px] pointer-events-none mix-blend-overlay"
                style={{ background: `linear-gradient(${105 + tilt.y * 5}deg, transparent 32%, rgba(255,255,255,0.45) 48%, transparent 64%)` }} />
              {/* The gold foil stamp sweeping across as it's made */}
              {phase !== 'idle' && <span className="creator-foil absolute inset-0 rounded-[14px] pointer-events-none" style={{ ['--foil' as string]: f.color }} />}
            </div>
          </div>
        </div>
        <p className="absolute bottom-4 inset-x-0 text-center text-[11px] text-white/50">Move your mouse over it</p>
      </div>

      {/* Name it, dress it, make it */}
      <form onSubmit={create} className="p-6 md:p-9 flex flex-col">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700 flex items-center gap-1.5"><Sparkles size={13} />Your Creator Book</p>
        <h2 className="text-2xl md:text-[28px] font-bold text-ink mt-2 leading-tight">Make a pin book for your community</h2>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">Your art, your cards to collect. Followers fill your book by collecting — and every badge they earn shows up in their own pin book.</p>

        <label className="mt-6 block">
          <span className="field-label flex justify-between"><span>Name it</span><span className="font-normal tabular-nums">{name.length}/40</span></span>
          <input className="input-field text-lg font-bold" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PewDiePie Cuties" disabled={phase !== 'idle'} />
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ideas.map((idea) => (
            <button key={idea} type="button" onClick={() => setName(idea)} disabled={phase !== 'idle'}
              className="rounded-full border border-slate-800 bg-slate-950/50 px-2.5 py-1 text-xs text-slate-400 hover:text-ink hover:border-slate-700 transition-colors">
              {idea}
            </button>
          ))}
        </div>

        <button type="submit" disabled={!title || phase !== 'idle'}
          className="mt-7 w-full rounded-2xl py-3.5 text-base font-bold text-white flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.99]"
          style={{ background: `linear-gradient(135deg, ${l.from}, ${l.to})`, boxShadow: `0 10px 24px -10px ${l.from}` }}>
          {phase === 'idle' ? <><BookOpen size={18} />Create my book</> : phase === 'stamping' ? <><Loader2 size={18} className="animate-spin" />Stamping the cover…</> : <><Sparkles size={18} />Opening it up…</>}
        </button>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        {/* What comes next */}
        <div className="mt-7 grid grid-cols-3 gap-2 text-center">
          {[['1', 'Design the cover'], ['2', 'Add badges to its pages'], ['3', 'Fans collect them']].map(([n, t]) => (
            <div key={n} className="rounded-xl border border-slate-800 bg-slate-950/40 px-2 py-3">
              <span className="mx-auto w-6 h-6 rounded-full flex items-center justify-center text-xs font-black text-black" style={{ background: f.color }}>{n}</span>
              <p className="text-[11px] font-semibold text-slate-400 mt-1.5 leading-tight">{t}</p>
            </div>
          ))}
        </div>
      </form>
    </div>
  )
}

/** The closed book under a spotlight in its own leather, tilting toward the pointer — tap to open it */
function CoverStage({ book, badges, onOpen, dirty }: { book: BadgeSet; badges: BadgeDef[]; onOpen: () => void; dirty: boolean }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  return (
    <div
      className="haven-panel haven-grain relative overflow-hidden min-h-[520px] md:min-h-[600px] flex flex-col items-center justify-center gap-7 !py-10"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -12, y: ((e.clientX - r.left) / r.width - 0.5) * 18 })
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div className="absolute inset-[6px] rounded-[10px] border border-[#d6c49f] pointer-events-none" />
      <Corners inset={12} size={44} />
      {/* No picture yet: the book is plain tan until one's added */}
      {!book.coverImage && <span className="haven-plate absolute top-4 right-4 !py-1 text-[11px] font-semibold text-[#a8452a] inline-flex items-center gap-1.5"><ImagePlus size={13} />Add your cover picture →</span>}
      {dirty && <span className="haven-plate absolute top-4 left-4 !py-1 text-[11px] font-semibold text-slate-500 inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#a8452a]" />Preview — not saved yet</span>}
      <div className="absolute bottom-[16%] w-[40%] max-w-[260px] h-5 rounded-[50%] bg-[#5a3c1e]/30 blur-lg" />
      <button type="button" onClick={onOpen} className="relative w-[min(340px,70vw)] aspect-[0.71] [perspective:1100px] outline-none" aria-label={`Open ${book.name}`}>
        <div className="absolute inset-0 transition-transform duration-200 ease-out"
          style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transformStyle: 'preserve-3d', containerType: 'inline-size' }}>
          <BookThickness pageColor={book.coverStyle?.pageColor} />
          <span className="absolute inset-0"><BookCover set={book} badges={null} defs={badges} /></span>
          <span className="absolute inset-0 rounded-[14px] pointer-events-none mix-blend-overlay opacity-60"
            style={{ background: `linear-gradient(${110 + tilt.y * 4}deg, transparent 30%, rgba(255,255,255,0.4) 48%, transparent 62%)` }} />
        </div>
      </button>
      <button type="button" onClick={onOpen} className="btn-primary relative">
        <BookOpen size={16} />Open it{badges.length ? '' : ' & add badges'}<ArrowRight size={15} />
      </button>
    </div>
  )
}

/** The book exactly as followers will see it (the real pin book) */
function Preview({ book, badges, onClose }: { book: BadgeSet; badges: BadgeDef[]; onClose: () => void }) {
  useScrollLock(true)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-5 py-3 text-white">
        <Eye size={18} />
        <div className="min-w-0">
          <p className="font-bold truncate">{book.name}</p>
          <p className="text-xs text-white/60">How your followers will see it (their progress fills it in)</p>
        </div>
        <button type="button" onClick={onClose} className="ml-auto p-2 rounded-full bg-white/10 hover:bg-white/20" aria-label="Close the preview"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-6 flex items-start justify-center">
        <div className="w-full max-w-[1100px]">
          <BadgeBook set={book} defs={badges} badges={null} isMe={false} />
        </div>
      </div>
    </div>
  )
}
