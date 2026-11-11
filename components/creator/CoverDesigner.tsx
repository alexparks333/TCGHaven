'use client'

// The Creator Book's cover, designed by tapping: its title, a leather, a foil, a stamp, and (if they
// like) their own cover picture — all shown live on the book beside it (BookStage). docs/creators.md.

import { useRef, useState } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { Check, ImagePlus, Loader2, Trash2, Sparkles } from 'lucide-react'
import type { BadgeSet } from '@/lib/badges'
import { LEATHERS, FOILS, monogramOf } from '@/lib/creatorBooks'
import { cutOutCover } from '@/lib/coverCutout'
import { appStorage } from '@/lib/firebase/appStorage'
import { cn } from '@/lib/utils'

export function CoverDesigner({ uid, book, onChange }: { uid: string; book: BadgeSet; onChange: (next: BadgeSet) => void }) {
  const set = (patch: Partial<BadgeSet>) => onChange({ ...book, ...patch })
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function uploadCover(file: File | undefined) {
    if (!file) return
    setUploading(true); setError('')
    try {
      // Cut the picture out of a plain light background, like the staff portal's covers
      const blob = await cutOutCover(file).catch(() => file)
      const r = ref(appStorage, `creators/${uid}/cover-${Date.now()}.webp`)
      await uploadBytes(r, blob, { contentType: blob.type || 'image/webp' })
      set({ coverImage: await getDownloadURL(r) })
    } catch (e) {
      setError('Couldn’t upload that picture — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Name your book">
        <input
          className="input-field text-base font-semibold"
          value={book.name}
          maxLength={40}
          onChange={(e) => set({ name: e.target.value, collection: e.target.value, monogram: book.monogram === monogramOf(book.name) ? monogramOf(e.target.value) : book.monogram })}
          placeholder="e.g. PewDiePie Cuties"
        />
        <div className="mt-2 grid grid-cols-[1fr_88px] gap-2">
          <input className="input-field text-sm" value={book.subtitle} maxLength={40} onChange={(e) => set({ subtitle: e.target.value })} placeholder="A line above the title" />
          <input className="input-field text-sm text-center font-black tracking-widest uppercase" value={book.monogram} maxLength={3} onChange={(e) => set({ monogram: e.target.value.toUpperCase() })} placeholder="★" title="The stamp on the cover" />
        </div>
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
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={book.coverImage} alt="" className="w-14 h-20 object-cover rounded-md shadow" />
            <button type="button" onClick={() => fileInput.current?.click()} className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink text-xs">Change</button>
            <button type="button" onClick={() => set({ coverImage: undefined })} className="p-2 rounded-lg text-slate-500 hover:text-red-600" aria-label="Remove the cover picture"><Trash2 size={16} /></button>
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
            <span className="text-[11px]">Best on a plain light background — we cut it out for you</span>
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => uploadCover(e.target.files?.[0])} />
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
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
