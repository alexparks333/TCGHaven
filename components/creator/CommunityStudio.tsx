'use client'

// The Creator Studio's Community tab (docs/creators.md): the community page itself, edited right on
// it — click the name, tagline or bio and type, tap a colour on the banner, tap games on and off.
// It saves itself a moment after each change (communities/{uid}). Beside it: members, the page's
// link, the book fans collect there, and what's coming.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Loader2, MousePointerClick, Pencil, Users, Megaphone, CalendarDays, BookOpen } from 'lucide-react'
import { useCommunity, saveCommunity, type Community, type CreatorBook } from '@/lib/creatorBooks'
import { communityPath, memberCount } from '@/lib/communities'
import { BANNERS } from '@/components/creator/CreateCommunity'
import { BookCover } from '@/components/badges/BadgeLibrary'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
import { cn } from '@/lib/utils'

const GAMES = Object.keys(GAME_LABELS) as Game[]
// Click-to-edit text: looks like the page until you hover or type in it
const inline = 'w-full bg-transparent rounded-xl px-2 -mx-2 outline-none transition-colors hover:bg-slate-900 focus:bg-slate-900 focus:ring-2 focus:ring-violet-600/40 placeholder:text-slate-600'

export function CommunityStudio({ uid, book, onEditBook }: { uid: string; book: CreatorBook | null; onEditBook: () => void }) {
  const { community, loaded } = useCommunity(uid)
  const [draft, setDraft] = useState<Community | null>(null)
  const [state, setState] = useState<'saved' | 'saving' | 'error' | 'name'>('saved')
  const [members, setMembers] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const pending = useRef<() => void>()
  useEffect(() => { if (loaded && community && !draft) setDraft(community) }, [loaded, community, draft])
  useEffect(() => { memberCount(uid).then(setMembers).catch(() => {}) }, [uid])
  // Leaving the Studio mid-wait still saves the last change
  useEffect(() => () => { clearTimeout(timer.current); pending.current?.() }, [])

  if (!draft) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>

  // Saves a moment after the last change; a name needs 2 letters first
  function set(p: Partial<Community>) {
    const next = { ...draft!, ...p }
    setDraft(next)
    clearTimeout(timer.current)
    if (next.name.trim().length < 2) { setState('name'); return }
    setState('saving')
    pending.current = () => {
      pending.current = undefined
      saveCommunity(uid, { ...next, name: next.name.trim(), tagline: next.tagline.trim(), about: next.about.trim() })
        .then(() => setState('saved')).catch(() => setState('error'))
    }
    timer.current = setTimeout(() => pending.current?.(), 800)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.origin + communityPath(uid))
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    } catch { /* the link is still shown on the page */ }
  }

  const c = draft
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px] items-start">
      {/* ── The page, editable in place ── */}
      <div className="card-glass overflow-hidden !bg-slate-900">
        <div className="relative h-40 md:h-52" style={{ background: `linear-gradient(135deg, ${c.color}, #0b0b12)`, transition: 'background 0.5s' }}>
          <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 18% 30%, rgba(255,255,255,0.35) 0, transparent 38%), radial-gradient(circle at 85% 75%, rgba(255,255,255,0.18) 0, transparent 34%)' }} />
          <span className="absolute left-4 top-4 rounded-full bg-black/35 backdrop-blur px-3 py-1 text-[11px] font-bold text-white/90 inline-flex items-center gap-1.5">
            <MousePointerClick size={13} />Click anything to edit · it saves itself
          </span>
          {/* The banner's colour, picked right on it */}
          <div className="absolute right-3 bottom-3 flex flex-wrap justify-end gap-1.5 rounded-2xl bg-black/35 backdrop-blur p-1.5 max-w-[70%]">
            {BANNERS.map((col) => (
              <button key={col} type="button" onClick={() => set({ color: col })} aria-label={`Banner colour ${col}`}
                className={cn('w-6 h-6 rounded-full border-2 transition-transform hover:scale-125', c.color === col ? 'border-white scale-110' : 'border-white/20')}
                style={{ background: col }} />
            ))}
          </div>
        </div>

        <div className="px-5 md:px-8 pb-7 -mt-11 relative">
          <div className="w-[84px] h-[84px] rounded-[24px] border-4 border-slate-900 shadow-lg flex items-center justify-center text-4xl font-black text-white rotate-[-3deg]"
            style={{ background: `linear-gradient(145deg, ${c.color}, color-mix(in srgb, ${c.color} 45%, black))`, transition: 'background 0.5s' }}>
            {(c.name.trim()[0] || '★').toUpperCase()}
          </div>

          <input value={c.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Your community’s name" aria-label="Community name"
            className={cn(inline, 'mt-4 py-1 text-[26px] md:text-[32px] font-bold text-ink leading-tight')} />
          {state === 'name' && <p className="text-xs text-red-600 mt-0.5">Give it a name of at least 2 letters to save.</p>}
          <input value={c.tagline} maxLength={80} onChange={(e) => set({ tagline: e.target.value })} placeholder="Add a one-line tagline…" aria-label="Tagline"
            className={cn(inline, 'py-1 text-base text-slate-400')} />

          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Users size={14} /><b className="text-ink">{members ?? '–'}</b> {members === 1 ? 'member' : 'members'}</div>

          {/* What it collects */}
          <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">What you collect <span className="normal-case tracking-normal font-normal">· tap to switch on or off</span></p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GAMES.map((g) => {
              const on = c.games?.includes(g)
              return (
                <button key={g} type="button" onClick={() => set({ games: on ? c.games!.filter((x) => x !== g) : [...(c.games ?? []), g] })}
                  className={cn('rounded-full px-3 py-1 text-xs font-bold border transition-all', on ? 'text-white border-transparent shadow-sm' : 'border-dashed border-slate-700 text-slate-500 hover:text-ink hover:border-slate-600')}
                  style={on ? { background: GAME_COLORS[g] } : undefined}>
                  {on && <Check size={11} className="inline -mt-0.5 mr-1" strokeWidth={3} />}{GAME_LABELS[g]}
                </button>
              )
            })}
          </div>

          {/* About */}
          <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 flex justify-between">
            <span>About</span><span className="font-normal tabular-nums normal-case tracking-normal">{c.about.length}/600</span>
          </p>
          <textarea value={c.about} maxLength={600} onChange={(e) => set({ about: e.target.value })} aria-label="About your community"
            placeholder="Who you are, what you collect, what members get… (fans read this on your page)"
            className={cn(inline, 'mt-1 py-2 min-h-[140px] text-sm leading-relaxed text-slate-300 resize-y')} />
        </div>
      </div>

      {/* ── Beside it ── */}
      <div className="space-y-4 lg:sticky lg:top-4">
        <div className="card-glass p-4">
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-semibold flex items-center gap-1.5', state === 'error' ? 'text-red-600' : 'text-slate-500')}>
              {state === 'saving' ? <><Loader2 size={13} className="animate-spin" />Saving…</>
                : state === 'error' ? 'Not saved — check your connection'
                : state === 'name' ? <><Pencil size={13} />Waiting for a name</>
                : <><Check size={13} className="text-emerald-600" />All changes saved</>}
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <Link href={communityPath(uid)} className="btn-primary flex-1 justify-center"><ExternalLink size={15} />View page</Link>
            <button type="button" onClick={copyLink} className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink">
              {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className="mt-2.5 text-[11px] text-slate-500">Collectors find it under Friends → Communities and join it there.</p>
        </div>

        {/* The book fans collect on the page */}
        <div className="card-glass p-4 flex items-center gap-4">
          {book ? (
            <>
              <div className="relative w-20 aspect-[0.71] shrink-0 rotate-[-4deg] drop-shadow-[0_8px_10px_rgba(40,20,5,0.4)]" style={{ containerType: 'inline-size' }}>
                <span className="absolute inset-0"><BookCover set={book.book} badges={null} defs={book.badges} /></span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">On your page</p>
                <p className="font-bold text-ink truncate">{book.book.name}</p>
                <p className="text-xs text-slate-500">{book.badges.length} badge{book.badges.length === 1 ? '' : 's'} to collect</p>
                <button type="button" onClick={onEditBook} className="mt-1.5 text-xs font-bold text-violet-700 hover:underline inline-flex items-center gap-1"><BookOpen size={12} />Edit the book</button>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">
              <p className="font-bold text-ink">No book yet</p>
              <p className="text-xs mt-0.5">Make your Creator Book and it shows here for fans to collect.</p>
              <button type="button" onClick={onEditBook} className="mt-2 btn-primary"><BookOpen size={14} />Make my book</button>
            </div>
          )}
        </div>

        {/* What's coming */}
        <div className="rounded-2xl border-2 border-dashed border-slate-800 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Coming soon</p>
          <div className="mt-2.5 space-y-2.5">
            {([[Megaphone, 'News posts', 'Tell members about new badges and drops'], [CalendarDays, 'Events', 'Limited-time badges and collecting challenges']] as const).map(([Icon, t, d]) => (
              <div key={t} className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-xl bg-slate-800 text-slate-500 flex items-center justify-center shrink-0"><Icon size={15} /></span>
                <div><p className="text-sm font-semibold text-ink">{t}</p><p className="text-[11px] text-slate-500">{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
