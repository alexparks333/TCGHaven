'use client'

// A block's Style panel in the Creator Studio (the palette button on a block — docs/creators.md "Block
// styles"): a theme in one tap, or any colours; the title and text fonts; the title size; and the finish
// (paper dots, corner flourishes, border, roundness — and for a Picture, whether it sits on a frame).
// Only what the creator changes is stored (`block.style`); the rest is the block type's default.

import { RotateCcw } from 'lucide-react'
import { ColorPick, Toggle, ValueSlider } from '@/components/creator/CoverDesigner'
import { BLOCK_FONTS, BLOCK_THEMES, blockLook, defaultTheme, fontCss, type BlockStyle, type FontId } from '@/lib/blockStyle'
import type { Block } from '@/lib/communityBlocks'
import { cn } from '@/lib/utils'

const uniq = (xs: string[]) => Array.from(new Set(xs.map((x) => x.toLowerCase())))
const swatches = (k: 'bg' | 'title' | 'text' | 'accent') => uniq(BLOCK_THEMES.map((t) => t[k])).slice(0, 5).map((color) => ({ name: color, color }))

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 first:mt-0 mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{children}</p>
}

export function BlockStyleEditor({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const st = block.style ?? {}
  const l = blockLook(block.type, st)
  const def = defaultTheme(block.type)
  const set = (patch: Partial<BlockStyle>) => onChange({ ...block, style: { ...st, ...patch } })
  const picture = block.type === 'picture'
  const panel = !picture || l.frame // the colours and finish only show on a panel
  const themeOn = (t: typeof def) => [t.bg, t.title, t.text, t.accent].join() === [l.bg, l.title, l.text, l.accent].join().toLowerCase()
  const titleFont = st.titleFont ?? 'engraved', bodyFont = st.bodyFont ?? 'modern'

  function reset() {
    if (!block.style || !confirm('Put this block back to its default colours and fonts?')) return
    const rest = { ...block }
    delete rest.style
    onChange(rest)
  }

  return (
    <div>
      {picture && (
        <div className="mb-4">
          <Toggle on={l.frame} onChange={(frame) => set({ frame })} label="Frame" hint="Sit the picture on a panel in the colours below" />
        </div>
      )}

      {panel && <>
        <Heading>Theme</Heading>
        <div className="grid grid-cols-4 gap-2">
          {BLOCK_THEMES.map((t) => (
            <button key={t.id} type="button" onClick={() => set({ bg: t.bg, title: t.title, text: t.text, accent: t.accent })} title={t.name}
              className={cn('group rounded-xl p-1 transition', themeOn(t) ? 'ring-2 ring-[#7a5230]' : 'hover:ring-1 hover:ring-[#c4ae83]')}>
              <span className="relative block h-11 rounded-lg border border-black/15 overflow-hidden" style={{ background: t.bg }}>
                <span className="absolute left-1.5 top-1 text-[15px] font-bold leading-none" style={{ color: t.title, fontFamily: fontCss(titleFont) }}>Aa</span>
                <span className="absolute left-1.5 right-1.5 bottom-2 h-[3px] rounded-full" style={{ background: t.accent }} />
                <span className="absolute left-1.5 right-4 bottom-[13px] h-[2px] rounded-full opacity-60" style={{ background: t.text }} />
              </span>
              <span className="block mt-1 text-[10px] font-semibold text-slate-500 truncate">{t.name}</span>
            </button>
          ))}
        </div>

        <Heading>Colours</Heading>
        <ColorPick label="Background" value={l.bg} palette={swatches('bg')} onChange={(bg) => set({ bg })} />
        <ColorPick label="Titles" value={l.title} palette={swatches('title')} onChange={(title) => set({ title })} />
        <ColorPick label="Text" value={l.text} palette={swatches('text')} onChange={(text) => set({ text })} />
        <ColorPick label="Accent" value={l.accent} palette={swatches('accent')} onChange={(accent) => set({ accent })} />
      </>}

      <Heading>{picture ? 'Caption font' : 'Title font'}</Heading>
      <div className="grid grid-cols-2 gap-1.5">
        {BLOCK_FONTS.filter((f) => f.title).map((f) => (
          <button key={f.id} type="button" onClick={() => set({ titleFont: f.id as FontId })}
            className={cn('rounded-lg border px-2.5 py-2 text-left transition-colors', titleFont === f.id ? 'border-[#7a5230] bg-[#f6e7c4]' : 'border-[#d6c49f] bg-[#f6eedb] hover:border-[#a8875c]')}>
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
              className={cn('rounded-full border px-3 py-1 text-sm transition-colors', bodyFont === f.id ? 'border-[#7a5230] bg-[#f6e7c4] text-ink' : 'border-[#d6c49f] bg-[#f6eedb] text-slate-400 hover:border-[#a8875c]')}
              style={{ fontFamily: f.css }}>{f.name}</button>
          ))}
        </div>
      </>}

      <Heading>Finish</Heading>
      <div className="space-y-2.5">
        {panel && <>
          <Toggle on={l.grain} onChange={(grain) => set({ grain })} label="Paper dots" />
          <Toggle on={l.corners} onChange={(corners) => set({ corners })} label="Corner flourishes" />
          <Toggle on={l.border} onChange={(border) => set({ border })} label="Border" />
        </>}
      </div>
      <ValueSlider label="Roundness" min={0} max={28} step={1} value={l.radius} unit="px" onChange={(radius) => set({ radius })} />

      {block.style && (
        <button type="button" onClick={reset} className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-ink">
          <RotateCcw size={13} />Back to the default look
        </button>
      )}
    </div>
  )
}
