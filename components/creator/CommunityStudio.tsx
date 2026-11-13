'use client'

// The Creator Studio's Community tab (docs/creators.md): on the left, the community page exactly as fans
// see it (CommunityPage's CommunityView); on the right, everything to change it — the header picture,
// colour, name, tagline, games, About and which sections show. Every change shows on the left at once and
// saves itself a moment later (communities/{uid}).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Home, Plus, Trash2, Check, Copy, Eye, ExternalLink, Loader2, Pencil, Megaphone, CalendarDays, BookOpen, ImagePlus, X } from 'lucide-react'
import { useCommunity, saveCommunity, COMMUNITY_SECTIONS, HEADER_ASPECT, MAX_TABS, newTabId, type Community, type CommunityLook, type CommunityTab, type CreatorBook } from '@/lib/creatorBooks'
import { CommunityView } from '@/components/pages/CommunityPage'
import { BANNERS } from '@/components/creator/CreateCommunity'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
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
  const [tabOpen, setTabOpen] = useState('home') // the tab being edited, and shown on the left
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
      {/* ── The page exactly as fans see it (CommunityPage's CommunityView) — every change on the right shows here at once ── */}
      <div className="min-w-0">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 flex items-center gap-1.5">
          <Eye size={13} />Your community page — exactly what fans see
        </p>
        <div className="rounded-2xl border border-[#d6c49f] bg-slate-900 p-3 md:p-5">
          <CommunityView uid={uid} community={{ uid, ...c }} creator={null} members={members} mine={false} studio="computer"
            isMember={false} busy={false} error="" toggle={() => {}} book={liveBook} open={viewing} setOpen={setViewing}
            tab={tabOpen} onTab={setTabOpen} />
        </div>
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

        {/* Everything on the page: header, colour, name, tagline, games, About */}
        <div className="haven-panel">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Page details</p>
          <button type="button" onClick={() => setHeaderOpen(true)} className="mt-2.5 w-full haven-chip px-3 py-2 text-sm font-semibold inline-flex items-center justify-center gap-2">
            <ImagePlus size={15} />{c.page?.header ? 'Change header picture' : 'Add a header picture'}
          </button>
          <p className="mt-3 text-[11px] font-semibold text-slate-500">Colour {c.page?.header && <span className="font-normal">· shows round your page and when there&rsquo;s no picture</span>}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {BANNERS.map((col) => (
              <button key={col} type="button" onClick={() => set({ color: col })} aria-label={`Colour ${col}`}
                className={cn('w-6 h-6 rounded-full', c.color === col ? 'ring-2 ring-offset-2 ring-offset-[#efe4cc] ring-[#7a5230]' : 'hover:ring-1 hover:ring-[#c4ae83]')} style={{ background: col }} />
            ))}
          </div>
          <label className="mt-3 block text-[11px] font-semibold text-slate-500">Name
            <input value={c.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} className="input-field mt-1 text-sm font-semibold" placeholder="Your community’s name" />
          </label>
          {state === 'name' && <p className="mt-1 text-[11px] text-red-600">Give it a name of at least 2 letters to save.</p>}
          <label className="mt-2.5 block text-[11px] font-semibold text-slate-500">Tagline
            <input value={c.tagline} maxLength={80} onChange={(e) => set({ tagline: e.target.value })} className="input-field mt-1 text-sm" placeholder="A one-line tagline" />
          </label>
          <p className="mt-2.5 text-[11px] font-semibold text-slate-500">Games you collect</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(Object.keys(GAME_LABELS) as Game[]).map((g) => {
              const has = c.games?.includes(g)
              return (
                <button key={g} type="button" onClick={() => set({ games: has ? c.games!.filter((x) => x !== g) : [...(c.games ?? []), g] })}
                  className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors', has ? 'text-white' : 'border border-dashed border-[#c4ae83] text-slate-500 hover:text-ink')}
                  style={has ? { background: GAME_COLORS[g] } : undefined}>{GAME_LABELS[g]}</button>
              )
            })}
          </div>
          <label className="mt-2.5 block text-[11px] font-semibold text-slate-500">
            <span className="flex justify-between">About<span className="font-normal tabular-nums">{c.about.length}/600</span></span>
            <textarea value={c.about} maxLength={600} onChange={(e) => set({ about: e.target.value })} className="input-field mt-1 text-sm min-h-[110px] resize-y" placeholder="Who you are, what you collect, what members get…" />
          </label>
        </div>

        {/* The page's tabs: Home, then the creator's own pages — pick one to edit it (the page on the left shows it) */}
        <TabsEditor uid={uid} c={c} set={set} open={tabOpen} onOpen={setTabOpen} />

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
        <div role="dialog" aria-modal="true" aria-label="Header picture" className="haven-panel haven-grain relative w-full max-w-3xl !p-6 shadow-[0_30px_60px_-20px_rgba(40,25,10,0.6)]">
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
                  aspect={HEADER_ASPECT} base={`linear-gradient(135deg, ${c.color}, #0b0b12)`} fillLabel="Fill header"
                  overlay={<div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(to bottom, transparent 35%, rgba(10,6,2,${look.headerShade ?? 0.35}))` }} /> /* the darkening, as on the page */} />
                <ValueSlider label="Darken" min={0} max={1} step={0.05} value={look.headerShade ?? 0.35} onChange={(v) => onChange({ ...look, headerShade: v })} />
                <p className="mt-1 text-[11px] text-slate-500">Darkens it toward the bottom so your page&rsquo;s name and text read on top.</p>
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" onClick={() => input.current?.click()} disabled={busy} className="haven-chip px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Change picture
                  </button>
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

/** The page's tabs: Home (always first), then the creator's own pages — add, rename, reorder, delete,
 *  and write each one (a picture and text) */
function TabsEditor({ uid, c, set, open, onOpen }: { uid: string; c: Community; set: (p: Partial<Community>) => void; open: string; onOpen: (id: string) => void }) {
  const tabs = c.page?.tabs ?? []
  const save = (next: CommunityTab[]) => set({ page: { ...(c.page ?? {}), tabs: next } })
  const tab = tabs.find((t) => t.id === open)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const update = (id: string, p: Partial<CommunityTab>) => save(tabs.map((t) => (t.id === id ? { ...t, ...p } : t)))
  const move = (i: number, d: -1 | 1) => { const n = [...tabs]; [n[i], n[i + d]] = [n[i + d], n[i]]; save(n) }
  async function upload(file: File | undefined) {
    if (!file || !tab) return
    setBusy(true)
    try {
      const blob = await shrink(file)
      const r = ref(appStorage, `creators/${uid}/tab-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`)
      await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' })
      update(tab.id, { image: await getDownloadURL(r) })
    } catch { /* the picture stays as it was */ } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="haven-panel">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Tabs</p>
      <p className="text-[11px] text-slate-500 mt-0.5">Under your Join button. Home comes first; add your own pages after it.</p>
      <div className="mt-2.5 space-y-1.5">
        <button type="button" onClick={() => onOpen('home')}
          className={cn('w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold', open === 'home' ? 'border-[#7a5230] bg-[#f6eedb] text-ink' : 'border-[#d6c49f] text-slate-500 hover:text-ink')}>
          <Home size={14} />Home<span className="ml-auto text-[10px] font-normal">always first</span>
        </button>
        {tabs.map((t, i) => (
          <div key={t.id} className={cn('flex items-center gap-1 rounded-xl border pl-3 pr-1 py-1', open === t.id ? 'border-[#7a5230] bg-[#f6eedb]' : 'border-[#d6c49f]')}>
            <button type="button" onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left text-sm font-semibold text-ink truncate py-1">{t.title || 'Untitled'}</button>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1.5 rounded-lg text-slate-500 hover:text-ink disabled:opacity-30" aria-label="Move up"><ArrowUp size={13} /></button>
            <button type="button" disabled={i === tabs.length - 1} onClick={() => move(i, 1)} className="p-1.5 rounded-lg text-slate-500 hover:text-ink disabled:opacity-30" aria-label="Move down"><ArrowDown size={13} /></button>
            <button type="button" onClick={() => { if (confirm(`Delete the “${t.title || 'Untitled'}” tab and everything on it?`)) { save(tabs.filter((x) => x.id !== t.id)); if (open === t.id) onOpen('home') } }}
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-600" aria-label={`Delete ${t.title}`}><Trash2 size={13} /></button>
          </div>
        ))}
        {tabs.length < MAX_TABS && (
          <button type="button" onClick={() => { const t = { id: newTabId(), title: 'New page', body: '' }; save([...tabs, t]); onOpen(t.id) }}
            className="w-full rounded-xl border border-dashed border-[#c4ae83] py-2 text-sm font-semibold text-[#7a5230] hover:bg-[#f6eedb] inline-flex items-center justify-center gap-1.5"><Plus size={14} />Add a page</button>
        )}
      </div>

      {/* The open tab's content */}
      {tab && (
        <div className="mt-4 pt-4 border-t border-[#d6c49f]">
          <label className="block text-[11px] font-semibold text-slate-500">Tab name
            <input value={tab.title} maxLength={24} onChange={(e) => update(tab.id, { title: e.target.value })} className="input-field mt-1 text-sm font-semibold" placeholder="e.g. Rules, Events, Giveaways" />
          </label>
          <p className="mt-3 text-[11px] font-semibold text-slate-500">Picture <span className="font-normal">· optional, at the top</span></p>
          {tab.image ? (
            <div className="mt-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={badgeArt(tab.image, 640)} alt="" className="w-full h-28 object-cover rounded-xl border border-[#d6c49f]" />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => input.current?.click()} disabled={busy} className="haven-chip px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5">{busy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}Change</button>
                <button type="button" onClick={() => update(tab.id, { image: undefined })} className="haven-chip px-3 py-1.5 text-xs font-semibold">Remove</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => input.current?.click()} disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-dashed border-[#c4ae83] py-3 text-xs font-semibold text-slate-500 hover:text-ink inline-flex items-center justify-center gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}{busy ? 'Uploading…' : 'Add a picture'}
            </button>
          )}
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <label className="mt-3 block text-[11px] font-semibold text-slate-500">
            <span className="flex justify-between">Text<span className="font-normal tabular-nums">{tab.body.length}/4000</span></span>
            <textarea value={tab.body} maxLength={4000} onChange={(e) => update(tab.id, { body: e.target.value })} className="input-field mt-1 text-sm min-h-[160px] resize-y" placeholder="Write this page — rules, events, giveaways, anything for your members." />
          </label>
        </div>
      )}
    </div>
  )
}
