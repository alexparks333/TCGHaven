'use client'

// The Creator Wall as fans see it (docs/creators.md "Creator Wall"): the creator's posts pinned to a flat
// board (cork by default — its surface, colour, frame, holders, tilt and columns are the block's Style → Board) — words on paper notes held by a pin, pictures as prints held by tape — each turned a little,
// newest first. Tap one to read it whole. Under each, the reactions (lib/wallReactions.ts): members and the
// creator tap ♥ / 👍 / 🃏, everyone sees the counts. Flat on purpose — no fake-3D shading.

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X, Heart, ThumbsUp, Plus, ImagePlus, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { Section, timeAgo, type BlockContext } from '@/components/community/blocks'
import { badgeArt } from '@/lib/badgeAssets'
import { NOTE_COLOURS, type Block, type WallPost } from '@/lib/communityBlocks'
import { REACTIONS, useWallReactions, type ReactionDef } from '@/lib/wallReactions'
import { mix, surfaceCss, wallLook } from '@/lib/blockStyle'
import { addPost, removePost, useBlockPosts } from '@/lib/communityPosts'
import { uploadCreatorPicture } from '@/lib/creatorUpload'
import { cn } from '@/lib/utils'

const PINS = ['#b8402f', '#3f6e8c', '#5d7a3a', '#b8862b', '#7a4a8c']

/** A pushpin, flat: a round cap, its waist and flange in two shades of the pin colour, a steel point */
function PushPin({ color, tilt = -12 }: { color: string; tilt?: number }) {
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
function Tape() {
  const strip = 'absolute -top-2 w-[58px] h-[19px] pointer-events-none z-[1] [clip-path:polygon(4%_0,12%_10%,8%_25%,14%_42%,6%_58%,12%_75%,5%_100%,95%_100%,88%_85%,94%_68%,87%_50%,95%_33%,89%_16%,96%_0)]'
  const look = { background: 'repeating-linear-gradient(90deg, rgba(246,238,219,0.86) 0 3px, rgba(236,225,198,0.86) 3px 6px)' }
  return <>
    <span className={cn(strip, '-left-4 -rotate-[38deg]')} style={look} />
    <span className={cn(strip, '-right-4 rotate-[38deg]')} style={look} />
  </>
}

/** A steady little number from a post's id — its tilt and pin colour stay the same every visit */
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }

export function ReactionIcon({ r, size = 15 }: { r: ReactionDef; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (r.art) return <img src={r.art} alt="" width={size} height={size} className="object-contain" />
  if (r.id === 'heart') return <Heart size={size} className="text-[#b8402f]" fill="#b8402f" strokeWidth={1.5} />
  if (r.id === 'thumbs') return <ThumbsUp size={size} className="text-[#8a6420]" fill="#d6a957" strokeWidth={1.5} />
  // a trading card: a flat card with a star
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="#f6eedb" stroke="#7a5230" strokeWidth="1.2" />
      <rect x="4.6" y="3.1" width="6.8" height="5.4" rx="0.6" fill="#3f6e8c" />
      <path d="M8 3.9 8.6 5.3 10 5.4 8.9 6.3 9.3 7.7 8 6.9 6.7 7.7 7.1 6.3 6 5.4 7.4 5.3Z" fill="#e0b866" />
      <path d="M5 10.2h6M5 12h4" stroke="#a8875c" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  )
}

export function CreatorWall({ block, ctx }: { block: Extract<Block, { type: 'wall' }>; ctx: BlockContext }) {
  const { user } = useAuth()
  // The owner's posts (community_posts, put up on the page) and any older ones saved inside the block
  const live = useBlockPosts(ctx.uid, block.id)
  const posts: Array<WallPost & { live?: boolean }> = [...live.map((p) => ({ id: p.id, text: p.text, image: p.image, note: p.note, at: p.at, live: true })), ...block.posts]
    .sort((a, b) => b.at - a.at)
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<WallPost | null>(null)
  const rx = useWallReactions(ctx.uid, user?.uid ?? null, posts.map((p) => p.id))
  const canReact = !!user && !!ctx.canReact
  const w = wallLook(block.style?.wall) // the board: its surface, frame, holders, tilt, columns (Style → Board)
  const SHOWN = w.shown
  const shown = all ? posts : posts.slice(0, SHOWN)
  const pinOf = (h: number) => w.pinColor || PINS[h % PINS.length]
  const board: React.CSSProperties = { ...surfaceCss(w.surface, w.color, w.texture), border: w.frame === 'none' ? 'none' : `${w.frame === 'thin' ? 2 : 6}px solid ${w.frameColor}` }
  const cols = w.columns === 1 ? 'columns-1' : w.columns === 3 ? 'columns-1 sm:columns-2 lg:columns-3' : 'columns-1 sm:columns-2'

  const Reactions = ({ p }: { p: WallPost }) => (
    <div className="mt-2.5 flex flex-wrap gap-1">
      {REACTIONS.map((r) => {
        const n = rx.count(p.id, r.id), on = rx.mine(p.id, r.id)
        return (
          <button key={r.id} type="button" disabled={!canReact}
            onClick={(e) => { e.stopPropagation(); rx.toggle(p.id, r.id) }}
            title={canReact ? r.name : 'Join the community to react'} aria-label={`${r.name}${n ? ` · ${n}` : ''}`} aria-pressed={on}
            className={cn('inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition-colors',
              on ? 'border-[#7a5230] bg-[#7a5230]/[0.12] text-[#4a3320]' : 'border-[#2b2014]/15 text-[#5c4a35]',
              canReact ? 'hover:border-[#7a5230]' : 'cursor-default', !n && !on && 'opacity-60')}>
            <ReactionIcon r={r} size={13} />{n > 0 && n}
          </button>
        )
      })}
    </div>
  )

  return (
    <Section title={block.title || 'Creator Wall'} icon={<Sparkles size={19} />} sub={`Pinned up by ${ctx.community.name}`}>
      {ctx.owner && <WallComposer uid={ctx.uid} block={block.id} />}
      <div className="rounded-md p-4 sm:p-6" style={board}>
        {posts.length === 0 ? (
          <div className="mx-auto max-w-[240px] -rotate-2 bg-[#f6eedb] border border-[#2b2014]/10 px-5 pt-6 pb-5 text-center relative">
            {/* the empty note is held up the way the creator chose (Style → Board → Held by) */}
            {w.holders === 'tape' ? <Tape /> : w.holders !== 'none' && <PushPin color={pinOf(0)} />}
            <p className="text-sm text-[#5c4a35]">Nothing pinned up yet.</p>
          </div>
        ) : (
          <div className={cn(cols, 'gap-6 pt-1')}>
            {shown.map((p) => {
              const h = hash(p.id), tilt = [-2.5, -1.5, -0.8, 0.8, 1.6, 2.4][h % 6] * w.tilt
              const holder = w.holders === 'mixed' ? (p.image ? 'tape' : 'pin') : w.holders
              const paper = NOTE_COLOURS.find((c) => c.id === p.note)?.color ?? (p.image ? '#fbf8f1' : NOTE_COLOURS[0].color)
              return (
                <article key={p.id} onClick={() => setOpen(p)} style={{ '--tilt': `${tilt}deg`, background: paper } as React.CSSProperties}
                  className={cn('cork-note relative cursor-pointer border border-[#2b2014]/10 break-inside-avoid mb-7 w-full inline-block align-top', p.image ? 'p-2.5 pb-3' : 'px-4 pt-5 pb-3')}>
                  {/* held up by tape (a picture) or a pin (words) — flat */}
                  {holder === 'tape' && <Tape />}
                  {holder === 'pins' || holder === 'pin' ? <PushPin color={pinOf(h)} tilt={[-14, -6, 8, 14][h % 4]} /> : null}
                  {ctx.owner && p.live && (
                    <button type="button" aria-label="Take this post down" title="Take this post down"
                      onClick={(e) => { e.stopPropagation(); if (confirm('Take this post off the wall? This can\'t be undone.')) removePost(p.id).catch(() => alert('Couldn\'t take it down — check your connection.')) }}
                      className="absolute -top-2 -right-2 z-[1] w-6 h-6 rounded-full bg-[#2b2014] text-[#fbf6ea] flex items-center justify-center opacity-0 [.cork-note:hover_&]:opacity-100 focus:opacity-100 transition-opacity"><X size={13} /></button>
                  )}
                  {p.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={badgeArt(p.image, 800)} alt="" className="w-full aspect-[4/3] object-cover" />
                  )}
                  {p.text && <p className={cn('text-[14px] leading-snug text-[#2b2014] whitespace-pre-line line-clamp-6', p.image && 'mt-2 px-0.5')}>{p.text}</p>}
                  <p className={cn('mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2b2014]/45', p.image && 'px-0.5')}>{timeAgo(p.at)}</p>
                  <div className={cn(p.image && 'px-0.5')}><Reactions p={p} /></div>
                </article>
              )
            })}
          </div>
        )}
      </div>
      {posts.length > SHOWN && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-3 w-full text-xs font-semibold text-[color:var(--b-accent)] hover:underline">
          {all ? 'Show fewer' : `See all ${posts.length} posts`}
        </button>
      )}

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div className="absolute inset-0 bg-[#2b2014]/55" />
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-xl max-h-[88vh] overflow-y-auto border border-[#2b2014]/15 p-5 sm:p-6"
            style={{ background: NOTE_COLOURS.find((c) => c.id === open.note)?.color ?? (open.image ? '#fbf8f1' : NOTE_COLOURS[0].color), fontFamily: 'var(--b-body-font)' }}>
            <button type="button" onClick={() => setOpen(null)} className="absolute top-2 right-2 p-1.5 text-[#5c4a35] hover:text-[#2b2014]" aria-label="Close"><X size={18} /></button>
            {open.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={badgeArt(open.image, 1600)} alt="" className="w-full max-h-[60vh] object-contain bg-black/5" />
            )}
            {open.text && <p className="mt-3 text-[15px] leading-relaxed text-[#2b2014] whitespace-pre-line">{open.text}</p>}
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2b2014]/45">{ctx.community.name} · {timeAgo(open.at)}</p>
            <Reactions p={open} />
          </div>
        </div>, document.body)}
    </Section>
  )
}

/** The owner's "Pin something up", right on their community page: words, a picture, the paper */
function WallComposer({ uid, block }: { uid: string; block: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | undefined>()
  const [note, setNote] = useState('paper')
  const [busy, setBusy] = useState<'' | 'pic' | 'post'>('')
  const [err, setErr] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const reset = () => { setText(''); setImage(undefined); setNote('paper'); setErr(''); setOpen(false) }
  async function post() {
    if (!text.trim() && !image) return
    setBusy('post'); setErr('')
    try { await addPost({ community: uid, block, kind: 'wall', text: text.trim(), image, note }); reset() }
    catch { setErr('Couldn\'t pin it up — check your connection and try again.') }
    finally { setBusy('') }
  }
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)}
      className="mb-4 w-full rounded-md border border-dashed border-[color:var(--b-line)] py-2.5 text-sm font-bold text-[color:var(--b-accent)] inline-flex items-center justify-center gap-2 hover:bg-[color:var(--b-hover)] transition-colors">
      <Plus size={16} />Pin something up
    </button>
  )
  const paper = NOTE_COLOURS.find((c) => c.id === note)!.color
  return (
    <div className="mb-4 rounded-md border border-[#2b2014]/15 p-3.5" style={{ background: paper }}>
      <textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoFocus
        placeholder="Write something for your members…" className="w-full min-h-[90px] resize-y bg-transparent text-[15px] text-[#2b2014] placeholder:text-[#2b2014]/40 outline-none" />
      {image && (
        <div className="relative mt-1 mb-2 w-40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badgeArt(image, 400)} alt="" className="w-40 aspect-[4/3] object-cover border-[6px] border-[#fbf8f1]" />
          <button type="button" onClick={() => setImage(undefined)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#2b2014] text-white flex items-center justify-center" aria-label="Remove the picture"><X size={11} /></button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-[#2b2014]/10 pt-2.5">
        <button type="button" onClick={() => file.current?.click()} disabled={!!busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#2b2014]/20 px-2.5 py-1 text-xs font-bold text-[#4a3320] hover:bg-black/5">
          {busy === 'pic' ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}Picture
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          setBusy('pic'); setErr('')
          try { setImage(await uploadCreatorPicture(uid, f, 'wall')) } catch { setErr('That picture didn\'t upload — try another.') } finally { setBusy('') }
        }} />
        <span className="flex items-center gap-1 ml-1">
          {NOTE_COLOURS.map((c) => (
            <button key={c.id} type="button" onClick={() => setNote(c.id)} title={c.name} aria-label={`Paper: ${c.name}`}
              className={cn('w-5 h-5 rounded-[3px] border border-black/20', note === c.id && 'outline outline-2 outline-offset-1 outline-[#7a5230]')} style={{ background: c.color }} />
          ))}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={reset} className="px-2.5 py-1 text-xs font-bold text-[#5c4a35] hover:text-[#2b2014]">Cancel</button>
        <button type="button" onClick={post} disabled={!!busy || (!text.trim() && !image)}
          className="rounded-md bg-[#7a5230] px-3 py-1.5 text-xs font-bold text-[#fbf6ea] disabled:opacity-40 inline-flex items-center gap-1.5">
          {busy === 'post' && <Loader2 size={12} className="animate-spin" />}Pin it up
        </button>
      </div>
      {err && <p className="mt-2 text-xs font-semibold text-[#9b2c1f]">{err}</p>}
    </div>
  )
}
