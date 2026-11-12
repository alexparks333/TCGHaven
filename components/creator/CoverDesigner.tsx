'use client'

// The Creator Book's cover, designed by tapping: its title and lettering, its cover picture (required —
// a creator cover is always their artwork) and a spine — all shown live on the book beside it
// (CreatorPage CoverStage). docs/creators.md.

import { useEffect, useRef, useState } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { ImagePlus, Loader2, Type, AlignCenter, Palette, BookOpen, ChevronDown, BookMarked, Dices, RotateCcw } from 'lucide-react'
import type { BadgeSet, CoverStyle } from '@/lib/badges'
import { COVER_FONTS, FONT_GROUPS, TITLE_FINISHES, loadCoverFonts } from '@/lib/coverFonts'
import { monogramOf } from '@/lib/creatorBooks'
import { PAGE_EDGES, PAGE_DEPTH, edgeParams, pageEdgeCss, pageEdgeOf } from '@/lib/pageEdges'
import { ACCENT_COLORS, BLANK_COVER, CoverSpine, SPINES, SPINE_COLORS, SPINE_W_RANGE, coverArea, spineOf, spineParams, spineWidth, type SpineDef } from '@/components/badges/CoverSpine'
import { appStorage } from '@/lib/firebase/appStorage'
import { cn } from '@/lib/utils'

export function CoverDesigner({ uid, book, onChange, initialOpen }: { uid: string; book: BadgeSet; onChange: (next: BadgeSet) => void; initialOpen?: string }) {
  const set = (patch: Partial<BadgeSet>) => onChange({ ...book, ...patch })
  // The lettering and pages (CoverStyle in lib/badges.ts)
  const st: CoverStyle = book.coverStyle ?? {}
  const setStyle = (patch: Partial<CoverStyle>) => onChange({ ...book, coverStyle: { ...st, ...patch } })
  useEffect(() => { loadCoverFonts(COVER_FONTS.map((f) => f.id)) }, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [open, setOpen] = useState<string | null>(initialOpen ?? null)
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

  const font = COVER_FONTS.find((f) => f.id === (st.font ?? 'classic'))
  // Haven Style is on while the title has a foil finish
  const havenOn = !!st.titleFinish
  const setHaven = (on: boolean) => setStyle(on
    ? { titleFinish: 'gold', titlePlate: true, font: font?.group === 'Elegant' ? st.font : 'haven' }
    : { titleFinish: undefined, titleShine: false, titlePlate: false, font: font?.group === 'Elegant' ? 'classic' : st.font })
  // A grid of font buttons, each showing the book's own name in that font
  const FontGrid = ({ fonts }: { fonts: typeof COVER_FONTS }) => (
    <div className="grid grid-cols-3 gap-1.5">
      {fonts.map((f) => {
        const on = (st.font ?? 'classic') === f.id
        return (
          <button key={f.id} type="button" onClick={() => setStyle({ font: f.id })} title={f.name}
            className={cn('rounded-lg border px-1.5 py-2 text-center transition-colors', on ? 'border-transparent text-white shadow' : 'border-slate-800 bg-slate-950/40 text-ink hover:border-slate-700')}
            style={on ? { background: '#7a5230' } : undefined}>
            <span className={cn('block truncate text-[15px] leading-tight', f.upper && 'uppercase')} style={{ fontFamily: f.css, fontWeight: f.weight }}>{(book.name || 'Aa').slice(0, 10)}</span>
            <span className={cn('block text-[9px] mt-0.5 truncate', on ? 'text-white/70' : 'text-slate-500')}>{f.name}</span>
          </button>
        )
      })}
    </div>
  )
  const spine = spineOf(st)
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]
  // Every slider of the look somewhere random, and random colours
  const surpriseSpine = (def: SpineDef) => setStyle({
    spineColor: pick(SPINE_COLORS).color, spineAccent: pick(ACCENT_COLORS).color, spineDetail: pick(ACCENT_COLORS).color,
    spineParams: { ...(st.spineParams ?? {}), [def.id]: Object.fromEntries(def.sliders.map((x) => [x.key, x.min + Math.round((Math.random() * (x.max - x.min)) / x.step) * x.step])) },
  })
  const resetSpine = (def: SpineDef) => setStyle({
    spineColor: undefined, spineAccent: undefined, spineDetail: undefined, spineWidth: undefined, spineRound: undefined,
    spineParams: { ...(st.spineParams ?? {}), [def.id]: Object.fromEntries(def.sliders.map((x) => [x.key, x.def])) },
  })
  const edgeDef = pageEdgeOf(st.pageStyle ?? (st.pageColor ? 'paper' : undefined))
  return (
    <div className="space-y-2.5">
      {/* One part at a time: tap a part to open it (the others fold away) */}
      <Group id="title" open={open} setOpen={setOpen} icon={Type} title="Title"
        summary={`${font?.name ?? 'Classic'}${havenOn ? ` · Haven Style, ${TITLE_FINISHES.find((x) => x.id === st.titleFinish)?.name.toLowerCase()} foil` : ''} · ${book.name || 'untitled'}`}>
        <input
          className="input-field text-base font-semibold"
          value={book.name}
          maxLength={40}
          onChange={(e) => set({ name: e.target.value, collection: e.target.value, monogram: book.monogram === monogramOf(book.name) ? monogramOf(e.target.value) : book.monogram })}
          placeholder="e.g. PewDiePie Cuties"
        />
        <div className="mt-3" />
        {/* The switch: on = lettered like TCG Haven's own books (then fine-tune below); off = a plain title */}
        <button type="button" onClick={() => setHaven(!havenOn)}
          className="w-full rounded-xl px-4 py-3 flex items-center gap-3 text-left shadow-sm border border-black/20 transition-[filter] hover:brightness-110"
          style={{ background: havenOn ? 'linear-gradient(150deg, #3a2414, #150c06)' : 'linear-gradient(150deg, #4a4038, #2a241f)' }}>
          <span className="min-w-0 flex-1">
            <span className="block pinbook-serif uppercase tracking-[0.14em] font-bold text-[16px]" style={havenOn ? { backgroundImage: 'linear-gradient(180deg, #fff6d6 0%, #f6d98c 40%, #d9a948 75%, #f8e2a2 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } : { color: '#cfc4b4' }}>Haven Style</span>
            <span className="block text-[11px] text-[#d9c39a]/70 mt-0.5">{havenOn ? 'On — engraved foil lettering, like TCG Haven’s books' : 'Off — a plain title'}</span>
          </span>
          <span className={cn('relative w-11 h-6 rounded-full transition-colors shrink-0', havenOn ? 'bg-[#d9a948]' : 'bg-white/20')}>
            <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', havenOn ? 'left-[22px]' : 'left-0.5')} />
          </span>
        </button>

        {havenOn && (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 mt-5 mb-1.5">Elegant lettering</p>
            <FontGrid fonts={COVER_FONTS.filter((f) => f.group === 'Elegant')} />

            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 mt-5 mb-2">Foil</p>
            <div className="flex flex-wrap gap-2">
              {TITLE_FINISHES.map((x) => (
                <button key={x.id} type="button" title={x.name} onClick={() => setStyle({ titleFinish: x.id })}
                  className={cn('h-10 w-10 rounded-lg shadow-[inset_0_-2px_3px_rgba(0,0,0,0.3)] transition-transform hover:scale-110', st.titleFinish === x.id && 'ring-[3px] ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a] scale-110')}
                  style={{ background: `linear-gradient(180deg, ${x.gradient})` }} />
              ))}
            </div>
            <div className="mt-4 space-y-2.5">
              <Toggle on={!!st.titlePlate} onChange={(v) => setStyle({ titlePlate: v })} label="Glow behind" hint="a soft shadow behind the title so it reads on anything" />
            </div>
          </>
        )}
        {!havenOn && (
          <>
            {/* The fonts, in groups, each showing the book's own name (the Elegant ones come with Haven Style) */}
            <div className="mt-4 max-h-[300px] overflow-y-auto scroll-themed pr-1 space-y-3">
              {FONT_GROUPS.filter((g) => g !== 'Elegant').map((g) => (
                <div key={g}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 mb-1.5">{g}</p>
                  <FontGrid fonts={COVER_FONTS.filter((f) => f.group === g)} />
                </div>
              ))}
            </div>
            <Colors label="Colour" value={st.titleColor ?? '#fbe9c4'} onChange={(c) => setStyle({ titleColor: c })} />
          </>
        )}
        <Slider label="Size" min={0.6} max={1.8} step={0.02} value={st.titleSize ?? 1} onChange={(v) => setStyle({ titleSize: v })} />
        <Slider label="Height" hint="up / down the cover" min={8} max={88} step={0.5} value={st.titleY ?? 38} onChange={(v) => setStyle({ titleY: v })} />
      </Group>

      <Group id="text" open={open} setOpen={setOpen} icon={AlignCenter} title="Text"
        summary={[st.showSubtitle !== false ? 'Top line' : null, st.showCount !== false ? 'Count' : null].filter(Boolean).join(' · ') || 'All off'}>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Line above the title</p>
        <Toggle on={st.showSubtitle !== false} onChange={(v) => setStyle({ showSubtitle: v })} label="Show it" />
        {st.showSubtitle !== false && (
          <>
            <input className="input-field text-sm mt-2" value={book.subtitle} maxLength={40} onChange={(e) => set({ subtitle: e.target.value })} placeholder="e.g. Alex Parks · Creator Book" />
            <Colors label="Colour" value={st.subtitleColor ?? '#e8b35a'} onChange={(c) => setStyle({ subtitleColor: c })} />
          </>
        )}
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mt-5 mb-2">Count</p>
        <div><Toggle on={st.showCount !== false} onChange={(v) => setStyle({ showCount: v })} label="Earned count" hint="“3 / 10 earned” at the bottom" /></div>
        {st.showCount !== false && <Colors label="Colour" value={st.countColor ?? '#e8b35a'} onChange={(c) => setStyle({ countColor: c })} />}
      </Group>

      <Group id="cover" open={open} setOpen={setOpen} icon={Palette} title="Cover"
        summary={book.coverImage ? 'Your picture' : 'Needs a picture'}>
        {/* A creator cover is always a picture — until there is one the book is plain tan */}
        <Section title="Cover picture" hint="your artwork is the cover">
          {book.coverImage ? (
            <div>
              <PlacePicture book={book} onChange={(coverFit) => set({ coverFit })} />
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="haven-chip px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5">
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Change picture
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading}
              className="w-full rounded-2xl border-2 border-dashed border-[#c4ae83] hover:border-[#7a5230] bg-[#f6eedb] py-7 flex flex-col items-center gap-1.5 text-slate-500 hover:text-ink transition-colors">
              <span className="haven-medallion w-11 h-11">{uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}</span>
              <span className="mt-1 text-sm font-bold text-ink">{uploading ? 'Uploading…' : 'Upload your cover picture'}</span>
              <span className="text-[11px] px-6 text-center">Every Creator Book is covered in its own artwork. Then drag and zoom it into place.</span>
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => uploadCover(e.target.files?.[0])} />
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </Section>

      </Group>

      {/* The spine: its own section — pick a look, then its colours and its own sliders */}
      <Group id="spine" open={open} setOpen={setOpen} icon={BookMarked} title="Spine"
        summary={spine ? `${spine.name} · ${Math.round(spineWidth(st))}% wide` : 'None — add one down the left edge'}>
        <p className="text-xs text-slate-500 mb-3">Bound down the left edge. It eats into the cover, so your book stays the same size — the picture fits beside it.</p>
        <div className="grid grid-cols-5 gap-2">
          {[undefined, ...SPINES].map((sp) => {
            const on = spine?.id === sp?.id
            return (
              <button key={sp?.id ?? 'none'} type="button" onClick={() => setStyle({ spine: sp?.id ?? 'none' })} title={sp?.name ?? 'No spine'}
                className={cn('rounded-xl border p-1 transition-colors', on ? 'border-[#7a5230] bg-[#f6eedb] shadow-[0_0_0_1px_#7a5230]' : 'border-[#d6c49f] hover:border-[#a8875c]')}>
                {/* A strip of the spine in this look, in the creator's colours */}
                <span className="relative block w-full h-16 rounded-[6px] overflow-hidden" style={{ background: BLANK_COVER }}>
                  {sp ? <CoverSpine st={st} look={sp.id} swatch={0.6} /> : <span className="absolute inset-0 flex items-center justify-center text-[#8a7350] text-lg">∅</span>}
                </span>
                <span className={cn('block mt-1 text-[10px] leading-tight font-semibold truncate', on ? 'text-ink' : 'text-slate-500')}>{sp?.name ?? 'None'}</span>
              </button>
            )
          })}
        </div>

        {spine && (
          <div className="mt-4 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3.5">
            <div className="flex items-center gap-2">
              <p className="pinbook-serif font-bold text-ink flex-1 truncate">{spine.name}</p>
              <button type="button" onClick={() => surpriseSpine(spine)} className="haven-chip px-2.5 py-1 text-xs font-semibold inline-flex items-center gap-1"><Dices size={13} />Surprise me</button>
              <button type="button" onClick={() => resetSpine(spine)} className="haven-chip px-2.5 py-1 text-xs font-semibold inline-flex items-center gap-1" title="Back to this look's defaults"><RotateCcw size={13} />Reset</button>
            </div>

            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 mt-4">Colours</p>
            <ColorPick label={spine.base} value={st.spineColor ?? SPINE_COLORS[0].color} palette={SPINE_COLORS} onChange={(c) => setStyle({ spineColor: c })} />
            {spine.accent && <ColorPick label={spine.accent[0]} value={st.spineAccent ?? spine.accent[1]} palette={ACCENT_COLORS} onChange={(c) => setStyle({ spineAccent: c })} />}
            {spine.detail && <ColorPick label={spine.detail[0]} value={st.spineDetail ?? spine.detail[1]} palette={ACCENT_COLORS} onChange={(c) => setStyle({ spineDetail: c })} />}

            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 mt-5">Shape</p>
            <ValueSlider label="Width" min={SPINE_W_RANGE[0]} max={SPINE_W_RANGE[1]} step={0.5} value={spineWidth(st)} unit="%" onChange={(v) => setStyle({ spineWidth: v })} />
            <ValueSlider label="Roundness" min={0} max={1} step={0.05} value={st.spineRound ?? 0.8} onChange={(v) => setStyle({ spineRound: v })} />
            {spine.sliders.map((x) => (
              <ValueSlider key={x.key} label={x.label} min={x.min} max={x.max} step={x.step} value={spineParams(spine, st)[x.key]}
                onChange={(v) => setStyle({ spineParams: { ...(st.spineParams ?? {}), [spine.id]: { ...spineParams(spine, st), [x.key]: v } } })} />
            ))}
          </div>
        )}
      </Group>

      <Group id="pages" open={open} setOpen={setOpen} icon={BookOpen} title="Page edges" summary={edgeDef ? edgeDef.name : 'Classic dark'}>
        <p className="text-xs text-slate-500 mb-3">The block of pages showing at the side of the closed book.</p>
        <div className="grid grid-cols-4 gap-2">
          {[undefined, ...PAGE_EDGES].map((e) => {
            const on = edgeDef?.id === e?.id
            const bg = e ? pageEdgeCss(st, e.id) : '#221d1a'
            return (
              <button key={e?.id ?? 'classic'} type="button" title={e?.name ?? 'Classic dark'}
                onClick={() => setStyle(e ? { pageStyle: e.id } : { pageStyle: undefined, pageColor: undefined })}
                className={cn('rounded-xl border p-1 transition-colors', on ? 'border-[#7a5230] bg-[#f6eedb] shadow-[0_0_0_1px_#7a5230]' : 'border-[#d6c49f] hover:border-[#a8875c]')}>
                {/* a closed book's corner: the cover, with the page block showing at its side and foot */}
                <span className="relative block h-12 rounded-md overflow-hidden bg-[#e6d7b6]">
                  <span className="absolute left-0 top-0 right-[5px] bottom-[5px] translate-x-[5px] translate-y-[5px] rounded-[5px]" style={{ background: bg ?? '#221d1a' }} />
                  <span className="absolute left-0 top-0 right-[12px] bottom-[12px] rounded-[5px] shadow-[2px_2px_4px_rgba(0,0,0,0.35)]" style={{ background: `linear-gradient(150deg, #5a3a22, #2b1a0f)` }} />
                </span>
                <span className={cn('block mt-1 text-[10px] leading-tight font-semibold truncate', on ? 'text-ink' : 'text-slate-500')}>{e?.name ?? 'Classic'}</span>
              </button>
            )
          })}
        </div>
        {edgeDef && (
          <div className="mt-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3.5">
            {/* A close look at the edge, big */}
            <div className="relative h-24 rounded-lg overflow-hidden bg-[#e6d7b6]">
              <span className="absolute left-0 top-0 right-[10%] bottom-[14%] rounded-lg" style={{ background: pageEdgeCss(st) ?? '#221d1a', transform: `translate(${Math.min(28, (st.pageDepth ?? PAGE_DEPTH) * 2.4)}px, ${Math.min(22, (st.pageDepth ?? PAGE_DEPTH) * 1.8)}px)` }} />
              <span className="absolute left-0 top-0 right-[10%] bottom-[14%] rounded-lg shadow-[3px_3px_8px_rgba(0,0,0,0.4)]" style={{ background: 'linear-gradient(150deg, #5a3a22, #2b1a0f)' }} />
            </div>
            {edgeDef.colors.map(([label, d], i) => {
              const key = i === 0 ? 'pageColor' : 'pageColor2'
              return <ColorPick key={key} label={label} value={st[key] ?? d} palette={EDGE_PALETTE} onChange={(c) => setStyle({ [key]: c })} />
            })}
            <div className="mt-1" />
            <ValueSlider label="Depth" min={2} max={14} step={0.5} value={st.pageDepth ?? PAGE_DEPTH} unit="px" onChange={(v) => setStyle({ pageDepth: v })} />
            <ValueSlider label="Page lines" min={0} max={1} step={0.05} value={st.pageLines ?? 0.5} onChange={(v) => setStyle({ pageLines: v })} />
            {edgeDef.sliders.map((x) => (
              <ValueSlider key={x.key} label={x.label} min={x.min} max={x.max} step={x.step} value={edgeParams(edgeDef, st)[x.key]}
                onChange={(v) => setStyle({ pageParams: { ...(st.pageParams ?? {}), [edgeDef.id]: { ...edgeParams(edgeDef, st), [x.key]: v } } })} />
            ))}
          </div>
        )}
      </Group>
    </div>
  )
}

/** A part of the designer that folds open when tapped — one open at a time */
export function Group({ id, open, setOpen, icon: Icon, title, summary, children }: {
  id: string; open: string | null; setOpen: (id: string | null) => void
  icon: typeof Type; title: string; summary: string; children: React.ReactNode
}) {
  const on = open === id
  return (
    <div className={cn('rounded-2xl border transition-colors', on ? 'border-slate-700 bg-slate-950/30' : 'border-slate-800 hover:border-slate-700')}>
      <button type="button" onClick={() => setOpen(on ? null : id)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
        <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors', on ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400')}><Icon size={17} /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-ink">{title}</span>
          <span className="block text-xs text-slate-500 truncate">{summary}</span>
        </span>
        <ChevronDown size={18} className={cn('text-slate-500 transition-transform shrink-0', on && 'rotate-180')} />
      </button>
      {on && <div className="px-4 pb-4 pt-1 add-card-panel">{children}</div>}
    </div>
  )
}

/** Big pictures shrunk to at most 2400 px on the long side (JPEG, or PNG when it has see-through parts) */
export async function shrink(file: File): Promise<Blob> {
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

/** Place the cover picture: drag it anywhere (the faded part is off the cover; plain tan shows
 *  where it doesn't reach), zoom with the slider or the scroll wheel */
function PlacePicture({ book, onChange }: { book: BadgeSet; onChange: (fit: Fit) => void }) {
  const spine = spineOf(book.coverStyle)
  return (
    <PicturePlacer src={book.coverImage!} fit={book.coverFit} onChange={({ x, y, scale }) => onChange({ x, y, scale })} aspect={0.71}
      area={coverArea(book.coverStyle)} base={BLANK_COVER} fillLabel="Fill cover"
      overlay={spine && <CoverSpine st={book.coverStyle} />} />
  )
}

/** Where a picture sits in its frame: its centre's offset from the frame's centre (% of the frame's
 *  width / height), its width as a multiple of the frame's, and (once known) its own width ÷ height */
export type PictureFit = { x: number; y: number; scale: number; ar?: number }

/** Place a picture in a frame (a cover, a page): drag it anywhere — even far past the edges (the
 *  faded part is off the frame) — and zoom with the slider or the scroll wheel; Fill / Center.
 *  `area`: the part of the frame the picture goes in (left, width in %), e.g. beside a spine. */
export function PicturePlacer({ src, fit: fit0, onChange, aspect, area = { left: 0, width: 100 }, base, overlay, fillLabel = 'Fill' }: {
  src: string; fit?: PictureFit; onChange: (fit: PictureFit) => void; aspect: number
  area?: { left: number; width: number }; base: string; overlay?: React.ReactNode; fillLabel?: string
}) {
  const coverRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; fit: PictureFit } | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const ar = natural ? natural.w / natural.h : fit0?.ar
  // Not placed yet: as it's shown before placing (filling the frame)
  const fillScale = ar ? Math.max(1, ar / (aspect * area.width / 100)) : 1
  const fit: PictureFit = fit0 ?? { x: 0, y: 0, scale: fillScale }
  const change = (f: PictureFit) => onChange(ar ? { ...f, ar: Math.round(ar * 10000) / 10000 } : f)
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
  const img = (ghost: boolean) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={ghost ? undefined : (e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      className={cn('absolute max-w-none select-none pointer-events-none', ghost && 'opacity-35')}
      style={{ left: `${50 + fit.x}%`, top: `${50 + fit.y}%`, width: `${fit.scale * 100}%`, transform: 'translate(-50%, -50%)' }}
    />
  )
  return (
    <div>
      {/* The frame's outline in the middle of a bigger stage, so the picture can hang far past it */}
      <div
        className="relative mx-auto w-full max-w-[300px] aspect-[1.05] rounded-xl overflow-hidden bg-[repeating-conic-gradient(#d9ccb0_0%_25%,#e8dcc2_0%_50%)] [background-size:16px_16px] touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, fit } }}
        onPointerMove={(e) => {
          const d = drag.current, cover = coverRef.current
          if (!d || !cover) return
          const r = cover.getBoundingClientRect()
          change({ ...d.fit, x: clamp(d.fit.x + ((e.clientX - d.x) / r.width) * 100, -300, 300), y: clamp(d.fit.y + ((e.clientY - d.y) / r.height) * 100, -300, 300) })
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onWheel={(e) => change({ ...fit, scale: clamp(fit.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.1, 10) })}
      >
        {/* The frame, in the middle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[80%]" style={{ aspectRatio: String(aspect) }}>
          {/* What's off the frame, faded */}
          <div className="absolute inset-y-0" style={{ left: `${area.left}%`, width: `${area.width}%` }}>{img(true)}</div>
          {/* What's on it, clipped to its area, then anything drawn over it */}
          <div className="absolute inset-0 rounded-[8px] overflow-hidden shadow-[0_6px_18px_rgba(0,0,0,0.35)]" style={{ background: base }}>
            <div ref={coverRef} className="absolute inset-y-0 overflow-hidden" style={{ left: `${area.left}%`, width: `${area.width}%` }}>{img(false)}</div>
            {overlay}
          </div>
          <div className="absolute inset-0 rounded-[8px] ring-2 ring-white/80 ring-offset-0 pointer-events-none" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-500 w-10">Zoom</span>
        <input type="range" min={0.1} max={6} step={0.01} value={fit.scale} onChange={(e) => change({ ...fit, scale: Number(e.target.value) })} className="flex-1 accent-violet-600" />
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => change({ x: 0, y: 0, scale: fillScale })} className="flex-1 rounded-lg border border-slate-800 py-1.5 text-xs font-semibold text-slate-400 hover:text-ink">{fillLabel}</button>
        <button type="button" onClick={() => change({ ...fit, x: 0, y: 0 })} className="flex-1 rounded-lg border border-slate-800 py-1.5 text-xs font-semibold text-slate-400 hover:text-ink">Center</button>
      </div>
      <p className="text-[11px] text-slate-500 mt-2 text-center">Drag to move · scroll or slide to zoom</p>
    </div>
  )
}

const TEXT_COLORS = ['#fbe9c4', '#ffffff', '#e8b35a', '#f2d38a', '#d9dde3', '#e8a48e', '#8fb6ff', '#6fd3a2', '#c79bff', '#f5a3c7', '#e05252', '#1c1206']
// Colours for the page edges: papers, metals and inks
const EDGE_PALETTE = [
  { name: 'Cream', color: '#efe2c4' }, { name: 'White', color: '#f7f4ee' }, { name: 'Gold', color: '#d6b168' }, { name: 'Silver', color: '#c9ccd1' },
  { name: 'Copper', color: '#b87333' }, { name: 'Rose', color: '#e2a3a8' }, { name: 'Red', color: '#8a2b2b' }, { name: 'Blue', color: '#2c4a7a' },
  { name: 'Green', color: '#2f5a3c' }, { name: 'Purple', color: '#5a3a7a' }, { name: 'Black', color: '#1a1714' }, { name: 'Sky', color: '#8fb2ff' },
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

/** A slider with its value shown */
export function ValueSlider({ label, min, max, step, value, unit = '', onChange }: { label: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void }) {
  const shown = step >= 1 ? String(Math.round(value)) : max <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1)
  return (
    <label className="mt-2.5 flex items-center gap-3">
      <span className="text-xs font-semibold text-slate-500 w-[92px] shrink-0 truncate">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0 accent-[#7a5230]" />
      <span className="text-[11px] tabular-nums text-slate-500 w-9 text-right shrink-0">{shown}{unit}</span>
    </label>
  )
}

/** A colour: a row of swatches, or any colour at all from the picker at the end */
export function ColorPick({ label, value, palette, onChange }: { label: string; value: string; palette: Array<{ name: string; color: string }>; onChange: (c: string) => void }) {
  const custom = !palette.some((c) => c.color.toLowerCase() === value.toLowerCase())
  return (
    <div className="mt-2.5 flex items-start gap-3">
      <span className="text-xs font-semibold text-slate-500 w-[92px] shrink-0 pt-1 truncate">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {palette.map((c) => (
          <button key={c.color} type="button" onClick={() => onChange(c.color)} title={c.name} aria-label={`${label}: ${c.name}`}
            className={cn('w-6 h-6 rounded-full border border-black/20 transition-transform hover:scale-110', value.toLowerCase() === c.color.toLowerCase() && 'ring-2 ring-offset-2 ring-offset-[#f6eedb] ring-[#7a5a3a] scale-110')}
            style={{ background: c.color }} />
        ))}
        {/* Any colour: shows the picked one once it's not a swatch */}
        <label className={cn('relative w-6 h-6 rounded-full border border-black/20 overflow-hidden cursor-pointer transition-transform hover:scale-110', custom && 'ring-2 ring-offset-2 ring-offset-[#f6eedb] ring-[#7a5a3a] scale-110')}
          title="Any colour" style={{ background: custom ? value : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label={`${label}: any colour`} />
        </label>
      </div>
    </div>
  )
}
