'use client'

// A block's Style panel in the Creator Studio (the palette button on a block — docs/creators.md "Block
// styles"), in three parts:
//   • the block's own options — the Wall's board (surface, colour, texture, frame, pins/tape, tilt, columns,
//     how many posts), the leaderboard's headers / newest highlight / pin size, the cards' columns / names /
//     corners, a text block's alignment and size, announcements' item look, a picture's frame and height;
//   • Colours — a theme in one tap, or any background / title / text / accent colour;
//   • Text & finish — title and text fonts, title size, paper dots, corners, border, roundness.
// Only what the creator changes is stored (`block.style`); the rest is the block type's default.

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { ColorPick, Toggle, ValueSlider } from '@/components/creator/CoverDesigner'
import {
  BLOCK_FONTS, BLOCK_THEMES, WALL_SURFACES, blockLook, defaultTheme, fontCss, surfaceCss, wallLook,
  type BlockStyle, type FontId, type WallStyle,
} from '@/lib/blockStyle'
import type { Block, BlockType } from '@/lib/communityBlocks'
import { cn } from '@/lib/utils'

const uniq = (xs: string[]) => Array.from(new Set(xs.map((x) => x.toLowerCase())))
const swatches = (k: 'bg' | 'title' | 'text' | 'accent') => uniq(BLOCK_THEMES.map((t) => t[k])).slice(0, 5).map((color) => ({ name: color, color }))
const sw = (...cs: string[]) => cs.map((color) => ({ name: color, color }))

/** The name of a block type's own tab, or null when it has none */
const OWN: Partial<Record<BlockType, string>> = { wall: 'Board', badges: 'Leaderboard', cards: 'Cards', about: 'Layout', text: 'Layout', announcements: 'Layout', picture: 'Picture' }

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 first:mt-0 mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{children}</p>
}

/** A row of choices, one picked (flat, square-cornered) */
function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="mt-2.5 flex items-center gap-3">
      <span className="text-xs font-semibold text-slate-500 w-[92px] shrink-0 truncate">{label}</span>
      <div className="flex flex-1 rounded-md border border-[#d6c49f] overflow-hidden">
        {options.map(([v, name]) => (
          <button key={String(v)} type="button" onClick={() => onChange(v)}
            className={cn('flex-1 py-1 text-[11px] font-bold border-r border-[#d6c49f] last:border-r-0 transition-colors', value === v ? 'bg-[#7a5230] text-[#fbf6ea]' : 'bg-[#f6eedb] text-slate-500 hover:text-ink')}>{name}</button>
        ))}
      </div>
    </div>
  )
}

export function BlockStyleEditor({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const own = OWN[block.type] ?? null
  const [tab, setTab] = useState<'own' | 'colours' | 'text'>(own ? 'own' : 'colours')
  const st = block.style ?? {}
  const l = blockLook(block.type, st)
  const set = (patch: Partial<BlockStyle>) => onChange({ ...block, style: { ...st, ...patch } })
  const picture = block.type === 'picture'
  const panel = !picture || l.frame // the colours and finish only show on a panel

  function reset() {
    if (!block.style || !confirm('Put this block back to its default look?')) return
    const rest = { ...block }
    delete rest.style
    onChange(rest)
  }

  const tabs: Array<['own' | 'colours' | 'text', string]> = [...(own ? [['own', own] as ['own', string]] : []), ['colours', 'Colours'], ['text', 'Text & finish']]
  return (
    <div>
      <div className="flex border-b border-[#d6c49f] mb-4">
        {tabs.map(([k, name]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn('flex-1 pb-2 text-xs font-bold border-b-2 -mb-px transition-colors', tab === k ? 'border-[#7a5230] text-ink' : 'border-transparent text-slate-500 hover:text-ink')}>{name}</button>
        ))}
      </div>

      {tab === 'own' && <Own block={block} st={st} set={set} />}

      {tab === 'colours' && (panel ? <>
        <Heading>Theme</Heading>
        <div className="grid grid-cols-4 gap-2">
          {BLOCK_THEMES.map((t) => {
            const on = [t.bg, t.title, t.text, t.accent].join() === [l.bg, l.title, l.text, l.accent].join().toLowerCase()
            return (
              <button key={t.id} type="button" onClick={() => set({ bg: t.bg, title: t.title, text: t.text, accent: t.accent })} title={t.name}
                className={cn('rounded-md p-1 transition', on ? 'outline outline-2 outline-[#7a5230]' : 'hover:outline hover:outline-1 hover:outline-[#c4ae83]')}>
                <span className="relative block h-11 rounded-[3px] border border-black/15 overflow-hidden" style={{ background: t.bg }}>
                  <span className="absolute left-1.5 top-1 text-[15px] font-bold leading-none" style={{ color: t.title, fontFamily: fontCss(st.titleFont ?? 'engraved') }}>Aa</span>
                  <span className="absolute left-1.5 right-1.5 bottom-2 h-[3px]" style={{ background: t.accent }} />
                  <span className="absolute left-1.5 right-4 bottom-[13px] h-[2px] opacity-60" style={{ background: t.text }} />
                </span>
                <span className="block mt-1 text-[10px] font-semibold text-slate-500 truncate">{t.name}</span>
              </button>
            )
          })}
        </div>
        <Heading>Colours</Heading>
        <ColorPick label="Background" value={l.bg} palette={swatches('bg')} onChange={(bg) => set({ bg })} />
        <ColorPick label="Titles" value={l.title} palette={swatches('title')} onChange={(title) => set({ title })} />
        <ColorPick label="Text" value={l.text} palette={swatches('text')} onChange={(text) => set({ text })} />
        <ColorPick label="Accent" value={l.accent} palette={swatches('accent')} onChange={(accent) => set({ accent })} />
      </> : <p className="text-xs text-slate-500">Turn on <b>Frame</b> (in Picture) to give this picture a panel with colours.</p>)}

      {tab === 'text' && <>
        <Heading>{picture ? 'Caption font' : 'Title font'}</Heading>
        <div className="grid grid-cols-2 gap-1.5">
          {BLOCK_FONTS.filter((f) => f.title).map((f) => (
            <button key={f.id} type="button" onClick={() => set({ titleFont: f.id as FontId })}
              className={cn('rounded-md border px-2.5 py-2 text-left transition-colors', (st.titleFont ?? 'engraved') === f.id ? 'border-[#7a5230] bg-[#f6e7c4]' : 'border-[#d6c49f] bg-[#f6eedb] hover:border-[#a8875c]')}>
              <span className="block truncate text-[17px] leading-tight font-bold text-ink" style={{ fontFamily: f.css }}>{f.name}</span>
            </button>
          ))}
        </div>
        {!picture && <ValueSlider label="Title size" min={0.8} max={1.6} step={0.05} value={l.titleSize} onChange={(titleSize) => set({ titleSize })} />}
        {!picture && <>
          <Heading>Text font</Heading>
          <div className="flex flex-wrap gap-1.5">
            {BLOCK_FONTS.filter((f) => f.body).map((f) => (
              <button key={f.id} type="button" onClick={() => set({ bodyFont: f.id as FontId })}
                className={cn('rounded-md border px-3 py-1 text-sm transition-colors', (st.bodyFont ?? 'modern') === f.id ? 'border-[#7a5230] bg-[#f6e7c4] text-ink' : 'border-[#d6c49f] bg-[#f6eedb] text-slate-400 hover:border-[#a8875c]')}
                style={{ fontFamily: f.css }}>{f.name}</button>
            ))}
          </div>
        </>}
        <Heading>Finish</Heading>
        {panel && <div className="space-y-2.5">
          <Toggle on={l.grain} onChange={(grain) => set({ grain })} label="Paper dots" />
          <Toggle on={l.corners} onChange={(corners) => set({ corners })} label="Corner flourishes" />
          <Toggle on={l.border} onChange={(border) => set({ border })} label="Border" />
        </div>}
        <ValueSlider label="Roundness" min={0} max={28} step={1} value={l.radius} unit="px" onChange={(radius) => set({ radius })} />
      </>}

      {block.style && (
        <button type="button" onClick={reset} className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-ink">
          <RotateCcw size={13} />Back to the default look
        </button>
      )}
    </div>
  )
}

/** The block type's own options */
function Own({ block, st, set }: { block: Block; st: BlockStyle; set: (p: Partial<BlockStyle>) => void }) {
  switch (block.type) {
    case 'wall': {
      const w = wallLook(st.wall)
      const put = (p: Partial<WallStyle>) => set({ wall: { ...(st.wall ?? {}), ...p } })
      const PINS = ['#b8402f', '#3f6e8c', '#5d7a3a', '#b8862b', '#7a4a8c', '#2b2014']
      return <>
        <Heading>Surface</Heading>
        <div className="grid grid-cols-3 gap-2">
          {WALL_SURFACES.map((x) => (
            <button key={x.id} type="button" onClick={() => put({ surface: x.id, color: x.color })}
              className={cn('rounded-md p-1 transition', w.surface === x.id ? 'outline outline-2 outline-[#7a5230]' : 'hover:outline hover:outline-1 hover:outline-[#c4ae83]')}>
              <span className="block h-10 rounded-[3px] border border-black/15" style={surfaceCss(x.id, w.surface === x.id ? w.color : x.color, 0.9)} />
              <span className="block mt-1 text-[10px] font-semibold text-slate-500">{x.name}</span>
            </button>
          ))}
        </div>
        <ColorPick label="Board colour" value={w.color} palette={sw('#c49a6c', '#3f5e46', '#9a6a40', '#2f3a33', '#ddd0b6')} onChange={(color) => put({ color })} />
        {w.surface !== 'plain' && <ValueSlider label="Texture" min={0} max={1.5} step={0.05} value={w.texture} onChange={(texture) => put({ texture })} />}

        <Heading>Frame</Heading>
        <Seg label="Frame" value={w.frame} options={[['none', 'None'], ['thin', 'Thin'], ['thick', 'Thick']]} onChange={(frame) => put({ frame })} />
        {w.frame !== 'none' && <ColorPick label="Frame colour" value={w.frameColor} palette={sw('#7a5230', '#3a2a1a', '#b8862b', '#1d1f24', '#f6eedb')} onChange={(frameColor) => put({ frameColor })} />}

        <Heading>Notes</Heading>
        <Seg label="Held by" value={w.holders} options={[['mixed', 'Both'], ['pins', 'Pins'], ['tape', 'Tape'], ['none', 'None']]} onChange={(holders) => put({ holders })} />
        {w.holders !== 'tape' && w.holders !== 'none' && (
          <div className="mt-2.5 flex items-start gap-3">
            <span className="text-xs font-semibold text-slate-500 w-[92px] shrink-0 pt-1">Pin colour</span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => put({ pinColor: '' })} title="A mix of colours"
                className={cn('h-6 px-2 rounded-md border border-black/15 text-[10px] font-bold text-slate-500 bg-[#f6eedb]', !w.pinColor && 'outline outline-2 outline-offset-1 outline-[#7a5230]')}>Mixed</button>
              {PINS.map((c) => (
                <button key={c} type="button" onClick={() => put({ pinColor: c })} aria-label={`Pin colour ${c}`}
                  className={cn('w-6 h-6 rounded-full border border-black/20', w.pinColor === c && 'outline outline-2 outline-offset-1 outline-[#7a5230]')} style={{ background: c }} />
              ))}
            </div>
          </div>
        )}
        <ValueSlider label="Tilt" min={0} max={1.5} step={0.1} value={w.tilt} onChange={(tilt) => put({ tilt })} />

        <Heading>Layout</Heading>
        <Seg label="Columns" value={w.columns} options={[[1, '1'], [2, '2'], [3, '3']]} onChange={(columns) => put({ columns })} />
        <ValueSlider label="Posts shown" min={2} max={12} step={1} value={w.shown} onChange={(shown) => put({ shown })} />
      </>
    }
    case 'badges': {
      const o = { headers: true, highlight: true, pin: 30, ...(st.leader ?? {}) }
      const put = (p: Partial<typeof o>) => set({ leader: { ...(st.leader ?? {}), ...p } })
      return <div className="space-y-2.5">
        <Toggle on={o.headers} onChange={(headers) => put({ headers })} label="Column headings" hint="Collector · Badge · Earned" />
        <Toggle on={o.highlight} onChange={(highlight) => put({ highlight })} label="Light up the newest" hint="The top row in the accent colour" />
        <ValueSlider label="Pin size" min={22} max={40} step={1} value={o.pin} unit="px" onChange={(pin) => put({ pin })} />
      </div>
    }
    case 'cards': {
      const o = { columns: 4, names: true, round: 8, ...(st.cards ?? {}) }
      const put = (p: Partial<typeof o>) => set({ cards: { ...(st.cards ?? {}), ...p } })
      return <>
        <Seg label="Columns" value={o.columns} options={[[2, '2'], [3, '3'], [4, '4'], [5, '5']]} onChange={(columns) => put({ columns })} />
        <div className="mt-3"><Toggle on={o.names} onChange={(names) => put({ names })} label="Names under the cards" hint="Name, set and number" /></div>
        <ValueSlider label="Card corners" min={0} max={16} step={1} value={o.round} unit="px" onChange={(round) => put({ round })} />
      </>
    }
    case 'about': case 'text': case 'announcements': {
      const o = { align: 'left' as 'left' | 'center', size: 15, items: 'filled' as 'filled' | 'outlined' | 'plain', ...(st.layout ?? {}) }
      const put = (p: Partial<typeof o>) => set({ layout: { ...(st.layout ?? {}), ...p } })
      return block.type === 'announcements'
        ? <Seg label="Each one" value={o.items} options={[['filled', 'Filled'], ['outlined', 'Outlined'], ['plain', 'Plain']]} onChange={(items) => put({ items })} />
        : <>
          <Seg label="Align" value={o.align} options={[['left', 'Left'], ['center', 'Centre']]} onChange={(align) => put({ align })} />
          <ValueSlider label="Text size" min={13} max={22} step={1} value={o.size} unit="px" onChange={(size) => put({ size })} />
        </>
    }
    case 'picture': {
      const l = blockLook('picture', st)
      return <>
        <Toggle on={l.frame} onChange={(frame) => set({ frame })} label="Frame" hint="Sit the picture on a panel in your colours" />
        <ValueSlider label="Height" min={220} max={760} step={10} value={st.picture?.height ?? 520} unit="px" onChange={(height) => set({ picture: { height } })} />
      </>
    }
    default: return null
  }
}
