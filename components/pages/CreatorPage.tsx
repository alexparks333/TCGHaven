'use client'

// /creator — the Creator Studio (docs/creators.md). For Creators (lib/accountRoles.ts) and staff.
//   • Your Book: name your Creator Book, design its cover (CoverDesigner — leather, foil, stamp, your
//     own picture), open it (BookPlanner) and tap "+" on an empty spot to make a badge (BadgeMaker,
//     with the Relief Studio for 3D). "Preview" shows it exactly as fans will see it.
//   • Community: the community profile — barebones for now.
// Everything saves as you go (lib/creatorBooks.ts → creator_books/{uid}, communities/{uid}).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { communityPath } from '@/lib/communities'
import { Loader2, Wand2, PauseCircle, BookOpen, Users, Eye, X, Check, Sparkles, ArrowLeft } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useAccountRole, canUseCreatorStudio } from '@/lib/accountRoles'
import { useCreatorBook, saveCreatorBook, newCreatorBook, newBadgeId, useCommunity, saveCommunity, monogramOf, LEATHERS, FOILS, type CreatorBook, type Community } from '@/lib/creatorBooks'
import { DEFAULT_TIERS, type BadgeDef, type BadgeSet } from '@/lib/badges'
import { CoverDesigner } from '@/components/creator/CoverDesigner'
import { CreateCommunity, CommunityCard, BANNERS } from '@/components/creator/CreateCommunity'
import { BookPlanner, chaptersFor } from '@/components/creator/BookPlanner'
import { BadgeMaker } from '@/components/creator/BadgeMaker'
import { BookCover, BookThickness } from '@/components/badges/BadgeLibrary'
import { BadgeBook } from '@/components/badges/BadgeBook'
import { useScrollLock } from '@/lib/useScrollLock'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
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
  const [tab, setTab] = useState<'book' | 'community'>('book')
  // The community comes first: until it's launched, the Studio is the "Create Community" set-up
  const { community, loaded: communityLoaded } = useCommunity(user?.uid)

  if (!loaded || !communityLoaded) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>

  if (!canUseCreatorStudio(record)) {
    return (
      <div className="card-glass max-w-lg mx-auto mt-10 p-6 text-center">
        <PauseCircle size={32} className="mx-auto text-slate-500 mb-3" />
        <h1 className="text-lg font-bold text-ink">{record.suspended ? 'Your Creator Studio is suspended' : record.formerCreator ? 'Your Creator Studio is paused' : 'Creator Studio'}</h1>
        <p className="text-sm text-slate-400 mt-2">
          {record.suspended || record.formerCreator
            ? 'Your Creator status is off for now, so your community and badges are hidden. Nothing has been deleted — it all comes back if your status is restored.'
            : 'The Creator Studio is for TCG Haven creators.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-violet-600/15 text-violet-700 flex items-center justify-center"><Wand2 size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">Creator Studio</h1>
          {record.role === 'creator' && (
            <p className="text-sm text-slate-500">
              Creator since {record.creatorSince ? new Date(record.creatorSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'today'} · Premium included
            </p>
          )}
        </div>
        {community && <div className="ml-auto flex rounded-xl bg-slate-900 border border-slate-800 p-1">
          {([['book', 'Your Book', BookOpen], ['community', 'Community', Users]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors', tab === id ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-ink')}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>}
      </div>
      {user && !community && <CreateCommunity uid={user.uid} creatorName={user.displayName || 'Creator'} onLaunched={() => setTab('book')} />}
      {user && community && (tab === 'book' ? <BookTab uid={user.uid} creatorName={user.displayName || 'Creator'} /> : <CommunityTab uid={user.uid} creatorName={user.displayName || 'Creator'} />)}
    </div>
  )
}

// ── Your Book ─────────────────────────────────────────────────────────────

function BookTab({ uid, creatorName }: { uid: string; creatorName: string }) {
  const { book: saved, loaded } = useCreatorBook(uid)
  const [draft, setDraft] = useState<CreatorBook | null>(null)
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [view, setView] = useState<'cover' | 'pages'>('cover')
  const [making, setMaking] = useState<{ badge: BadgeDef; isNew: boolean } | null>(null)
  const [preview, setPreview] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // The saved book arrives (and later changes elsewhere) — take it unless there are unsaved edits
  useEffect(() => { if (saved && state === 'saved' && !timer.current) setDraft(saved) }, [saved, state])

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

  if (!loaded) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
  // Made for good: the book is shown only once it's really saved (refreshing must find it again)
  if (!saved && !draft) return (
    <StartBook
      creatorName={creatorName}
      onCreate={async (name, cover) => { const b = newCreatorBook(uid, name, creatorName); b.book.cover = cover; await saveCreatorBook(uid, b, true); return b }}
      onOpened={(b) => { setDraft(b); setView('cover') }}
    />
  )
  const b = draft ?? saved!
  const setBook = (book: BadgeSet) => change({ ...b, book })

  const blankBadge = (chapter: string): BadgeDef => ({
    id: newBadgeId(uid, 'badge'), set: b.book.id, page: chapter, name: '', description: '', game: 'pokemon',
    slotNoun: 'cards', slots: [], art: 'crest', tiers: [...DEFAULT_TIERS] as [number, number],
  })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {view === 'pages' && (
          <button type="button" onClick={() => setView('cover')} className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink"><ArrowLeft size={15} />Cover</button>
        )}
        <h2 className="text-lg font-bold text-ink truncate">{b.book.name}</h2>
        <span className="text-xs text-slate-500">{b.badges.length} badge{b.badges.length === 1 ? '' : 's'}</span>
        <span className={cn('ml-auto text-xs flex items-center gap-1', state === 'error' ? 'text-red-600' : 'text-slate-500')}>
          {state === 'saving' ? <><Loader2 size={12} className="animate-spin" />Saving…</> : state === 'error' ? 'Not saved — check your connection (or the security rules aren’t published yet)' : <><Check size={12} className="text-emerald-600" />Saved</>}
        </span>
        <button type="button" onClick={() => setPreview(true)} className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink"><Eye size={15} />Preview</button>
      </div>

      {view === 'cover' ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
          <BookStage book={b.book} badges={b.badges} onOpen={() => setView('pages')} />
          <div className="card-glass p-5">
            <CoverDesigner uid={uid} book={b.book} onChange={setBook} />
          </div>
        </div>
      ) : (
        <BookPlanner
          book={b.book}
          badges={b.badges}
          onAdd={(chapter) => setMaking({ badge: blankBadge(chapter), isNew: true })}
          onEdit={(badge) => setMaking({ badge, isNew: false })}
          onRenameChapter={(from, to) => change({
            ...b,
            book: { ...b.book, chapters: chaptersFor(b.book, b.badges).map((c) => (c === from ? to : c)) },
            badges: b.badges.map((x) => (x.page === from ? { ...x, page: to } : x)),
          }, true)}
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
      {preview && <Preview book={b.book} badges={b.badges} onClose={() => setPreview(false)} />}
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
    game: 'pokemon', cover,
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

/** The closed book, big, tilting toward the pointer — tap to open it */
function BookStage({ book, badges, onOpen }: { book: BadgeSet; badges: BadgeDef[]; onOpen: () => void }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  return (
    <div className="flex flex-col items-center gap-5 py-4">
      <button
        type="button"
        onClick={onOpen}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -10, y: ((e.clientX - r.left) / r.width - 0.5) * 14 })
        }}
        onPointerLeave={() => setTilt({ x: 0, y: 0 })}
        className="relative w-[min(360px,78vw)] aspect-[0.71] [perspective:1100px] outline-none group"
        aria-label={`Open ${book.name}`}
      >
        <div
          className="absolute inset-0 transition-transform duration-200 ease-out"
          style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transformStyle: 'preserve-3d', containerType: 'inline-size' }}
        >
          <BookThickness />
          <span className="absolute inset-0"><BookCover set={book} badges={null} defs={badges} /></span>
          {/* A sheen that follows the tilt */}
          <span className="absolute inset-0 rounded-[14px] pointer-events-none mix-blend-overlay transition-opacity opacity-60"
            style={{ background: `linear-gradient(${110 + tilt.y * 4}deg, transparent 30%, rgba(255,255,255,0.35) 48%, transparent 62%)` }} />
        </div>
      </button>
      <button type="button" onClick={onOpen} className="btn-primary px-6 py-3 text-base shadow-lg">
        <BookOpen size={18} /> Open your book{badges.length ? '' : ' & add badges'}
      </button>
      <p className="text-xs text-slate-500 text-center max-w-sm">Change the cover on the right — every tap shows here. Open the book to add badges to its pages.</p>
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

// ── Community (barebones for now) ─────────────────────────────────────────

function CommunityTab({ uid, creatorName }: { uid: string; creatorName: string }) {
  const { community, loaded } = useCommunity(uid)
  const [draft, setDraft] = useState<Community | null>(null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  useEffect(() => { if (loaded && !draft) setDraft(community ?? { name: `${creatorName}'s Community`, tagline: '', about: '', color: BANNERS[0], games: [] }) }, [loaded, community, draft, creatorName])
  if (!draft) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
  const set = (p: Partial<Community>) => { setDraft({ ...draft, ...p }); setSaving('idle') }
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
      {/* How it looks */}
      <div>
        <CommunityCard c={draft} big />
        <p className="mt-3 text-xs text-slate-500 rounded-xl bg-slate-950/50 border border-slate-800 p-3">
          Collectors find your community under Friends → Communities and join it; your book shows on its page. Coming next: news posts.
        </p>
      </div>
      {/* Edit it */}
      <div className="card-glass p-5 space-y-4">
        <label className="block"><span className="field-label">Community name</span>
          <input className="input-field font-semibold" maxLength={40} value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="field-label">Tagline</span>
          <input className="input-field text-sm" maxLength={80} value={draft.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="One line about your community" /></label>
        <label className="block"><span className="field-label">About</span>
          <textarea className="input-field text-sm min-h-[100px]" maxLength={600} value={draft.about} onChange={(e) => set({ about: e.target.value })} /></label>
        <div><span className="field-label">Games</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(GAME_LABELS) as Game[]).map((g) => {
              const on = draft.games?.includes(g)
              return (
                <button key={g} type="button" onClick={() => set({ games: on ? draft.games!.filter((x) => x !== g) : [...(draft.games ?? []), g] })}
                  className={cn('rounded-full px-2.5 py-1 text-xs font-bold border transition-colors', on ? 'text-white border-transparent' : 'border-slate-800 text-slate-400 hover:text-ink')}
                  style={on ? { background: GAME_COLORS[g] } : undefined}>{GAME_LABELS[g]}</button>
              )
            })}
          </div>
        </div>
        <div><span className="field-label">Banner colour</span>
          <div className="flex flex-wrap gap-2">
            {BANNERS.map((c) => (
              <button key={c} type="button" onClick={() => set({ color: c })} className={cn('w-8 h-8 rounded-full transition-transform hover:scale-110', draft.color === c && 'ring-[3px] ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a]')} style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </div>
        <button type="button" disabled={saving === 'saving'} onClick={async () => { setSaving('saving'); try { await saveCommunity(uid, draft); setSaving('saved') } catch { setSaving('idle') } }} className="btn-primary w-full justify-center">
          {saving === 'saving' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{saving === 'saved' ? 'Saved' : 'Save community'}
        </button>
        {(community || saving === 'saved') && (
          <Link href={communityPath(uid)} className="btn-secondary w-full justify-center !bg-slate-950 border border-slate-700 !text-ink">
            <Eye size={15} />View your community page
          </Link>
        )}
      </div>
    </div>
  )
}
