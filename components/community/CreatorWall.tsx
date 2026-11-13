'use client'

// The Creator Wall as fans see it (docs/creators.md "Creator Wall"): the creator's posts pinned to a flat
// board (cork by default — its surface, colour, frame, holders, tilt and columns are the block's Style → Board) — words on paper notes held by a pin, pictures as prints held by tape — each turned a little,
// newest first. Tap one to read it whole. Under each, the reactions (lib/wallReactions.ts): members and the
// creator tap ♥ / 👍 / 🃏, everyone sees the counts. Flat on purpose — no fake-3D shading.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X, Heart, ThumbsUp, Plus, Pencil, Move, Check } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { timeAgo, useLook, type BlockContext } from '@/components/community/blocks'
import { NoteCard, NoteEditor, PINS, PushPin, Tape, hash } from '@/components/community/WallNote'
import { BOARD_W, WallBoard } from '@/components/community/WallBoard'
import { type Block, type WallPost } from '@/lib/communityBlocks'
import { REACTIONS, useWallReactions, type ReactionDef } from '@/lib/wallReactions'
import { lookVars, luminance, mix, surfaceCss, wallLook } from '@/lib/blockStyle'
import { addPost, editPost, removePost, useBlockPosts } from '@/lib/communityPosts'
import { cn } from '@/lib/utils'

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
  const posts: Array<WallPost & { live?: boolean }> = [...live.map((p) => ({ id: p.id, text: p.text, image: p.image, note: p.note, look: p.look, place: p.place, at: p.at, live: true })), ...block.posts]
    .sort((a, b) => b.at - a.at)
  const [open, setOpen] = useState<WallPost | null>(null)
  const [editing, setEditing] = useState<WallPost | 'new' | null>(null) // the owner's note editor
  const [arranging, setArranging] = useState(false) // the owner moving, turning and sizing notes on the board
  const [selected, setSelected] = useState<string | null>(null)
  const rx = useWallReactions(ctx.uid, user?.uid ?? null, posts.map((p) => p.id))
  const canReact = !!user && !!ctx.canReact
  const w = wallLook(block.style?.wall) // the board: its surface, frame, holders, tilt, columns (Style → Board)
  const pinOf = (h: number) => w.pinColor || PINS[h % PINS.length]
  // held up the note's own way, else the board's (Style → Board → Held by; "mixed": tape for pictures, pins for words)
  const holderOf = (p: WallPost): 'pin' | 'tape' | 'none' => p.look?.holder ?? (w.holders === 'mixed' ? (p.image ? 'tape' : 'pin') : w.holders === 'pins' ? 'pin' : w.holders as 'tape' | 'none')
  const l = useLook()
  // The whole block is the board: its surface edge to edge inside a slim frame, the title written at the
  // top of it. Words on it are in the board's own ink — dark on a light board, cream on a dark one.
  const ink = luminance(w.color) > 0.32 ? '#2b2014' : '#f6ead0'
  const board = {
    ...lookVars(l),
    ...surfaceCss(w.surface, w.color, w.texture),
    border: w.frame === 'none' ? 'none' : `${w.frame === 'thin' ? 3 : 9}px solid ${w.frameColor}`,
    borderRadius: l.radius,
    '--b-accent': ink, '--b-line': mix(ink, w.color, 0.55), '--b-hover': mix(ink, w.color, 0.9),
  } as React.CSSProperties

  const Reactions = ({ p }: { p: WallPost }) => (
    <div className="mt-2.5 flex flex-wrap gap-1">
      {REACTIONS.map((r) => {
        const n = rx.count(p.id, r.id), on = rx.mine(p.id, r.id)
        return (
          <button key={r.id} type="button" disabled={!canReact}
            onClick={(e) => { e.stopPropagation(); rx.toggle(p.id, r.id) }}
            title={canReact ? r.name : 'Join the community to react'} aria-label={`${r.name}${n ? ` · ${n}` : ''}`} aria-pressed={on}
            className={cn('inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition-colors',
              on ? 'border-current bg-[color-mix(in_srgb,currentColor_12%,transparent)]' : 'border-[color-mix(in_srgb,currentColor_22%,transparent)]',
              canReact ? 'hover:border-current' : 'cursor-default', !n && !on && 'opacity-60')}>
            <ReactionIcon r={r} size={13} />{n > 0 && n}
          </button>
        )
      })}
    </div>
  )

  // isolate: the buttons' "always above the notes" stays inside the wall — never over a popup (the note editor, an opened note)
  return (
    <section className="relative isolate px-4 pt-4 pb-5 sm:px-6 sm:pt-5 sm:pb-6" style={board}>
      <header className="mb-4 flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="font-bold flex items-center gap-2.5 leading-tight [&>svg]:shrink-0"
            style={{ fontFamily: l.titleFont, fontSize: `${1.25 * l.titleSize}rem`, color: ink }}><Sparkles size={19} />{block.title || 'Creator Wall'}</h2>
          <p className="text-xs mt-1" style={{ color: mix(ink, w.color, 0.18) }}>Pinned up by {ctx.community.name}</p>
        </div>
        {ctx.owner && (
          // the owner, top right of the board: write a note, then place it (drag, turn, size)
          // always above the notes, even one placed over the corner
          <div className="relative z-[100] flex gap-2 shrink-0">
            {!arranging && (
              <button type="button" onClick={() => setEditing('new')}
                className="rounded-md bg-[#2b2014]/45 px-3.5 py-2 text-sm font-bold text-[#fbf6ea] inline-flex items-center gap-1.5 hover:bg-[#2b2014]/85 transition-colors">
                <Plus size={16} />New note
              </button>
            )}
            {posts.some((p) => p.live) && (
              <button type="button" onClick={() => { setArranging((a) => !a); setSelected(null) }}
                // arranging is for a computer (on a phone the notes stack)
                className={cn('hidden sm:inline-flex rounded-md px-3.5 py-2 text-sm font-bold items-center gap-1.5 transition-colors',
                  arranging ? 'bg-[#2b2014]/80 text-[#fbf6ea] hover:bg-[#2b2014]/90' : 'bg-[#f6eedb]/45 text-[#2b2014] border border-[#2b2014]/20 hover:bg-[#f6eedb]/85')}>
                {arranging ? <><Check size={16} />Done arranging</> : <><Move size={16} />Arrange the board</>}
              </button>
            )}
          </div>
        )}
      </header>
      <div>
        {posts.length === 0 ? (
          <div className="mx-auto max-w-[240px] -rotate-2 bg-[#f6eedb] border border-[#2b2014]/10 px-5 pt-6 pb-5 text-center relative">
            {/* the empty note is held up the way the creator chose (Style → Board → Held by) */}
            {w.holders === 'tape' ? <Tape /> : w.holders !== 'none' && <PushPin color={pinOf(0)} />}
            <p className="text-sm text-[#5c4a35]">Nothing pinned up yet.</p>
          </div>
        ) : (
          <WallBoard posts={posts} arranging={arranging} selected={selected} onSelect={setSelected} tiltK={w.tilt} columns={w.columns}
            onOpen={(p) => { if (p.look?.kind !== 'sticker') setOpen(p) }} onPlace={(id, place) => { editPost(id, { place }).catch(() => alert('Couldn\'t save where that note goes — check your connection.')) }}
            renderNote={(p) => {
              const h = hash(p.id)
              return (
                <NoteCard post={p} holder={holderOf(p)} pinColor={p.look?.pinColor || pinOf(h)}
                  top={ctx.owner && p.live && !arranging && (
                    // the owner's own note: change it, or take it down
                    <span className="absolute -top-2.5 -right-2.5 z-[2] flex gap-1 opacity-0 [.cork-note:hover_&]:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button type="button" aria-label="Change this note" title="Change this note" onClick={(e) => { e.stopPropagation(); setEditing(p) }}
                        className="w-7 h-7 rounded-full bg-[#2b2014] text-[#fbf6ea] flex items-center justify-center"><Pencil size={13} /></button>
                      <button type="button" aria-label="Take this note down" title="Take this note down"
                        onClick={(e) => { e.stopPropagation(); if (confirm('Take this note off the wall? This can\'t be undone.')) removePost(p.id).catch(() => alert('Couldn\'t take it down — check your connection.')) }}
                        className="w-7 h-7 rounded-full bg-[#2b2014] text-[#fbf6ea] flex items-center justify-center"><X size={14} /></button>
                    </span>
                  )}>
                  {/* a polaroid keeps its strip for the caption: just the reactions under it (the time shows when opened);
                      a sticker is decoration — nothing under it */}
                  {p.look?.kind !== 'polaroid' && p.look?.kind !== 'sticker' && <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-50">{timeAgo(p.at)}</p>}
                  {p.look?.kind !== 'sticker' && <Reactions p={p} />}
                </NoteCard>
              )
            }} />
        )}
      </div>

      {open && !arranging && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={() => setOpen(null)}>
          <div className="fixed inset-0 bg-[#2b2014]/55" />
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="relative w-full max-w-xl my-auto">
            <NoteCard post={open} holder={holderOf(open)} pinColor={open.look?.pinColor || pinOf(hash(open.id))} full className="!p-5 sm:!p-7"
              top={<button type="button" onClick={() => setOpen(null)} className="absolute top-2 right-2 z-[2] p-1.5 opacity-60 hover:opacity-100" aria-label="Close"><X size={18} /></button>}>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-50">{ctx.community.name} · {timeAgo(open.at)}</p>
              <Reactions p={open} />
            </NoteCard>
          </div>
        </div>, document.body)}
      {editing && ctx.owner && (
        <NoteEditor uid={ctx.uid} post={typeof editing === 'string' ? undefined : editing} board={surfaceCss(w.surface, w.color, w.texture)}
          boardHolder={w.holders === 'pins' ? 'pin' : w.holders}
          onSave={async (n) => {
            if (typeof editing === 'string') {
              // it goes up near the top middle of the board, a little turned, on top of the others — then the
              // board opens for arranging with it picked, so the owner can put it exactly where they want
              const z = Math.max(0, ...posts.map((p) => p.place?.z ?? 0)) + 1
              const id = await addPost({ community: ctx.uid, block: block.id, kind: 'wall', text: n.text, image: n.image, note: n.note, look: n.look,
                place: { x: BOARD_W / 2, y: 190, r: [-3, 2, -1.5, 3.5][Date.now() % 4] * (n.look.kind === 'sticker' ? 3 : 1), s: n.look.kind === 'sticker' ? 0.7 : 1, z } })
              setArranging(true); setSelected(id)
            }
            else await editPost(editing.id, { text: n.text, note: n.note, look: n.look, image: n.image ?? null })
          }}
          onClose={() => setEditing(null)} />
      )}
    </section>
  )
}
