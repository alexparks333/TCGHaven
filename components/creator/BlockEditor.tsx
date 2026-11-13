'use client'

// The Creator Studio's block builder (docs/creators.md "Community page blocks"): the "+" menu of blocks
// to add, and the side-panel editor for the block that's selected on the page. Everything saves itself
// with the rest of the community page (CommunityStudio).

import { useRef, useState } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { ArrowLeft, ImagePlus, Loader2, Megaphone, Pin, PinOff, Sparkles, Trash2, Trophy, Type, Image as ImageIcon, LayoutGrid, MessagesSquare, Info, X, Palette, PenLine } from 'lucide-react'
import { Portal } from '@/components/creator/Portal'
import { shrink } from '@/components/creator/CoverDesigner'
import { CardPicker } from '@/components/creator/BadgeMaker'
import { BlockStyleEditor } from '@/components/creator/BlockStyleEditor'
import { appStorage } from '@/lib/firebase/appStorage'
import { badgeArt } from '@/lib/badgeAssets'
import { BLOCK_TYPES, MAX_POSTS, blockName, newId, type Block, type BlockType } from '@/lib/communityBlocks'
import type { Community } from '@/lib/creatorBooks'
import { cn } from '@/lib/utils'

const ICONS: Record<BlockType, typeof Type> = {
  about: Info, badges: Trophy, wall: Sparkles, announcements: Megaphone, cards: LayoutGrid, text: Type, picture: ImageIcon, board: MessagesSquare,
}

/** "+": pick a block to add */
export function AddBlockMenu({ onPick, onClose, has }: { onPick: (t: BlockType) => void; onClose: () => void; has: (t: BlockType) => boolean }) {
  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[#2b2014]/50 backdrop-blur-[2px]" onClick={onClose} />
        <div role="dialog" aria-modal="true" aria-label="Add a block" className="haven-panel haven-grain relative w-full max-w-2xl !p-6 shadow-[0_30px_60px_-20px_rgba(40,25,10,0.6)]">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="pinbook-serif text-xl font-bold text-ink flex-1">Add a block</h2>
            <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-ink" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {BLOCK_TYPES.map((b) => {
              const Icon = ICONS[b.type]
              // About and Badge Achievements go on a page once
              const once = (b.type === 'about' || b.type === 'badges') && has(b.type)
              const off = !b.ready || once
              return (
                <button key={b.type} type="button" disabled={off} onClick={() => onPick(b.type)}
                  className="group flex items-start gap-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3.5 text-left hover:border-[#7a5230] hover:shadow-[0_6px_16px_-10px_rgba(40,25,10,0.6)] transition disabled:opacity-50 disabled:cursor-default disabled:hover:border-[#d6c49f] disabled:hover:shadow-none">
                  <span className="haven-medallion w-10 h-10 shrink-0"><Icon size={17} /></span>
                  <span className="min-w-0">
                    <span className="block font-bold text-ink">{b.name}{!b.ready && <span className="ml-2 rounded-full bg-[#e6d7b6] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 align-middle">Coming soon</span>}</span>
                    <span className="block text-xs text-slate-500 mt-0.5">{once ? 'Already on this page' : b.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Portal>
  )
}

/** A picture upload to the creator's folder — returns its URL */
function useUpload(uid: string) {
  const [busy, setBusy] = useState(false)
  const up = async (file: File | undefined): Promise<string | null> => {
    if (!file) return null
    setBusy(true)
    try {
      const blob = await shrink(file)
      const r = ref(appStorage, `creators/${uid}/blk-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`)
      await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' })
      return await getDownloadURL(r)
    } catch { return null } finally { setBusy(false) }
  }
  return { busy, up }
}

const label = 'block text-[11px] font-semibold text-slate-500'

/** The side-panel editor for the block selected on the page */
export function BlockEditor({ uid, block, community, mode, onMode, onChange, onCommunity, onDone, onDelete }: {
  uid: string; block: Block; community: Community
  mode: 'content' | 'style'; onMode: (m: 'content' | 'style') => void   // what's in it, or how it looks (the palette)
  onChange: (b: Block) => void; onCommunity: (p: Partial<Community>) => void; onDone: () => void; onDelete: () => void
}) {
  const Icon = ICONS[block.type]
  return (
    <div className="haven-panel">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onDone} className="p-1.5 -ml-1 rounded-lg text-slate-500 hover:text-ink" aria-label="Back"><ArrowLeft size={16} /></button>
        <span className="haven-medallion w-8 h-8"><Icon size={15} /></span>
        <p className="pinbook-serif font-bold text-ink flex-1 truncate">{blockName(block.type)}</p>
        <button type="button" onClick={onDelete} className="p-1.5 rounded-lg text-slate-500 hover:text-red-600" aria-label="Delete this block"><Trash2 size={15} /></button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-[#e6d7b6]/70 p-1">
        {([['content', 'Content', PenLine], ['style', 'Style', Palette]] as const).map(([k, name, I]) => (
          <button key={k} type="button" onClick={() => onMode(k)}
            className={cn('flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-colors', mode === k ? 'bg-[#fbf6ea] text-ink shadow-sm' : 'text-slate-500 hover:text-ink')}>
            <I size={13} />{name}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {mode === 'style'
          ? <BlockStyleEditor block={block} onChange={onChange} />
          : <Fields uid={uid} block={block} community={community} onChange={onChange} onCommunity={onCommunity} />}
      </div>
      <button type="button" onClick={onDone} className="mt-4 w-full btn-primary justify-center">Done</button>
    </div>
  )
}

function TitleField({ value, placeholder, onChange }: { value?: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <label className={label}>Title
      <input value={value ?? ''} maxLength={40} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-field mt-1 text-sm font-semibold" />
    </label>
  )
}

function Fields({ uid, block, community, onChange, onCommunity }: { uid: string; block: Block; community: Community; onChange: (b: Block) => void; onCommunity: (p: Partial<Community>) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const { busy, up } = useUpload(uid)
  switch (block.type) {
    case 'about':
      return (
        <label className={label}><span className="flex justify-between">About your community<span className="font-normal tabular-nums">{community.about.length}/600</span></span>
          <textarea value={community.about} maxLength={600} onChange={(e) => onCommunity({ about: e.target.value })} className="input-field mt-1 text-sm min-h-[160px] resize-y" placeholder="Who you are, what you collect, what members get…" />
        </label>
      )
    case 'badges':
      return <><TitleField value={block.title} placeholder="Badge Achievements" onChange={(title) => onChange({ ...block, title })} />
        <p className="mt-2 text-[11px] text-slate-500">Fills itself: the newest members to earn one of your published badges.</p></>
    case 'board':
      return <TitleField value={block.title} placeholder="Community Board" onChange={(title) => onChange({ ...block, title })} />
    case 'text':
      return (
        <>
          <TitleField value={block.title} placeholder="A heading" onChange={(title) => onChange({ ...block, title })} />
          <label className={cn(label, 'mt-3')}><span className="flex justify-between">Text<span className="font-normal tabular-nums">{block.body.length}/4000</span></span>
            <textarea value={block.body} maxLength={4000} onChange={(e) => onChange({ ...block, body: e.target.value })} className="input-field mt-1 text-sm min-h-[180px] resize-y" placeholder="Write anything for your members." />
          </label>
        </>
      )
    case 'picture':
      return (
        <>
          {block.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badgeArt(block.image, 640)} alt="" className="w-full h-36 object-cover rounded-xl border border-[#d6c49f]" />
          )}
          <button type="button" onClick={() => file.current?.click()} disabled={busy} className="mt-2 w-full haven-chip py-2 text-sm font-semibold inline-flex items-center justify-center gap-2">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}{block.image ? 'Change picture' : 'Upload a picture'}
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const url = await up(e.target.files?.[0]); if (url) onChange({ ...block, image: url }); e.target.value = '' }} />
          <label className={cn(label, 'mt-3')}>Caption <span className="font-normal">· optional</span>
            <input value={block.caption ?? ''} maxLength={120} onChange={(e) => onChange({ ...block, caption: e.target.value })} className="input-field mt-1 text-sm" />
          </label>
        </>
      )
    case 'wall': return <WallFields uid={uid} block={block} onChange={onChange} />
    case 'announcements': return <AnnouncementFields block={block} onChange={onChange} />
    case 'cards':
      return (
        <>
          <TitleField value={block.title} placeholder="Highlighted Cards" onChange={(title) => onChange({ ...block, title })} />
          <label className={cn(label, 'mt-3')}>A line under the title <span className="font-normal">· optional</span>
            <input value={block.note ?? ''} maxLength={120} onChange={(e) => onChange({ ...block, note: e.target.value })} className="input-field mt-1 text-sm" placeholder="e.g. My favourite pulls this month" />
          </label>
          <div className="mt-4 -mx-1">
            <CardPicker slots={block.cards} onChange={(cards) => onChange({ ...block, cards: cards.slice(0, 40) })}
              title="Cards to show off" hint="Search or browse the Cardex — tap cards to add them (up to 40)." />
          </div>
        </>
      )
  }
}

/** The Creator Wall: write a post (words, a picture) — it goes on top; earlier ones can be removed */
function WallFields({ uid, block, onChange }: { uid: string; block: Extract<Block, { type: 'wall' }>; onChange: (b: Block) => void }) {
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | undefined>()
  const file = useRef<HTMLInputElement>(null)
  const { busy, up } = useUpload(uid)
  const post = () => {
    if (!text.trim() && !image) return
    onChange({ ...block, posts: [{ id: newId(), text: text.trim(), image, at: Date.now() }, ...block.posts].slice(0, MAX_POSTS) })
    setText(''); setImage(undefined)
  }
  return (
    <>
      <TitleField value={block.title} placeholder="Creator Wall" onChange={(title) => onChange({ ...block, title })} />
      <div className="mt-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">New post</p>
        <textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} className="input-field mt-1.5 text-sm min-h-[100px] resize-y" placeholder="Share something with your members…" />
        {image && (
          <div className="relative mt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={badgeArt(image, 640)} alt="" className="w-full h-28 object-cover rounded-lg" />
            <button type="button" onClick={() => setImage(undefined)} className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/55 text-white" aria-label="Remove the picture"><X size={13} /></button>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => file.current?.click()} disabled={busy} className="haven-chip px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}Picture
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const url = await up(e.target.files?.[0]); if (url) setImage(url); e.target.value = '' }} />
          <button type="button" onClick={post} disabled={!text.trim() && !image} className="ml-auto btn-primary !py-1.5 disabled:opacity-40">Post to the wall</button>
        </div>
      </div>
      {block.posts.length > 0 && (
        <div className="mt-3">
          <p className={label}>On the wall · {block.posts.length}</p>
          <div className="mt-1.5 space-y-1.5 max-h-[260px] overflow-y-auto scroll-themed pr-1">
            {block.posts.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-[#d6c49f] px-2.5 py-1.5">
                <span className="min-w-0 flex-1 text-xs text-ink truncate">{p.text || '(a picture)'}</span>
                <button type="button" onClick={() => { if (confirm('Take this post off the wall?')) onChange({ ...block, posts: block.posts.filter((x) => x.id !== p.id) }) }}
                  className="p-1 text-slate-500 hover:text-red-600" aria-label="Remove this post"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/** Announcements: write one (title, text, pinned or not); pin, unpin or remove the ones there */
function AnnouncementFields({ block, onChange }: { block: Extract<Block, { type: 'announcements' }>; onChange: (b: Block) => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const add = () => {
    if (!title.trim()) return
    const items = pinned ? block.items.map((a) => ({ ...a, pinned: false })) : block.items // one pinned at a time
    onChange({ ...block, items: [{ id: newId(), title: title.trim(), body: body.trim(), at: Date.now(), pinned }, ...items].slice(0, 50) })
    setTitle(''); setBody(''); setPinned(false)
  }
  return (
    <>
      <TitleField value={block.title} placeholder="Announcements" onChange={(t) => onChange({ ...block, title: t })} />
      <div className="mt-3 rounded-xl border border-[#d6c49f] bg-[#f6eedb] p-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">New announcement</p>
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="input-field mt-1.5 text-sm font-semibold" placeholder="e.g. New badge drops Friday" />
        <textarea value={body} maxLength={1500} onChange={(e) => setBody(e.target.value)} className="input-field mt-1.5 text-sm min-h-[80px] resize-y" placeholder="The details…" />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => setPinned((p) => !p)} className={cn('haven-chip px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5', pinned && 'haven-chip-on')}><Pin size={12} />{pinned ? 'Pinned' : 'Pin it'}</button>
          <button type="button" onClick={add} disabled={!title.trim()} className="ml-auto btn-primary !py-1.5 disabled:opacity-40">Announce</button>
        </div>
      </div>
      {block.items.length > 0 && (
        <div className="mt-3 space-y-1.5 max-h-[260px] overflow-y-auto scroll-themed pr-1">
          {block.items.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 rounded-lg border border-[#d6c49f] px-2.5 py-1.5">
              <span className="min-w-0 flex-1 text-xs font-semibold text-ink truncate">{a.title}</span>
              <button type="button" title={a.pinned ? 'Unpin' : 'Pin to the top'}
                onClick={() => onChange({ ...block, items: block.items.map((x) => ({ ...x, pinned: x.id === a.id ? !a.pinned : false })) })}
                className={cn('p-1', a.pinned ? 'text-[#8a6420]' : 'text-slate-500 hover:text-ink')}>{a.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
              <button type="button" onClick={() => { if (confirm('Remove this announcement?')) onChange({ ...block, items: block.items.filter((x) => x.id !== a.id) }) }}
                className="p-1 text-slate-500 hover:text-red-600" aria-label="Remove"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
