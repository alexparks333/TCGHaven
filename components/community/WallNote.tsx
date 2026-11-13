'use client'

// One Creator Wall note (docs/creators.md "Creator Wall"), drawn the same everywhere: on the board, opened big,
// and in the owner's note editor — where the words are typed straight onto the note and every choice shows
// at once. A note is paper (NOTE_COLOURS), held by a pin or tape, with words and/or a picture shown whole
// (never cropped) wherever the owner put it: above, below, left or right of the words (NoteLook). Flat on
// purpose — no fake-3D shading.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ImagePlus, Loader2, Trash2, Scissors, AlignLeft, AlignCenter, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react'
import { badgeArt } from '@/lib/badgeAssets'
import { NOTE_COLOURS, type NoteLook, type WallPost } from '@/lib/communityBlocks'
import { luminance, mix } from '@/lib/blockStyle'
import { uploadCreatorPicture, uploadCreatorPng } from '@/lib/creatorUpload'
import { STICKER_SHAPES, makeSticker } from '@/lib/stickerCut'
import { cn } from '@/lib/utils'

export const PINS = ['#b8402f', '#3f6e8c', '#5d7a3a', '#b8862b', '#7a4a8c']

/** A pushpin, flat: a round cap, its waist and flange in two shades of the pin colour, a steel point */
export function PushPin({ color, tilt = -12 }: { color: string; tilt?: number }) {
  const dark = mix(color, '#000000', 0.32), light = mix(color, '#ffffff', 0.38)
  return (
    <svg width="29" height="37" viewBox="0 0 22 28" aria-hidden className="absolute left-1/2 -top-[20px] -translate-x-1/2 pointer-events-none z-[1]" style={{ rotate: `${tilt}deg` }}>
      <path d="M11 17.5 L12.6 27" stroke="#8d939b" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="11" cy="17.2" rx="6.2" ry="2.1" fill={dark} />
      <path d="M8 9.5 h6 v7.3 a3 1.1 0 0 1 -6 0 Z" fill={dark} />
      <ellipse cx="11" cy="7.6" rx="8" ry="5.4" fill={color} />
      <ellipse cx="11" cy="9.6" rx="8" ry="3.2" fill={dark} opacity="0.35" />
      <ellipse cx="8.4" cy="5.6" rx="2.6" ry="1.5" fill={light} />
    </svg>
  )
}

/** Two strips of tape across the top corners, flat, with torn ends */
export function Tape() {
  const strip = 'absolute -top-2 w-[58px] h-[19px] pointer-events-none z-[1] [clip-path:polygon(4%_0,12%_10%,8%_25%,14%_42%,6%_58%,12%_75%,5%_100%,95%_100%,88%_85%,94%_68%,87%_50%,95%_33%,89%_16%,96%_0)]'
  const look = { background: 'repeating-linear-gradient(90deg, rgba(246,238,219,0.86) 0 3px, rgba(236,225,198,0.86) 3px 6px)' }
  return <>
    <span className={cn(strip, '-left-4 -rotate-[38deg]')} style={look} />
    <span className={cn(strip, '-right-4 rotate-[38deg]')} style={look} />
  </>
}

/** A steady little number from a post's id — its tilt and pin colour stay the same every visit */
export function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }

/** A polaroid's frame: classic instant-film white, cream, black, and the colour editions */
export const POLAROID_FRAMES = [
  { id: 'white', name: 'Classic white', color: '#f3f1ea' },
  { id: 'cream', name: 'Cream', color: '#ebe2cc' },
  { id: 'black', name: 'Black', color: '#1f1e21' },
  { id: 'blue', name: 'Blue', color: '#3d6ea6' },
  { id: 'red', name: 'Red', color: '#c23f37' },
  { id: 'yellow', name: 'Yellow', color: '#ecc84a' },
  { id: 'green', name: 'Green', color: '#4d8a5a' },
  { id: 'orange', name: 'Orange', color: '#e27d3a' },
  { id: 'pink', name: 'Pink', color: '#eaa6b8' },
  { id: 'sky', name: 'Sky', color: '#9cc7e2' },
]

export const NOTE_FONTS: Array<{ id: NonNullable<NoteLook['font']>; name: string; css: string; k: number }> = [
  { id: 'print', name: 'Print', css: 'var(--b-body-font, inherit)', k: 1 },
  { id: 'hand', name: 'Handwritten', css: 'var(--font-caveat), cursive', k: 1.3 },
  { id: 'type', name: 'Typewriter', css: 'var(--font-elite), "Courier New", monospace', k: 0.95 },
  { id: 'serif', name: 'Elegant', css: 'var(--font-cormorant), Georgia, serif', k: 1.15 },
]
const TEXT_PX = { s: 13, m: 15, l: 19 }
const PIC_W = { top: { s: 55, m: 78, l: 100 }, side: { s: 34, m: 45, l: 56 } }

export const paperOf = (p: Pick<WallPost, 'note' | 'image'>) => NOTE_COLOURS.find((c) => c.id === p.note)?.color ?? (p.image ? '#fbf8f1' : NOTE_COLOURS[0].color)
export const inkOn = (paper: string) => (luminance(paper) > 0.3 ? '#2b2014' : '#f3ead6')

/** One note. `holder` is already worked out (the note's own choice, else the board's). `edit`: the words are a
 *  text box on the note itself (the editor). `full`: opened big — nothing cut short. */
export function NoteCard({ post, holder, pinColor, tilt = 0, full, edit, onClick, className, children, top }: {
  post: Pick<WallPost, 'id' | 'text' | 'image' | 'note' | 'look' | 'at'>
  holder: 'pin' | 'tape' | 'none'
  pinColor: string
  tilt?: number
  full?: boolean
  edit?: { value: string; onChange: (v: string) => void }
  onClick?: () => void
  className?: string
  children?: React.ReactNode // under the words (the time, the reactions)
  top?: React.ReactNode      // over the note's corner (the owner's buttons)
}) {
  const l = post.look ?? {}
  const polaroid = l.kind === 'polaroid'
  const paper = paperOf(post), ink = inkOn(paper)
  const font = NOTE_FONTS.find((f) => f.id === (l.font ?? (polaroid ? 'hand' : 'print')))!
  const pic = l.pic ?? 'top', side = pic === 'left' || pic === 'right'
  const w = (side ? PIC_W.side : PIC_W.top)[l.picSize ?? (side ? 'm' : 'l')]
  const frame = l.frame ?? 'photo'
  const textStyle: React.CSSProperties = { fontFamily: font.css, fontSize: TEXT_PX[l.size ?? 'm'] * font.k, textAlign: l.align ?? 'left', color: ink, lineHeight: 1.35 }
  const hasWords = !!post.text || !!edit

  const picture = post.image && (
    <div className={cn('shrink-0', !side && 'mx-auto', frame === 'photo' && 'bg-[#fdfbf6] p-1.5 pb-2 border border-black/10', frame === 'line' && 'border p-0.5')}
      style={{ width: `${w}%`, ...(frame === 'line' && { borderColor: mix(ink, paper, 0.55) }) }}>
      {/* the whole picture, at its own shape — never cropped */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={badgeArt(post.image, full ? 1600 : 800)} alt="" className="block w-full h-auto" />
    </div>
  )
  const words = hasWords && (
    edit
      ? <AutoText value={edit.value} onChange={edit.onChange} style={textStyle} placeholder="Write on your note…" />
      : <p className={cn('whitespace-pre-line break-words', !full && 'line-clamp-[10]')} style={textStyle}>{post.text}</p>
  )

  // A sticker: just the die-cut picture (its white border is baked into the PNG — lib/stickerCut.ts), with a
  // small shadow where it lifts off the board
  if (l.kind === 'sticker') {
    return (
      <article onClick={onClick} style={{ '--tilt': `${tilt}deg` } as React.CSSProperties} className={cn('cork-note relative', onClick && 'cursor-pointer', className)}>
        {top}
        {post.image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={badgeArt(post.image, full ? 1200 : 640)} alt="" draggable={false} className="block w-full h-auto [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.35))_drop-shadow(0_3px_5px_rgba(0,0,0,0.18))]" />
          : <div className="aspect-square rounded-full border-2 border-dashed border-white/70 flex items-center justify-center text-xs font-bold text-white/80">Add a photo</div>}
      </article>
    )
  }

  // A polaroid, like the real thing: a matte instant-film frame (classic white, black or a colour edition) with
  // thin even borders and the deep strip at the bottom; a square photo (or the whole picture, if the owner
  // chose) sitting a touch recessed with a soft sheen; the caption in marker on the strip
  if (polaroid) {
    const pf = POLAROID_FRAMES.find((f) => f.id === l.pframe) ?? POLAROID_FRAMES[0]
    const marker = luminance(pf.color) > 0.3 ? '#25242a' : '#f2f0e9'
    const capStyle: React.CSSProperties = { ...textStyle, color: marker, textAlign: l.align ?? 'center', lineHeight: 1.15 }
    const whole = l.fit === 'whole'
    const caption = edit
      ? <AutoText value={edit.value} onChange={edit.onChange} style={capStyle} placeholder="Write a caption…" min={30} />
      : post.text && <p className={cn('whitespace-pre-line break-words', !full && 'line-clamp-2')} style={capStyle}>{post.text}</p>
    return (
      <article onClick={onClick} style={{ '--tilt': `${tilt}deg`, background: pf.color, color: marker, padding: '5.5% 5.5% 0' } as React.CSSProperties}
        className={cn('cork-note polaroid relative shadow-[0_1px_2px_rgba(0,0,0,0.3)]', onClick && 'cursor-pointer', className)}>
        {holder === 'tape' && <Tape />}
        {holder === 'pin' && <PushPin color={pinColor} tilt={[-14, -6, 8, 14][hash(post.id) % 4]} />}
        {top}
        <div className={cn('polaroid-photo relative overflow-hidden bg-[#131211]', !whole && 'aspect-square')}>
          {post.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={badgeArt(post.image, full ? 1600 : 800)} alt="" className={cn('block w-full', whole ? 'h-auto' : 'h-full object-cover')} />
            : <div className="aspect-square flex items-center justify-center text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30">No photo yet</div>}
        </div>
        {/* the deep bottom strip: always at least a polaroid's share of the width, taller if the caption needs it */}
        <div className="grid">
          <span className="col-start-1 row-start-1 pt-[24%]" aria-hidden />
          <div className="col-start-1 row-start-1 self-center px-1 py-2">{caption}</div>
        </div>
        {children && <div className="pb-2 -mt-1">{children}</div>}
      </article>
    )
  }

  return (
    <article onClick={onClick} style={{ '--tilt': `${tilt}deg`, background: paper, color: ink } as React.CSSProperties}
      className={cn('cork-note relative border border-black/10', post.image && !hasWords ? 'p-2.5 pb-2' : 'px-4 pt-5 pb-3', onClick && 'cursor-pointer', className)}>
      {holder === 'tape' && <Tape />}
      {holder === 'pin' && <PushPin color={pinColor} tilt={[-14, -6, 8, 14][hash(post.id) % 4]} />}
      {top}
      {side ? (
        <div className={cn('flex items-start gap-3', pic === 'right' && 'flex-row-reverse')}>
          {picture}
          <div className="flex-1 min-w-0">{words}</div>
        </div>
      ) : (
        <>
          {pic === 'top' && picture}
          {words && <div className={cn(post.image && (pic === 'top' ? 'mt-2.5' : 'mb-2.5'))}>{words}</div>}
          {pic === 'bottom' && picture}
        </>
      )}
      {children}
    </article>
  )
}

/** A text box that grows with its words — looks exactly like the note's text */
function AutoText({ value, onChange, style, placeholder, min = 72 }: { value: string; onChange: (v: string) => void; style: React.CSSProperties; placeholder: string; min?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => { const t = ref.current; if (t) { t.style.height = '0px'; t.style.height = `${Math.max(t.scrollHeight, min)}px` } })
  return (
    <textarea ref={ref} value={value} maxLength={2000} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={1} autoFocus
      className="block w-full resize-none bg-transparent outline-none placeholder:opacity-45" style={{ ...style, color: style.color }} />
  )
}

/** The owner's note editor: the note on a piece of the board, typed on directly, with its choices beside it.
 *  `post` given = changing that note; otherwise a new one. */
export function NoteEditor({ uid, post, startKind, board, boardHolder, onSave, onClose }: {
  uid: string
  post?: WallPost
  board: React.CSSProperties          // the board's surface, so the note's seen where it'll hang
  boardHolder: 'pin' | 'tape' | 'none' | 'mixed'
  startKind?: NoteLook['kind'] // a new one starts as this (the Sticker button)
  onSave: (n: { text: string; image?: string; note?: string; look: NoteLook }) => Promise<void>
  onClose: () => void
}) {
  const [text, setText] = useState(post?.text ?? '')
  // a sticker keeps its original photo here (look.src); the cut PNG is made from it as the choices change
  const [image, setImage] = useState<string | undefined>(post?.look?.kind === 'sticker' ? post.look.src ?? post.image : post?.image)
  const [cut, setCut] = useState<{ key: string; blob: Blob; url: string } | null>(null)
  const [cutting, setCutting] = useState(false)
  const [note, setNote] = useState(post?.note ?? '') // '' = the kind's own (paper for a note, white for a polaroid)
  const [look, setLook] = useState<NoteLook>(post?.look ?? (startKind ? { kind: startKind } : {}))
  const [busy, setBusy] = useState<'' | 'pic' | 'save'>('')
  const [err, setErr] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const put = (p: Partial<NoteLook>) => setLook((l) => ({ ...l, ...p }))
  const sticker = look.kind === 'sticker'
  const origImage = post?.look?.kind === 'sticker' ? post.look.src ?? post.image : post?.image
  const cutKey = JSON.stringify([image, look.shape ?? 'cutout', look.border ?? 2, look.tol ?? 42])
  // the sticker, cut afresh (a moment after the last change) whenever its photo, shape, border or sensitivity changes
  useEffect(() => {
    if (!sticker || !image) return
    let live = true
    const t = setTimeout(async () => {
      setCutting(true)
      try {
        const blob = await makeSticker(image, look.shape ?? 'cutout', look.border ?? 2, look.tol ?? 42)
        if (live) setCut((old) => { if (old) URL.revokeObjectURL(old.url); return { key: cutKey, blob, url: URL.createObjectURL(blob) } })
      } catch { if (live) setErr('Couldn\'t cut that picture — try another.') }
      finally { if (live) setCutting(false) }
    }, 160)
    return () => { live = false; clearTimeout(t) }
  }, [sticker, cutKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = !post || text !== post.text || image !== origImage || note !== (post.note ?? '') || JSON.stringify(look) !== JSON.stringify(post.look ?? {})
  const empty = sticker ? !image : !text.trim() && !image

  // Esc closes (asking first if there's unsaved work)
  const close = () => { if (!changed || empty || confirm('Close without pinning this up? Your note won\'t be kept.')) onClose() }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })

  async function pick(f: File | undefined) {
    if (!f) return
    setBusy('pic'); setErr('')
    try { setImage(await uploadCreatorPicture(uid, f, 'wall')) } catch { setErr('That picture didn\'t upload — try another.') } finally { setBusy('') }
  }
  async function save() {
    if (empty) return
    setBusy('save'); setErr('')
    try {
      if (sticker) {
        // the finished sticker: the cut made from these exact choices (unchanged since it was put up = keep it)
        const same = post?.look?.kind === 'sticker' && image === origImage && JSON.stringify(look) === JSON.stringify(post.look)
        let url = post?.image
        if (!same) {
          const c = cut?.key === cutKey ? cut : { blob: await makeSticker(image!, look.shape ?? 'cutout', look.border ?? 2, look.tol ?? 42) }
          url = await uploadCreatorPng(uid, c.blob)
        }
        await onSave({ text: '', image: url, look: { ...look, src: image } })
      } else await onSave({ text: text.trim(), image, note: note || undefined, look: { ...look, src: undefined, shape: undefined, border: undefined, tol: undefined } })
      onClose()
    }
    catch { setErr('Couldn\'t save it — check your connection and try again.'); setBusy('') }
  }

  const holder = look.holder ?? (boardHolder === 'mixed' ? (image ? 'tape' : 'pin') : boardHolder)
  const preview = { id: post?.id ?? 'new', text, image: sticker ? cut?.url : image, note, look, at: post?.at ?? Date.now() }
  const pic = look.pic ?? 'top'

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={post ? 'Change this note' : 'Pin up a note'}>
      <div className="absolute inset-0 bg-[#2b2014]/60" onClick={close} />
      <div className="relative w-full max-w-5xl max-h-[94vh] flex flex-col md:flex-row overflow-hidden rounded-[10px] border border-[#2b2014]/20 bg-[#f6eedb] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)]">
        {/* the note, hanging on a piece of the board */}
        {/* a sticker sits in the middle of the board; a note hangs from near the top */}
        <div className={cn('relative md:flex-1 min-h-[300px] overflow-y-auto flex justify-center px-6', sticker ? 'items-center py-10' : 'items-start pt-12 pb-10')} style={board}>
          <div className={cn('w-full relative', sticker ? 'max-w-[300px]' : 'max-w-[360px]')}>
            {sticker && cutting && <Loader2 size={20} className="absolute -top-8 left-1/2 -translate-x-1/2 animate-spin text-[#2b2014]" />}
            <NoteCard post={preview} holder={holder} pinColor={look.pinColor || PINS[0]} tilt={0} full edit={{ value: text, onChange: setText }}>
              {!image && !sticker && (
                <button type="button" onClick={() => file.current?.click()} disabled={!!busy}
                  className="mt-3 w-full rounded-sm border border-dashed py-2 text-xs font-bold inline-flex items-center justify-center gap-1.5 opacity-70 hover:opacity-100"
                  style={{ borderColor: 'currentColor' }}>
                  {busy === 'pic' ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Add a picture
                </button>
              )}
            </NoteCard>
          </div>
        </div>

        {/* its choices */}
        <div className="md:w-[330px] shrink-0 flex flex-col border-t md:border-t-0 md:border-l border-[#2b2014]/15 min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2014]/10">
            <p className="font-bold text-[#2b2014]">{post ? `Change this ${sticker ? 'sticker' : 'note'}` : sticker ? 'Make a sticker' : 'Pin up a note'}</p>
            <button type="button" onClick={close} className="p-1 text-[#5c4a35] hover:text-[#2b2014]" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-[#2b2014]">
            <Part label="Kind">
              <div className="grid grid-cols-3 gap-1.5">
                {([['note', 'Note'], ['polaroid', 'Polaroid'], ['sticker', 'Sticker']] as const).map(([id, name]) => {
                  const on = (look.kind ?? 'note') === id
                  return (
                    <button key={id} type="button" onClick={() => put({ kind: id === 'note' ? undefined : id })} aria-pressed={on}
                      className={cn('rounded-md border p-2 flex flex-col items-center gap-1.5 text-xs font-bold', on ? 'border-[#7a5230] bg-[#7a5230] text-[#fbf6ea]' : 'border-[#2b2014]/20 hover:bg-black/5')}>
                      {/* a little drawing of each */}
                      {id === 'note'
                        ? <span className="w-9 h-10 bg-[#f1e2a4] border border-black/15 -rotate-3 flex flex-col gap-1 p-1.5 pt-2.5"><i className="h-[2px] bg-black/25" /><i className="h-[2px] bg-black/25" /><i className="h-[2px] w-2/3 bg-black/25" /></span>
                        : id === 'polaroid'
                        ? <span className="w-9 h-11 bg-[#f3f1ea] border border-black/15 rotate-3 p-[3px] pb-[11px]"><i className="block w-full aspect-square bg-[#2c3440]" /></span>
                        : <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="-rotate-6"><path d="M20 3l4.9 10.6 11.6 1.3-8.7 7.9 2.4 11.4L20 28.4 9.8 34.2l2.4-11.4L3.5 14.9l11.6-1.3z" fill="#e6b84a" stroke="#fff" strokeWidth="3" strokeLinejoin="round" /></svg>}
                      {name}
                    </button>
                  )
                })}
              </div>
            </Part>

            {!sticker && <Part label={look.kind === 'polaroid' ? 'Frame' : 'Paper'}>
              {look.kind === 'polaroid' ? (
                <div className="flex flex-wrap gap-1.5">
                  {POLAROID_FRAMES.map((c, i) => {
                    const on = (look.pframe ?? 'white') === c.id
                    return (
                      <button key={c.id} type="button" onClick={() => put({ pframe: i === 0 ? undefined : c.id })} title={c.name} aria-label={`Frame: ${c.name}`} aria-pressed={on}
                        className={cn('w-7 h-8 rounded-[2px] border border-black/20 p-[3px] pb-[9px]', on && 'outline outline-2 outline-offset-2 outline-[#7a5230]')} style={{ background: c.color }}>
                        <i className="block w-full h-full bg-[#2c3440]" />
                      </button>
                    )
                  })}
                </div>
              ) : (
              <div className="flex flex-wrap gap-1.5">
                {NOTE_COLOURS.map((c) => (
                  <button key={c.id} type="button" onClick={() => setNote(c.id)} title={c.name} aria-label={`Paper: ${c.name}`} aria-pressed={note === c.id}
                    className={cn('w-7 h-7 rounded-[3px] border border-black/20', note === c.id && 'outline outline-2 outline-offset-2 outline-[#7a5230]')} style={{ background: c.color }} />
                ))}
              </div>
              )}
            </Part>}

            <Part label={sticker ? 'Photo' : 'Picture'}>
              {image ? (
                <>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => file.current?.click()} disabled={!!busy} className="flex-1 rounded-md border border-[#2b2014]/20 py-1.5 text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-black/5">
                      {busy === 'pic' ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Change picture
                    </button>
                    <button type="button" onClick={() => setImage(undefined)} className="rounded-md border border-[#2b2014]/20 px-2.5 text-xs font-bold inline-flex items-center gap-1 hover:bg-black/5" aria-label="Take the picture off"><Trash2 size={13} /></button>
                  </div>
                  {sticker ? (<>
                  <p className="mt-3 mb-1 text-[11px] font-semibold text-[#5c4a35]">Shape</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {STICKER_SHAPES.map((sh) => {
                      const on = (look.shape ?? 'cutout') === sh.id
                      return (
                        <button key={sh.id} type="button" onClick={() => put({ shape: sh.id === 'cutout' ? undefined : sh.id })} aria-pressed={on} title={sh.name}
                          className={cn('rounded-md border pt-2 pb-1 px-0.5 flex flex-col items-center gap-1 text-[10px] font-semibold leading-tight', on ? 'border-[#7a5230] bg-[#7a5230] text-[#fbf6ea]' : 'border-[#2b2014]/20 text-[#4a3320] hover:bg-black/5')}>
                          {/* the shape itself, drawn from the same outline that cuts the photo */}
                          <span className="h-7 flex items-center justify-center">
                            {sh.id === 'cutout'
                              ? <Scissors size={20} strokeWidth={1.8} />
                              : <svg viewBox={`-3 -3 ${sh.w + 6} ${sh.h + 6}`} className="h-7 w-auto max-w-[32px]" aria-hidden>
                                  <path d={sh.d} fill={on ? '#f3d58a' : '#c9a35c'} stroke={on ? '#fbf6ea' : '#fbf6ea'} strokeWidth="5" strokeLinejoin="round" paintOrder="stroke" />
                                </svg>}
                          </span>
                          <span className="truncate max-w-full">{sh.name}</span>
                        </button>
                      )
                    })}
                  </div>
                  {(look.shape ?? 'cutout') === 'cutout' && (<>
                    <p className="mt-2 text-[11px] text-[#5c4a35]">Cut out takes away a plain background (like a photo on white). For a busy photo, pick a shape.</p>
                    <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-[#5c4a35]">
                      <span className="shrink-0">Cut</span>
                      <input type="range" min={10} max={110} step={2} value={look.tol ?? 42} onChange={(e) => put({ tol: Number(e.target.value) })} className="flex-1 accent-[#7a5230]" aria-label="How much background to cut away" />
                      <span className="shrink-0">More</span>
                    </label>
                  </>)}
                  <p className="mt-3 mb-1 text-[11px] font-semibold text-[#5c4a35]">White border</p>
                  <Seg value={String(look.border ?? 2) as '0' | '1' | '2'} onPick={(v) => put({ border: Number(v) as 0 | 1 | 2 })}
                    options={[{ id: '0', name: 'None' }, { id: '1', name: 'Thin' }, { id: '2', name: 'Thick' }]} />
                  </>) : look.kind === 'polaroid' ? (<>
                  <p className="mt-3 mb-1 text-[11px] font-semibold text-[#5c4a35]">Photo</p>
                  <Seg value={look.fit ?? 'square'} onPick={(v) => put({ fit: v === 'square' ? undefined : v })}
                    options={[{ id: 'square', name: 'Square, like a polaroid' }, { id: 'whole', name: 'Whole picture' }]} />
                  </>) : (<>
                  <p className="mt-3 mb-1 text-[11px] font-semibold text-[#5c4a35]">Where it goes</p>
                  <Seg value={pic} onPick={(v) => put({ pic: v === 'top' ? undefined : v })} options={[
                    { id: 'top', name: 'Above', icon: <ArrowUp size={13} /> }, { id: 'bottom', name: 'Below', icon: <ArrowDown size={13} /> },
                    { id: 'left', name: 'Left', icon: <ArrowLeft size={13} /> }, { id: 'right', name: 'Right', icon: <ArrowRight size={13} /> },
                  ]} />
                  <p className="mt-3 mb-1 text-[11px] font-semibold text-[#5c4a35]">Size</p>
                  <Seg value={look.picSize ?? (pic === 'left' || pic === 'right' ? 'm' : 'l')} onPick={(v) => put({ picSize: v })}
                    options={[{ id: 's', name: 'Small' }, { id: 'm', name: 'Medium' }, { id: 'l', name: 'Large' }]} />
                  <p className="mt-3 mb-1 text-[11px] font-semibold text-[#5c4a35]">Edge</p>
                  <Seg value={look.frame ?? 'photo'} onPick={(v) => put({ frame: v === 'photo' ? undefined : v })}
                    options={[{ id: 'photo', name: 'Photo border' }, { id: 'line', name: 'Thin line' }, { id: 'none', name: 'None' }]} />
                  </>)}
                </>
              ) : (
                <button type="button" onClick={() => file.current?.click()} disabled={!!busy} className="w-full rounded-md border border-dashed border-[#2b2014]/30 py-2 text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-black/5">
                  {busy === 'pic' ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Add a picture
                </button>
              )}
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f) }} />
            </Part>

            {!sticker && <Part label="Words">
              <div className="grid grid-cols-2 gap-1.5">
                {NOTE_FONTS.map((f) => (
                  <button key={f.id} type="button" onClick={() => put({ font: f.id })} aria-pressed={(look.font ?? (look.kind === 'polaroid' ? 'hand' : 'print')) === f.id}
                    className={cn('rounded-md border py-1.5 text-[13px]', (look.font ?? (look.kind === 'polaroid' ? 'hand' : 'print')) === f.id ? 'border-[#7a5230] bg-[#7a5230] text-[#fbf6ea]' : 'border-[#2b2014]/20 hover:bg-black/5')}
                    style={{ fontFamily: f.css, fontSize: 13 * f.k }}>{f.name}</button>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <div className="flex-1"><Seg value={look.size ?? 'm'} onPick={(v) => put({ size: v === 'm' ? undefined : v })} options={[{ id: 's', name: 'Small' }, { id: 'm', name: 'Medium' }, { id: 'l', name: 'Large' }]} /></div>
                <Seg value={look.align ?? (look.kind === 'polaroid' ? 'center' : 'left')} onPick={(v) => put({ align: v })} options={[
                  { id: 'left', name: '', icon: <AlignLeft size={14} />, label: 'Align left' }, { id: 'center', name: '', icon: <AlignCenter size={14} />, label: 'Centre' },
                ]} />
              </div>
            </Part>}

            {!sticker && <Part label="Held up by">
              <Seg value={look.holder ?? 'board'} onPick={(v) => put({ holder: v === 'board' ? undefined : v })}
                options={[{ id: 'board', name: 'The board’s' }, { id: 'pin', name: 'Pin' }, { id: 'tape', name: 'Tape' }, { id: 'none', name: 'Nothing' }]} />
              {holder === 'pin' && (
                <div className="mt-2 flex gap-1.5">
                  {PINS.map((c, i) => (
                    <button key={c} type="button" onClick={() => put({ pinColor: i === 0 ? undefined : c })} aria-label="Pin colour" aria-pressed={(look.pinColor || PINS[0]) === c}
                      className={cn('w-6 h-6 rounded-full border border-black/20', (look.pinColor || PINS[0]) === c && 'outline outline-2 outline-offset-2 outline-[#7a5230]')} style={{ background: c }} />
                  ))}
                </div>
              )}
            </Part>}
          </div>
          <div className="flex items-center gap-2 px-4 py-3 border-t border-[#2b2014]/10">
            {err && <p className="flex-1 text-xs font-semibold text-[#9b2c1f]">{err}</p>}
            {!err && <span className="flex-1" />}
            <button type="button" onClick={close} className="px-3 py-1.5 text-sm font-bold text-[#5c4a35] hover:text-[#2b2014]">Cancel</button>
            <button type="button" onClick={save} disabled={!!busy || empty || !changed}
              className="rounded-md bg-[#7a5230] px-4 py-2 text-sm font-bold text-[#fbf6ea] disabled:opacity-40 inline-flex items-center gap-1.5">
              {busy === 'save' && <Loader2 size={14} className="animate-spin" />}{post ? 'Save changes' : sticker ? 'Stick it on' : 'Pin it up'}
            </button>
          </div>
        </div>
      </div>
    </div>, document.body)
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#7a5a3a] mb-1.5">{label}</p>
      {children}
    </div>
  )
}

function Seg<T extends string>({ value, onPick, options }: { value: T; onPick: (v: T) => void; options: Array<{ id: T; name: string; icon?: React.ReactNode; label?: string }> }) {
  return (
    <div className="flex rounded-md border border-[#2b2014]/20 overflow-hidden">
      {options.map((o, i) => (
        <button key={o.id} type="button" onClick={() => onPick(o.id)} aria-pressed={value === o.id} aria-label={o.label}
          className={cn('flex-1 px-2 py-1.5 text-[11.5px] font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap', i > 0 && 'border-l border-[#2b2014]/15',
            value === o.id ? 'bg-[#7a5230] text-[#fbf6ea]' : 'text-[#4a3320] hover:bg-black/5')}>
          {o.icon}{o.name}
        </button>
      ))}
    </div>
  )
}
