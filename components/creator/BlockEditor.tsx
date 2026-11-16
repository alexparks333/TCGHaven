'use client'

// The Creator Studio's block builder (docs/creators.md "Community page blocks"): the "+" menu of blocks
// to add, and the side-panel editor for the block that's selected on the page. Everything saves itself
// with the rest of the community page (CommunityStudio).

import { useRef, useState } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { ArrowLeft, ChevronLeft, ChevronRight, EyeOff, ImagePlus, Images, Loader2, Megaphone, Sparkles, Users, Trash2, Trophy, Type, Image as ImageIcon, LayoutGrid, MessagesSquare, Info, X, Palette, PenLine, ExternalLink } from 'lucide-react'
import { Toggle, ValueSlider } from '@/components/creator/CoverDesigner'
import { Portal } from '@/components/creator/Portal'
import { shrink } from '@/components/creator/CoverDesigner'
import { BlockStyleEditor, LookEditor } from '@/components/creator/BlockStyleEditor'
import { appStorage } from '@/lib/firebase/appStorage'
import { badgeArt } from '@/lib/badgeAssets'
import { BLOCK_TYPES, MAX_FRAME_IMAGES, blockName, type Block, type BlockType } from '@/lib/communityBlocks'
import type { Community, MembersLook } from '@/lib/creatorBooks'
import { Medal, MEDAL_STYLES } from '@/components/community/Medals'
import { cn } from '@/lib/utils'

const ICONS: Record<BlockType, typeof Type> = {
  about: Info, badges: Trophy, wall: Sparkles, announcements: Megaphone, cards: LayoutGrid, text: Type, picture: ImageIcon, frame: Images, board: MessagesSquare,
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
            {BLOCK_TYPES.filter((b) => !b.retired).map((b) => {
              const Icon = ICONS[b.type]
              // Badge Achievements goes on a page once
              const once = b.type === 'badges' && has(b.type)
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

/** The Members panel beside the page, picked in the Studio like a block: what it lists (Content) and its
 *  colours, fonts and finish (Style) — saved in communities/{uid}.page.members */
export function MembersEditor({ uid, community, mode, onMode, onChange, onDone, onHide }: {
  uid: string; community: Community; mode: 'content' | 'style'; onMode: (m: 'content' | 'style') => void
  onChange: (m: MembersLook) => void; onDone: () => void; onHide: () => void
}) {
  const m = community.page?.members ?? {}
  const o = { order: 'top' as 'top' | 'newest', shown: 12, detail: 'both' as 'both' | 'badges' | 'cards' | 'none', medals: true, bars: true, count: true, round: false, ...m }
  const put = (p: Partial<MembersLook>) => onChange({ ...m, ...p })
  return (
    <div className="haven-panel">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onDone} className="p-1.5 -ml-1 rounded-lg text-slate-500 hover:text-ink" aria-label="Back"><ArrowLeft size={16} /></button>
        <span className="haven-medallion w-8 h-8"><Users size={15} /></span>
        <p className="pinbook-serif font-bold text-ink flex-1 truncate">Members</p>
        <button type="button" onClick={onHide} className="p-1.5 rounded-lg text-slate-500 hover:text-ink" aria-label="Hide Members from the page" title="Hide from the page (Page details turns it back on)"><EyeOff size={15} /></button>
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
        {mode === 'style' ? <LookEditor type="members" style={m.style} what="panel" onStyle={(style) => { const n = { ...m }; if (style) n.style = style; else delete n.style; onChange(n) }} /> : <>
          <TitleField value={m.title} placeholder="Members" onChange={(title) => put({ title })} />
          <label className={cn(label, 'mt-3')}>The line under it
            <input value={m.sub ?? ''} maxLength={60} onChange={(e) => put({ sub: e.target.value })} className="input-field mt-1 text-sm" placeholder={o.order === 'newest' ? 'Newest first' : 'Top collectors first'} />
          </label>
          <Choice label="Order" value={o.order} options={[['top', 'Top collectors'], ['newest', 'Newest']]} onChange={(order) => put({ order })} />
          <Choice label="Under names" value={o.detail} options={[['both', 'Both'], ['badges', 'Badges'], ['cards', 'Cards'], ['none', 'None']]} onChange={(detail) => put({ detail })} />
          <Choice label="Pictures" value={o.round ? 'round' : 'square'} options={[['square', 'Rounded'], ['round', 'Circles']]} onChange={(v) => put({ round: v === 'round' })} />
          <ValueSlider label="How many shown" min={3} max={25} step={1} value={o.shown} onChange={(shown) => put({ shown })} />
          {o.order === 'top' && <>
            <div className="mt-4"><Toggle on={o.medals} onChange={(medals) => put({ medals })} label="Medals for the top three" hint="Gold, silver and bronze" /></div>
            {o.medals && <MedalFields uid={uid} m={m} put={put} />}
          </>}
          <div className="mt-3 space-y-2.5">
            <Toggle on={o.bars} onChange={(bars) => put({ bars })} label="Progress bars" hint="Badges earned out of your book’s total" />
            <Toggle on={o.count} onChange={(count) => put({ count })} label="Member count" hint="Beside the title" />
          </div>
        </>}
      </div>
      <button type="button" onClick={onDone} className="mt-4 w-full btn-primary justify-center">Done</button>
    </div>
  )
}

/** The top three's medals: the style (each tile shows the real medal), first place's glow, the podium rows,
 *  and — for "My pictures" — an upload for 1st, 2nd and 3rd */
function MedalFields({ uid, m, put }: { uid: string; m: MembersLook; put: (p: Partial<MembersLook>) => void }) {
  const style = m.medalStyle ?? 'ribbon'
  const art = [0, 1, 2].map((i) => m.medalArt?.[i] ?? '')
  const files = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const { busy, up } = useUpload(uid)
  const [busyAt, setBusyAt] = useState<number | null>(null)
  const setArt = (i: number, url: string) => put({ medalArt: art.map((a, j) => (j === i ? url : a)) })
  return (
    <div className="mt-2.5 rounded-xl border border-[#d6c49f] bg-[#f6eedb]/70 p-2.5">
      <p className={label}>Medal style</p>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {MEDAL_STYLES.map((s) => (
          <button key={s.id} type="button" onClick={() => put({ medalStyle: s.id })}
            className={cn('rounded-lg border px-1 pt-2 pb-1.5 flex flex-col items-center gap-1 transition-colors', style === s.id ? 'border-[#7a5230] bg-[#f6e7c4]' : 'border-[#d6c49f] bg-[#fbf6ea] hover:border-[#a8875c]')}>
            <span className="flex items-end gap-0.5 h-8">
              {s.id === 'custom' && !art.some(Boolean)
                ? <ImagePlus size={20} className="text-[#a8875c] mb-1" />
                : ([1, 0, 2] as const).map((p) => <Medal key={p} place={p} style={s.id} art={art[p] || undefined} size={p === 0 ? 22 : 17} />)}
            </span>
            <span className="text-[10px] font-bold text-slate-500">{s.name}</span>
          </button>
        ))}
      </div>
      {style === 'custom' && (
        <div className="mt-2.5">
          <p className="text-[11px] text-slate-500">Your own pictures — square ones with a see-through background look best. An empty place shows a plain medal.</p>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {(['1st', '2nd', '3rd'] as const).map((name, i) => (
              <div key={name} className="flex flex-col items-center gap-1">
                <button type="button" onClick={() => files[i].current?.click()} disabled={busy}
                  className="relative w-full aspect-square rounded-lg border border-dashed border-[#c4ae83] bg-[#fbf6ea] hover:border-[#7a5230] flex items-center justify-center overflow-hidden"
                  aria-label={`Upload the ${name} place picture`}>
                  {busyAt === i ? <Loader2 size={18} className="animate-spin text-slate-500" />
                    // eslint-disable-next-line @next/next/no-img-element
                    : art[i] ? <img src={art[i]} alt="" className="w-full h-full object-contain p-1" />
                    : <ImagePlus size={18} className="text-[#a8875c]" />}
                </button>
                <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">{name}
                  {art[i] && <button type="button" onClick={() => { if (confirm(`Take the ${name} place picture off?`)) setArt(i, '') }} className="p-0.5 hover:text-red-600" aria-label={`Remove the ${name} place picture`}><X size={11} /></button>}
                </span>
                <input ref={files[i]} type="file" accept="image/*" hidden
                  onChange={async (e) => { setBusyAt(i); const url = await up(e.target.files?.[0]); setBusyAt(null); if (url) setArt(i, url); e.target.value = '' }} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2.5">
        <Toggle on={m.shine ?? true} onChange={(shine) => put({ shine })} label="First place glows" hint="A soft glint every few seconds" />
        <Toggle on={m.podium ?? true} onChange={(podium) => put({ podium })} label="Podium rows" hint="The top three washed in gold, silver and bronze" />
      </div>
    </div>
  )
}

/** A row of choices, one picked */
function Choice<T extends string>({ label: name, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="mt-3">
      <p className={label}>{name}</p>
      <div className="mt-1 flex rounded-md border border-[#d6c49f] overflow-hidden">
        {options.map(([v, n]) => (
          <button key={v} type="button" onClick={() => onChange(v)}
            className={cn('flex-1 py-1.5 text-[11px] font-bold border-r border-[#d6c49f] last:border-r-0 transition-colors', value === v ? 'bg-[#7a5230] text-[#fbf6ea]' : 'bg-[#f6eedb] text-slate-500 hover:text-ink')}>{n}</button>
        ))}
      </div>
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
          <TitleField value={block.title} placeholder="A heading · optional" onChange={(title) => onChange({ ...block, title })} />
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
    case 'frame': return <FrameFields uid={uid} block={block} onChange={onChange} />
    case 'wall': return <WallFields uid={uid} block={block} onChange={onChange} />
    case 'announcements': return <AnnouncementFields uid={uid} block={block} onChange={onChange} />
    case 'cards':
      return (
        <>
          <TitleField value={block.title} placeholder="Highlighted Cards" onChange={(title) => onChange({ ...block, title })} />
          <label className={cn(label, 'mt-3')}>A line under the title <span className="font-normal">· optional</span>
            <input value={block.note ?? ''} maxLength={120} onChange={(e) => onChange({ ...block, note: e.target.value })} className="input-field mt-1 text-sm" placeholder="e.g. My favourite pulls this month" />
          </label>
          <PostedOnPage what="cards" uid={uid} />
          {block.cards.length > 0 && (
            <div className="mt-3">
              <p className={label}>Older cards saved with the page · {block.cards.length}</p>
              <div className="mt-1.5 space-y-1.5 max-h-[220px] overflow-y-auto scroll-themed pr-1">
                {block.cards.map((c, i) => (
                  <div key={c.cardIds.join() + i} className="flex items-center gap-2 rounded-md border border-[#d6c49f] px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 text-xs text-ink truncate">{c.label}</span>
                    <button type="button" onClick={() => { if (confirm(`Take ${c.label} off? This can't be undone.`)) onChange({ ...block, cards: block.cards.filter((_, j) => j !== i) }) }}
                      className="p-1 text-slate-500 hover:text-red-600" aria-label="Remove this card"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )
  }
}

/** The Creator Wall: write a post (words, a picture) — it goes on top; earlier ones can be removed */
/** What the owner puts up (wall posts, announcements) is posted on their community page itself — the Studio
 *  is only the layout and look. Here: the block's title, a pointer to the page, and any older posts that
 *  were saved inside the block (before posts moved to their own collection), which can still be taken down. */
function PostedOnPage({ what, uid }: { what: string; uid: string }) {
  return (
    <div className="mt-3 rounded-md border border-[#d6c49f] bg-[#f6eedb] p-3 text-xs text-slate-500 leading-relaxed">
      You add {what} <b className="text-ink">right on your community page</b> — open it while signed in and use the
      button at the top of this block. The Studio is just for its layout and look.
      <a href={`/c/${uid}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1.5 font-bold text-[#7a5230] hover:underline"><ExternalLink size={12} />Open my community page</a>
    </div>
  )
}

/** Digital Frame: up to MAX_FRAME_IMAGES pictures (uploaded several at once), put in order, and how long each shows */
function FrameFields({ uid, block, onChange }: { uid: string; block: Extract<Block, { type: 'frame' }>; onChange: (b: Block) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const { busy, up } = useUpload(uid)
  const [failed, setFailed] = useState(0)
  const imgs = block.images
  const room = MAX_FRAME_IMAGES - imgs.length
  async function add(files: FileList | null) {
    const list = Array.from(files ?? []).slice(0, room)
    let next = [...imgs], bad = 0
    for (const f of list) {
      const url = await up(f)
      if (url) { next = [...next, url]; onChange({ ...block, images: next }) } else bad++
    }
    setFailed(bad)
  }
  const move = (i: number, d: number) => { const n = [...imgs]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange({ ...block, images: n }) }
  return (
    <>
      <TitleField value={block.title} placeholder="A title · optional" onChange={(title) => onChange({ ...block, title })} />
      <p className={cn(label, 'mt-3')}>Pictures · {imgs.length}/{MAX_FRAME_IMAGES}</p>
      {imgs.length > 0 && (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {imgs.map((src, i) => (
            <div key={src + i} className="group relative aspect-square rounded-md overflow-hidden border border-[#d6c49f] bg-[#f6eedb]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={badgeArt(src, 320)} alt="" className="w-full h-full object-cover" />
              <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 text-[10px] font-bold text-white tabular-nums">{i + 1}</span>
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/45 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-white disabled:opacity-30" aria-label="Show earlier"><ChevronLeft size={14} /></button>
                <button type="button" onClick={() => { if (confirm('Take this picture out of the frame?')) onChange({ ...block, images: imgs.filter((_, j) => j !== i) }) }}
                  className="p-1 text-white hover:text-red-300" aria-label="Remove this picture"><Trash2 size={13} /></button>
                <button type="button" disabled={i === imgs.length - 1} onClick={() => move(i, 1)} className="p-1 text-white disabled:opacity-30" aria-label="Show later"><ChevronRight size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => file.current?.click()} disabled={busy || room <= 0} className="mt-2 w-full haven-chip py-2 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        {room <= 0 ? 'The frame is full' : imgs.length ? 'Add more pictures' : 'Upload pictures'}
      </button>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={async (e) => { await add(e.target.files); e.target.value = '' }} />
      {failed > 0 && <p className="mt-1.5 text-[11px] text-red-600">{failed === 1 ? 'One picture' : `${failed} pictures`} didn’t upload — check your connection and try again.</p>}
      <ValueSlider label="Each shows for" min={2} max={20} step={1} value={block.seconds ?? 5} unit="s" onChange={(seconds) => onChange({ ...block, seconds })} />
    </>
  )
}

function WallFields({ uid, block, onChange }: { uid: string; block: Extract<Block, { type: 'wall' }>; onChange: (b: Block) => void }) {
  return (
    <>
      <TitleField value={block.title} placeholder="Creator Wall" onChange={(title) => onChange({ ...block, title })} />
      <PostedOnPage what="posts" uid={uid} />
      {block.posts.length > 0 && (
        <div className="mt-3">
          <p className={label}>Older posts saved with the page · {block.posts.length}</p>
          <div className="mt-1.5 space-y-1.5 max-h-[220px] overflow-y-auto scroll-themed pr-1">
            {block.posts.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-md border border-[#d6c49f] px-2.5 py-1.5">
                <span className="min-w-0 flex-1 text-xs text-ink truncate">{p.text || '(a picture)'}</span>
                <button type="button" onClick={() => { if (confirm('Take this post off the wall? This can\'t be undone.')) onChange({ ...block, posts: block.posts.filter((x) => x.id !== p.id) }) }}
                  className="p-1 text-slate-500 hover:text-red-600" aria-label="Remove this post"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function AnnouncementFields({ uid, block, onChange }: { uid: string; block: Extract<Block, { type: 'announcements' }>; onChange: (b: Block) => void }) {
  return (
    <>
      <TitleField value={block.title} placeholder="Announcements" onChange={(title) => onChange({ ...block, title })} />
      <PostedOnPage what="announcements" uid={uid} />
      {block.items.length > 0 && (
        <div className="mt-3">
          <p className={label}>Older announcements saved with the page · {block.items.length}</p>
          <div className="mt-1.5 space-y-1.5 max-h-[220px] overflow-y-auto scroll-themed pr-1">
            {block.items.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 rounded-md border border-[#d6c49f] px-2.5 py-1.5">
                <span className="min-w-0 flex-1 text-xs font-semibold text-ink truncate">{a.title}</span>
                <button type="button" onClick={() => { if (confirm('Remove this announcement? This can\'t be undone.')) onChange({ ...block, items: block.items.filter((x) => x.id !== a.id) }) }}
                  className="p-1 text-slate-500 hover:text-red-600" aria-label="Remove"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
