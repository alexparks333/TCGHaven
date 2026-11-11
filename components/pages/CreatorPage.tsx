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
import { useCreatorBook, saveCreatorBook, newCreatorBook, newBadgeId, useCommunity, saveCommunity, LEATHERS, type CreatorBook, type Community } from '@/lib/creatorBooks'
import { DEFAULT_TIERS, type BadgeDef, type BadgeSet } from '@/lib/badges'
import { CoverDesigner } from '@/components/creator/CoverDesigner'
import { BookPlanner, chaptersFor } from '@/components/creator/BookPlanner'
import { BadgeMaker } from '@/components/creator/BadgeMaker'
import { BookCover, BookThickness } from '@/components/badges/BadgeLibrary'
import { BadgeBook } from '@/components/badges/BadgeBook'
import { useScrollLock } from '@/lib/useScrollLock'
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

  if (!loaded) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>

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
          <p className="text-sm text-slate-500">
            {record.role === 'creator'
              ? `Creator since ${record.creatorSince ? new Date(record.creatorSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'today'} · Premium included`
              : 'Staff access — your book works exactly like a creator’s'}
          </p>
        </div>
        <div className="ml-auto flex rounded-xl bg-slate-900 border border-slate-800 p-1">
          {([['book', 'Your Book', BookOpen], ['community', 'Community', Users]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors', tab === id ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-ink')}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>
      </div>
      {user && (tab === 'book' ? <BookTab uid={user.uid} creatorName={user.displayName || 'Creator'} /> : <CommunityTab uid={user.uid} creatorName={user.displayName || 'Creator'} />)}
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
  if (!saved && !draft) return <StartBook onCreate={async (name) => { const b = newCreatorBook(uid, name, creatorName); await saveCreatorBook(uid, b, true); setDraft(b) }} />
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

/** No book yet: name it and it's made — a closed leather book waiting on the left */
function StartBook({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const leather = LEATHERS[0]
  const sample: BadgeSet = {
    id: 'sample', name: name.trim() || 'Your Book', subtitle: 'Creator Book', monogram: (name.trim()[0] || '★').toUpperCase(),
    game: 'pokemon', cover: { from: leather.from, to: leather.to, accent: '#e8b35a' },
  }
  return (
    <div className="card-glass p-6 md:p-10 grid gap-8 md:grid-cols-[260px_1fr] items-center max-w-4xl mx-auto">
      <div className="relative mx-auto w-[220px] aspect-[0.71] [perspective:900px]" style={{ containerType: 'inline-size' }}>
        <div className="absolute inset-0 animate-[creatorFloat_5s_ease-in-out_infinite]" style={{ transformStyle: 'preserve-3d' }}>
          <BookThickness />
          <span className="absolute inset-0"><BookCover set={sample} badges={null} defs={[]} /></span>
        </div>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700 flex items-center gap-1.5"><Sparkles size={13} />Your Creator Book</p>
        <h2 className="text-2xl md:text-3xl font-bold text-ink mt-2">Make a pin book for your community</h2>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Design your own Haven Badges — your art, your cards to collect. Your followers fill your book by collecting,
          and every badge they earn shows up in their pin book next to TCG Haven’s.
        </p>
        <form className="mt-5 flex flex-col sm:flex-row gap-2" onSubmit={async (e) => {
          e.preventDefault(); if (!name.trim()) return
          setBusy(true); setError('')
          try { await onCreate(name) } catch (err) {
            const code = (err as { code?: string })?.code
            setError(code === 'permission-denied'
              ? 'Couldn’t create your book — creator saving isn’t switched on yet (the new security rules need publishing).'
              : 'Couldn’t create your book — ' + (err instanceof Error ? err.message : String(err)))
          } finally { setBusy(false) }
        }}>
          <input className="input-field text-base font-semibold" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name your book — e.g. PewDiePie Cuties" />
          <button type="submit" disabled={!name.trim() || busy} className="btn-primary justify-center whitespace-nowrap px-5 disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />}Create my book
          </button>
        </form>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>
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

const BANNERS = ['#6d28d9', '#b91c1c', '#0f766e', '#1d4ed8', '#c2410c', '#be185d', '#3f6212', '#334155']

function CommunityTab({ uid, creatorName }: { uid: string; creatorName: string }) {
  const { community, loaded } = useCommunity(uid)
  const [draft, setDraft] = useState<Community | null>(null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  useEffect(() => { if (loaded && !draft) setDraft(community ?? { name: `${creatorName}'s Community`, tagline: '', about: '', color: BANNERS[0] }) }, [loaded, community, draft, creatorName])
  if (!draft) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
  const set = (p: Partial<Community>) => { setDraft({ ...draft, ...p }); setSaving('idle') }
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
      {/* How it looks */}
      <div className="card-glass overflow-hidden">
        <div className="h-36 md:h-44 relative" style={{ background: `linear-gradient(135deg, ${draft.color}, #0b0b12)` }}>
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.35) 0, transparent 40%)' }} />
        </div>
        <div className="px-6 pb-6 -mt-10 relative">
          <div className="w-20 h-20 rounded-2xl border-4 border-[#f3e9d3] shadow-lg flex items-center justify-center text-3xl font-black text-white" style={{ background: draft.color }}>
            {(draft.name.trim()[0] || '★').toUpperCase()}
          </div>
          <h2 className="mt-3 text-2xl font-bold text-ink">{draft.name || 'Your community'}</h2>
          {draft.tagline && <p className="text-sm text-slate-500 mt-0.5">{draft.tagline}</p>}
          {draft.about && <p className="text-sm text-slate-400 mt-3 whitespace-pre-line">{draft.about}</p>}
          <p className="mt-4 text-xs text-slate-500 rounded-xl bg-slate-950/50 border border-slate-800 p-3">
            Collectors find your community under Friends → Communities and join it; your book shows on its page. Coming next: news posts.
          </p>
        </div>
      </div>
      {/* Edit it */}
      <div className="card-glass p-5 space-y-4">
        <label className="block"><span className="field-label">Community name</span>
          <input className="input-field font-semibold" maxLength={40} value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="field-label">Tagline</span>
          <input className="input-field text-sm" maxLength={80} value={draft.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="One line about your community" /></label>
        <label className="block"><span className="field-label">About</span>
          <textarea className="input-field text-sm min-h-[100px]" maxLength={600} value={draft.about} onChange={(e) => set({ about: e.target.value })} /></label>
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
