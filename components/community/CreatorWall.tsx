'use client'

// The Creator Wall as fans see it (docs/creators.md "Creator Wall"): the creator's posts pinned to a flat
// board (cork by default — its surface, colour, frame, holders, tilt and columns are the block's Style → Board) — words on paper notes held by a pin, pictures as prints held by tape — each turned a little,
// newest first. Tap one to read it whole. Under each, the reactions (lib/wallReactions.ts): members and the
// creator tap ♥ / 👍 / 🃏, everyone sees the counts. Flat on purpose — no fake-3D shading.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X, Heart, ThumbsUp } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { Section, timeAgo, type BlockContext } from '@/components/community/blocks'
import { badgeArt } from '@/lib/badgeAssets'
import { NOTE_COLOURS, type Block, type WallPost } from '@/lib/communityBlocks'
import { REACTIONS, useWallReactions, type ReactionDef } from '@/lib/wallReactions'
import { surfaceCss, wallLook } from '@/lib/blockStyle'
import { cn } from '@/lib/utils'

const PINS = ['#b8402f', '#3f6e8c', '#5d7a3a', '#b8862b', '#7a4a8c']

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
  const posts = [...block.posts].sort((a, b) => b.at - a.at)
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
      <div className="rounded-md p-4 sm:p-6" style={board}>
        {posts.length === 0 ? (
          <div className="mx-auto max-w-[240px] -rotate-2 bg-[#f6eedb] border border-[#2b2014]/10 px-5 pt-6 pb-5 text-center relative">
            {w.holders !== 'none' && <span className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-3 h-3 rounded-full border border-black/20" style={{ background: pinOf(0) }} />}
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
                  {holder === 'tape' && <span className="absolute left-1/2 -top-2.5 w-16 h-5 -translate-x-1/2 bg-[#f3ead2]/75 border border-[#2b2014]/[0.06]" style={{ rotate: `${-tilt * 1.5 || -2}deg` }} />}
                  {holder === 'pins' || holder === 'pin' ? <span className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-3 h-3 rounded-full border border-black/20" style={{ background: pinOf(h) }} /> : null}
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
