'use client'

// The Creator Studio's Community tab (docs/creators.md): the real community page (CommunityPage's
// CommunityView) in editing mode — type the name, tagline and About in place, add and place a header
// picture, pick a colour, tap games on and off, show or hide each section. It saves itself a moment
// after each change (communities/{uid}). Beside it: the page's link, the book, Page sections, what's coming.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Loader2, MousePointerClick, Pencil, Megaphone, CalendarDays, BookOpen, ImagePlus, X } from 'lucide-react'
import { useCommunity, saveCommunity, COMMUNITY_SECTIONS, HEADER_ASPECT, type Community, type CommunityLook, type CreatorBook } from '@/lib/creatorBooks'
import { CommunityView } from '@/components/pages/CommunityPage'
import { isLive } from '@/lib/badges'
import { PicturePlacer, ValueSlider, shrink } from '@/components/creator/CoverDesigner'
import { Portal } from '@/components/creator/Portal'
import { appStorage } from '@/lib/firebase/appStorage'
import { badgeArt } from '@/lib/badgeAssets'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { communityPath, memberCount } from '@/lib/communities'
import { BookCover } from '@/components/badges/BadgeLibrary'
import { cn } from '@/lib/utils'


export function CommunityStudio({ uid, book, onEditBook }: { uid: string; book: CreatorBook | null; onEditBook: () => void }) {
  const { community, loaded } = useCommunity(uid)
  const [draft, setDraft] = useState<Community | null>(null)
  const [state, setState] = useState<'saved' | 'saving' | 'error' | 'name'>('saved')
  const [members, setMembers] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [headerOpen, setHeaderOpen] = useState(false)
  const [viewing, setViewing] = useState(false) // the book opened from the page
  // Fans see only the published badges
  const liveBook = book && { ...book, badges: book.badges.filter(isLive) }
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
      {/* ── The page itself, exactly as fans see it — editable in place (CommunityPage's CommunityView) ── */}
      <div className="min-w-0">
        <p className="mb-3 text-xs text-slate-500 flex items-center gap-1.5">
          <MousePointerClick size={13} />Your community page, as fans see it — click the text to type, add a header picture, show or hide each section · it saves itself
        </p>
        {state === 'name' && <p className="mb-2 text-xs text-red-600">Give it a name of at least 2 letters to save.</p>}
        <CommunityView uid={uid} community={{ uid, ...c }} creator={null} members={members} mine studio="computer"
          isMember={false} busy={false} error="" toggle={() => {}} book={liveBook} open={viewing} setOpen={setViewing}
          edit={{ set, onHeader: () => setHeaderOpen(true), onEditBook }} />
      </div>

      {/* ── Beside it ── */}
      <div className="space-y-4 lg:sticky lg:top-4">
        <div className="haven-panel">
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
        <div className="haven-panel flex items-center gap-4">
          {book ? (
            <>
              <div className="relative w-20 aspect-[0.71] shrink-0 drop-shadow-[0_6px_8px_rgba(60,35,15,0.3)]" style={{ containerType: 'inline-size' }}>
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

        {/* Which sections fans see on the page */}
        <div className="haven-panel">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Page sections</p>
          <div className="mt-2.5 space-y-2">
            {COMMUNITY_SECTIONS.map((sec) => {
              const on = sec.ready && (c.page?.sections?.[sec.id] ?? true)
              return (
                <button key={sec.id} type="button" disabled={!sec.ready}
                  onClick={() => set({ page: { ...(c.page ?? {}), sections: { ...(c.page?.sections ?? {}), [sec.id]: !on } } })}
                  className="w-full flex items-center gap-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] px-3 py-2 text-left disabled:opacity-60 disabled:cursor-default">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{sec.name}</span>
                    <span className="block text-[11px] text-slate-500 leading-snug">{sec.hint}</span>
                  </span>
                  {sec.ready ? (
                    <span className={cn('w-9 h-5 shrink-0 rounded-full p-0.5 transition-colors', on ? 'bg-violet-600' : 'bg-slate-700')}>
                      <span className={cn('block w-4 h-4 rounded-full bg-white shadow transition-transform', on && 'translate-x-4')} />
                    </span>
                  ) : <span className="shrink-0 rounded-full bg-[#e6d7b6] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">Coming soon</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* What's coming */}
        <div className="rounded-[0.875rem] border border-dashed border-[#c4ae83] p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Coming soon</p>
          <div className="mt-2.5 space-y-2.5">
            {([[Megaphone, 'News posts', 'Tell members about new badges and drops'], [CalendarDays, 'Events', 'Limited-time badges and collecting challenges']] as const).map(([Icon, t, d]) => (
              <div key={t} className="flex items-start gap-3">
                <span className="haven-medallion w-8 h-8 shrink-0"><Icon size={14} /></span>
                <div><p className="text-sm font-semibold text-ink">{t}</p><p className="text-[11px] text-slate-500">{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {headerOpen && <HeaderEditor uid={uid} c={c} onChange={(page) => set({ page })} onClose={() => setHeaderOpen(false)} />}
    </div>
  )
}

/** The header picture: upload it, then drag and zoom it into the 4 : 1 header (like the cover picture),
 *  and choose how much it darkens toward the bottom so the page's text reads */
function HeaderEditor({ uid, c, onChange, onClose }: { uid: string; c: Community; onChange: (page: CommunityLook) => void; onClose: () => void }) {
  const look = c.page ?? {}
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true); setError('')
    try {
      const blob = await shrink(file)
      const r = ref(appStorage, `creators/${uid}/header-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`)
      await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' })
      onChange({ ...look, header: await getDownloadURL(r), headerFit: undefined })
    } catch (e) {
      setError('Couldn’t upload that picture — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[#2b2014]/50 backdrop-blur-[2px]" onClick={onClose} />
        <div role="dialog" aria-modal="true" aria-label="Header picture" className="haven-panel haven-grain relative w-full max-w-xl !p-6 shadow-[0_30px_60px_-20px_rgba(40,25,10,0.6)]">
          <div className="flex items-center gap-3">
            <span className="haven-medallion w-10 h-10"><ImagePlus size={18} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="pinbook-serif text-lg font-bold text-ink">Header picture</h2>
              <p className="text-xs text-slate-500">Across the top of your community page — it saves itself.</p>
            </div>
            <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-ink" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="mt-4">
            {look.header ? (
              <>
                <PicturePlacer src={badgeArt(look.header, 1920)!} fit={look.headerFit} onChange={(headerFit) => onChange({ ...look, headerFit })}
                  aspect={HEADER_ASPECT} base={`linear-gradient(135deg, ${c.color}, #0b0b12)`} fillLabel="Fill header" />
                <ValueSlider label="Darken" min={0} max={1} step={0.05} value={look.headerShade ?? 0.35} onChange={(v) => onChange({ ...look, headerShade: v })} />
                <p className="mt-1 text-[11px] text-slate-500">Darkens it toward the bottom so your page&rsquo;s name and text read on top.</p>
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" onClick={() => input.current?.click()} disabled={busy} className="haven-chip px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Change picture
                  </button>
                  <button type="button" onClick={() => onChange({ ...look, header: undefined, headerFit: undefined })} className="ml-auto haven-chip px-3 py-1.5 text-xs font-semibold">Remove — use my colour</button>
                </div>
              </>
            ) : (
              <button type="button" onClick={() => input.current?.click()} disabled={busy}
                className="w-full rounded-2xl border-2 border-dashed border-[#c4ae83] hover:border-[#7a5230] bg-[#f6eedb] py-10 flex flex-col items-center gap-1.5 text-slate-500 hover:text-ink transition-colors">
                <span className="haven-medallion w-11 h-11">{busy ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}</span>
                <span className="mt-1 text-sm font-bold text-ink">{busy ? 'Uploading…' : 'Upload a header picture'}</span>
                <span className="text-[11px] px-6 text-center">Wide pictures work best (about 4 × as wide as tall). Then drag and zoom it into place.</span>
              </button>
            )}
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          </div>
        </div>
      </div>
    </Portal>
  )
}
