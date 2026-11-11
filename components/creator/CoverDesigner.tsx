'use client'

// The Creator Book's cover, designed by tapping: its title, a leather, a foil, a stamp, and (if they
// like) their own cover picture — all shown live on the book beside it (BookStage). docs/creators.md.

import { useEffect, useRef, useState } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { Check, ImagePlus, Loader2, Trash2, Sparkles } from 'lucide-react'
import type { BadgeSet, CoverStyle } from '@/lib/badges'
import { COVER_FONTS, loadCoverFonts } from '@/lib/coverFonts'
import { LEATHERS, FOILS, monogramOf } from '@/lib/creatorBooks'
import { appStorage } from '@/lib/firebase/appStorage'
import { cn } from '@/lib/utils'

export function CoverDesigner({ uid, book, onChange }: { uid: string; book: BadgeSet; onChange: (next: BadgeSet) => void }) {
  const set = (patch: Partial<BadgeSet>) => onChange({ ...book, ...patch })
  // The lettering and pages (CoverStyle in lib/badges.ts)
  const st: CoverStyle = book.coverStyle ?? {}
  const setStyle = (patch: Partial<CoverStyle>) => onChange({ ...book, coverStyle: { ...st, ...patch } })
  useEffect(() => { loadCoverFonts(COVER_FONTS.map((f) => f.id)) }, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function uploadCover(file: File | undefined) {
    if (!file) return
    setUploading(true); setError('')
    try {
      // As it is (the creator places it themselves below); only very big pictures are shrunk
      const blob = await shrink(file)
      const r = ref(appStorage, `creators/${uid}/cover-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`)
      await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' })
      set({ coverImage: await getDownloadURL(r), coverFit: { x: 0, y: 0, scale: 1 } })
    } catch (e) {
      const code = (e as { code?: string })?.code
      setError(code === 'storage/unauthorized'
        ? 'Uploads aren’t switched on for creators yet (the new Storage rules need publishing).'
        : 'Couldn’t upload that picture — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Title">
        <input
          className="input-field text-base font-semibold"
          value={book.name}
          maxLength={40}
          onChange={(e) => set({ name: e.target.value, collection: e.target.value, monogram: book.monogram === monogramOf(book.name) ? monogramOf(e.target.value) : book.monogram })}
          placeholder="e.g. PewDiePie Cuties"
        />
        {/* 20 fonts, each showing the book's own name */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 max-h-[220px] overflow-y-auto scroll-themed pr-1">
          {COVER_FONTS.map((f) => {
            const on = (st.font ?? 'classic') === f.id
            return (
              <button key={f.id} type="button" onClick={() => setStyle({ font: f.id })} title={f.name}
                className={cn('rounded-lg border px-1.5 py-2 text-center transition-colors', on ? 'border-transparent text-white shadow' : 'border-slate-800 bg-slate-950/40 text-ink hover:border-slate-700')}
                style={on ? { background: `linear-gradient(135deg, ${book.cover.from}, ${book.cover.to})` } : undefined}>
                <span className={cn('block truncate text-[15px] leading-tight', f.upper && 'uppercase')} style={{ fontFamily: f.css, fontWeight: f.weight }}>{(book.name || 'Aa').slice(0, 10)}</span>
                <span className={cn('block text-[9px] mt-0.5 truncate', on ? 'text-white/70' : 'text-slate-500')}>{f.name}</span>
              </button>
            )
          })}
        </div>
        <Slider label="Size" min={0.6} max={1.8} step={0.02} value={st.titleSize ?? 1} onChange={(v) => setStyle({ titleSize: v })} />
        <Slider label="Height" hint="up / down the cover" min={8} max={88} step={0.5} value={st.titleY ?? 38} onChange={(v) => setStyle({ titleY: v })} />
        <Colors label="Colour" value={st.titleColor ?? '#fbe9c4'} onChange={(c) => setStyle({ titleColor: c })} />
      </Section>

      <Section title="Line above the title">
        <Toggle on={st.showSubtitle !== false} onChange={(v) => setStyle({ showSubtitle: v })} label="Show it" />
        {st.showSubtitle !== false && (
          <>
            <input className="input-field text-sm mt-2" value={book.subtitle} maxLength={40} onChange={(e) => set({ subtitle: e.target.value })} placeholder="e.g. Alex Parks · Creator Book" />
            <Colors label="Colour" value={st.subtitleColor ?? book.cover.accent} onChange={(c) => setStyle({ subtitleColor: c })} />
          </>
        )}
      </Section>

      <Section title="Emblem & count">
        <Toggle on={st.showEmblem !== false} onChange={(v) => setStyle({ showEmblem: v })} label="Emblem" hint="your first pin, or your stamp until you have one" />
        {st.showEmblem !== false && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-500">Stamp</span>
            <input className="input-field !w-20 text-sm text-center font-black tracking-widest uppercase" value={book.monogram} maxLength={3} onChange={(e) => set({ monogram: e.target.value.toUpperCase() })} placeholder="★" />
          </div>
        )}
        <div className="mt-3"><Toggle on={st.showCount !== false} onChange={(v) => setStyle({ showCount: v })} label="Earned count" hint="“3 / 10 earned” at the bottom" /></div>
      </Section>

      <Section title="Leather">
        <div className="grid grid-cols-6 gap-2.5">
          {LEATHERS.map((l) => {
            const on = book.cover.from === l.from && book.cover.to === l.to
            return (
              <button
                key={l.name}
                type="button"
                title={l.name}
                onClick={() => set({ cover: { ...book.cover, from: l.from, to: l.to } })}
                className={cn('relative aspect-square rounded-full shadow-[inset_0_-3px_6px_rgba(0,0,0,0.45),0_2px_4px_rgba(0,0,0,0.25)] transition-transform hover:scale-110', on && 'ring-[3px] ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a] scale-110')}
                style={{ background: `radial-gradient(circle at 32% 28%, ${l.from}, ${l.to})` }}
              >
                {on && <Check size={16} className="absolute inset-0 m-auto text-white drop-shadow" />}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Foil">
        <div className="flex flex-wrap gap-2.5">
          {FOILS.map((f) => {
            const on = book.cover.accent === f.color
            return (
              <button
                key={f.name}
                type="button"
                title={f.name}
                onClick={() => set({ cover: { ...book.cover, accent: f.color } })}
                className={cn('w-9 h-9 rounded-xl transition-transform hover:scale-110 shadow-[0_2px_4px_rgba(0,0,0,0.25)]', on && 'ring-[3px] ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a] scale-110')}
                style={{ background: `linear-gradient(135deg, #fffaf0 0%, ${f.color} 35%, ${f.color} 60%, #00000055 100%)` }}
              />
            )
          })}
        </div>
      </Section>

      <Section title="Cover picture" hint="optional — your own artwork instead of leather">
        {book.coverImage ? (
          <div>
            <PlacePicture book={book} onChange={(coverFit) => set({ coverFit })} />
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink text-xs">
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Change picture
              </button>
              <button type="button" onClick={() => set({ coverImage: undefined, coverFit: undefined })} className="ml-auto p-2 rounded-lg text-slate-500 hover:text-red-600" aria-label="Remove the cover picture"><Trash2 size={16} /></button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="w-full rounded-2xl border-2 border-dashed border-slate-700 hover:border-violet-500 bg-slate-950/40 py-5 flex flex-col items-center gap-1.5 text-slate-500 hover:text-ink transition-colors"
          >
            {uploading ? <Loader2 size={22} className="animate-spin" /> : <ImagePlus size={22} />}
            <span className="text-sm font-semibold">{uploading ? 'Cutting it out…' : 'Upload a cover picture'}</span>
            <span className="text-[11px]">Then drag it and zoom it to place it on your cover</span>
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => uploadCover(e.target.files?.[0])} />
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </Section>

      <Section title="Page edges" hint="the pages showing at the side">
        <div className="flex flex-wrap gap-2">
          {PAGE_COLORS.map((p) => {
            const on = (st.pageColor ?? '') === (p.color ?? '')
            return (
              <button key={p.name} type="button" title={p.name} onClick={() => setStyle({ pageColor: p.color })}
                className={cn('w-9 h-9 rounded-lg transition-transform hover:scale-110 shadow-[0_2px_4px_rgba(0,0,0,0.25)]', on && 'ring-[3px] ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a] scale-110')}
                style={{ background: p.color ? `repeating-linear-gradient(0deg, ${p.color} 0 3px, color-mix(in srgb, ${p.color} 80%, black) 3px 4px)` : '#221d1a' }} />
            )
          })}
        </div>
      </Section>

      <button
        type="button"
        onClick={() => {
          const l = LEATHERS[Math.floor(Math.random() * LEATHERS.length)]
          const f = FOILS[Math.floor(Math.random() * FOILS.length)]
          set({ cover: { from: l.from, to: l.to, accent: f.color } })
        }}
        className="w-full rounded-xl border border-slate-800 py-2.5 text-sm font-semibold text-slate-400 hover:text-ink hover:border-slate-700 flex items-center justify-center gap-2"
      >
        <Sparkles size={15} /> Surprise me
      </button>
    </div>
  )
}

/** Big pictures shrunk to at most 2400 px on the long side (JPEG, or PNG when it has see-through parts) */
async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file).catch(() => null)
  if (!img) return file
  const k = Math.min(1, 2400 / Math.max(img.width, img.height))
  if (k === 1 && file.size < 6 * 1024 * 1024) return file
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return new Promise((res) => c.toBlob((b) => res(b ?? file), type, 0.9))
}

type Fit = NonNullable<BadgeSet['coverFit']>

/** Place the cover picture: drag it anywhere (even past the edges — the faded part is off the
 *  cover, the leather shows where it doesn't reach), zoom with the slider or the scroll wheel */
function PlacePicture({ book, onChange }: { book: BadgeSet; onChange: (fit: Fit) => void }) {
  const fit: Fit = book.coverFit ?? { x: 0, y: 0, scale: 1 }
  const coverRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; fit: Fit } | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  // The zoom at which the picture just covers the whole cover (cover = 0.71 wide : 1 tall)
  const fillScale = natural ? Math.max(1, natural.w / (natural.h * 0.71)) : 1
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
  const img = (ghost: boolean) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={book.coverImage}
      alt=""
      draggable={false}
      onLoad={ghost ? undefined : (e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      className={cn('absolute max-w-none select-none pointer-events-none', ghost && 'opacity-35')}
      style={{ left: `${50 + fit.x}%`, top: `${50 + fit.y}%`, width: `${fit.scale * 100}%`, transform: 'translate(-50%, -50%)' }}
    />
  )
  return (
    <div>
      {/* The cover's outline in the middle of a bigger stage, so the picture can hang past it */}
      <div
        className="relative mx-auto w-full max-w-[300px] aspect-[1.05] rounded-xl overflow-hidden bg-[repeating-conic-gradient(#d9ccb0_0%_25%,#e8dcc2_0%_50%)] [background-size:16px_16px] touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, fit } }}
        onPointerMove={(e) => {
          const d = drag.current, cover = coverRef.current
          if (!d || !cover) return
          const r = cover.getBoundingClientRect()
          onChange({ ...d.fit, x: clamp(d.fit.x + ((e.clientX - d.x) / r.width) * 100, -150, 150), y: clamp(d.fit.y + ((e.clientY - d.y) / r.height) * 100, -150, 150) })
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onWheel={(e) => onChange({ ...fit, scale: clamp(fit.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.2, 6) })}
      >
        {/* The cover area, in the middle */}
        <div ref={coverRef} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[86%] aspect-[0.71]">
          {/* What's off the cover, faded */}
          <div className="absolute inset-0">{img(true)}</div>
          {/* What's on it: leather, then the picture, clipped to the cover */}
          <div className="absolute inset-0 rounded-[8px] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.35)]" style={{ background: `linear-gradient(150deg, ${book.cover.from}, ${book.cover.to})` }}>
            {img(false)}
          </div>
          <div className="absolute inset-0 rounded-[8px] ring-2 ring-white/80 ring-offset-0 pointer-events-none" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-500 w-10">Zoom</span>
        <input type="range" min={0.2} max={4} step={0.01} value={fit.scale} onChange={(e) => onChange({ ...fit, scale: Number(e.target.value) })} className="flex-1 accent-violet-600" />
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => onChange({ x: 0, y: 0, scale: fillScale })} className="flex-1 rounded-lg border border-slate-800 py-1.5 text-xs font-semibold text-slate-400 hover:text-ink">Fill cover</button>
        <button type="button" onClick={() => onChange({ ...fit, x: 0, y: 0 })} className="flex-1 rounded-lg border border-slate-800 py-1.5 text-xs font-semibold text-slate-400 hover:text-ink">Center</button>
      </div>
      <p className="text-[11px] text-slate-500 mt-2 text-center">Drag to move · scroll or slide to zoom · it can hang past the edges</p>
    </div>
  )
}

const TEXT_COLORS = ['#fbe9c4', '#ffffff', '#e8b35a', '#f2d38a', '#d9dde3', '#e8a48e', '#8fb6ff', '#6fd3a2', '#c79bff', '#f5a3c7', '#e05252', '#1c1206']
const PAGE_COLORS: Array<{ name: string; color?: string }> = [
  { name: 'Classic dark' }, { name: 'Cream', color: '#efe2c4' }, { name: 'White', color: '#f7f4ee' }, { name: 'Gilded', color: '#d4a24c' },
  { name: 'Silver', color: '#c9ccd1' }, { name: 'Rose', color: '#e2a3a8' }, { name: 'Red', color: '#8a2b2b' }, { name: 'Blue', color: '#2c4a7a' }, { name: 'Black', color: '#1a1714' },
]

function Slider({ label, hint, min, max, step, value, onChange }: { label: string; hint?: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mt-3 flex items-center gap-3">
      <span className="text-xs font-semibold text-slate-500 w-14 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-violet-600" title={hint} />
    </label>
  )
}

function Colors({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div className="mt-3 flex items-start gap-3">
      <span className="text-xs font-semibold text-slate-500 w-14 shrink-0 pt-1.5">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {TEXT_COLORS.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={c}
            className={cn('w-6 h-6 rounded-full border border-black/15 transition-transform hover:scale-110', value.toLowerCase() === c && 'ring-2 ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a] scale-110')}
            style={{ background: c }} />
        ))}
        {/* Any colour */}
        <label className="relative w-6 h-6 rounded-full border border-black/15 overflow-hidden cursor-pointer" title="Any colour" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
      </div>
    </div>
  )
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="w-full flex items-center gap-3 text-left">
      <span className={cn('relative w-10 h-6 rounded-full transition-colors shrink-0', on ? 'bg-violet-600' : 'bg-slate-700')}>
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
    </button>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2.5">
        {title}{hint && <span className="font-normal normal-case tracking-normal"> · {hint}</span>}
      </p>
      {children}
    </div>
  )
}
