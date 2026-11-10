// A graded card's slab, drawn like the grader's real one: each company's label (layout, colours,
// tier — PSA's red-framed white LightHouse label, Beckett's silver / gold / Black Label with its four
// subgrades, CGC's silver label and black grade box, SGC's black "tuxedo", TAG's text printed inside
// the clear case with its QR code), the cert number where they print it, and the acrylic case with
// the card in its window. Used by the Cardex (zoom view + grid tiles), profile tiles and Add Card's
// card view. The rules (grades, words, tiers) live in lib/grading.ts.
import { gradeWord as gradeWordFor, labelTone, type GradeTier, type Subgrades } from '@/lib/grading'

export type SlabInfo = { company: string; grade: string; cert?: string; tier?: GradeTier | null; subgrades?: Subgrades }

/** The grader's word for a grade — lib/grading.ts (kept here for older imports) */
export const gradeWord = (company: string, grade: string, tier?: GradeTier | null) => gradeWordFor(company, grade, tier)

// Colours of each label (and its tier) — used by the grid tiles' grade band
export function slabStyle(company: string, grade = '', tier?: GradeTier | null): { bg: string; fg: string; accent: string } {
  const c = String(company ?? '').toUpperCase()
  const tone = labelTone(c, grade, tier)
  if (tone === 'black') return { bg: '#0d0d0d', fg: '#e3c46e', accent: '#c9a24a' }
  if (tone === 'gold') return { bg: '#e2c477', fg: '#2a1d05', accent: '#9a7424' }
  if (c === 'PSA') return { bg: '#ffffff', fg: '#151515', accent: '#c8102e' }
  if (c === 'BGS') return { bg: '#d3d7dd', fg: '#121820', accent: '#7d8590' }
  if (c === 'CGC') return { bg: '#e4e6ea', fg: '#111111', accent: '#111111' }
  if (c === 'SGC') return { bg: '#111111', fg: '#f2f2f2', accent: '#bfbfbf' }
  if (c === 'TAG') return { bg: '#f4f6f8', fg: '#0f172a', accent: '#0f172a' }
  return { bg: '#3f4652', fg: '#ffffff', accent: '#9ca3af' }
}

// ── Small drawn parts ───────────────────────────────────────────────────────

function Barcode({ seed, color, className = '' }: { seed: string; color: string; className?: string }) {
  let h = 0
  for (const ch of seed || 'tcghaven') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const bars: number[] = []
  for (let i = 0; i < 26; i++) { h = (h * 1103515245 + 12345) >>> 0; bars.push(1 + (h % 3)) }
  return (
    <div className={`flex items-stretch gap-[0.35cqw] ${className}`} aria-hidden>
      {bars.map((w, i) => <span key={i} style={{ width: `${w * 0.28}cqw`, backgroundColor: color }} />)}
    </div>
  )
}

function QrMark({ seed, color }: { seed: string; color: string }) {
  let h = 7
  for (const ch of seed || 'tag') h = (h * 33 + ch.charCodeAt(0)) >>> 0
  // A 9×9 code: the three corner finder squares (a ring with a dot), the rest from the seed
  const finder = (r: number, c: number) => {
    const fr = r < 3 ? r : r > 5 ? r - 6 : -1, fc = c < 3 ? c : c > 5 ? c - 6 : -1
    if (fr < 0 || fc < 0 || (r > 5 && c > 5)) return null
    return !(fr === 1 && fc === 1) || true
  }
  const cells: boolean[] = []
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9), c = i % 9
    const f = finder(r, c)
    h = (h * 1664525 + 1013904223) >>> 0
    cells.push(f ?? (h >>> 16) % 2 === 0)
  }
  return (
    <div className="grid grid-cols-9 aspect-square h-full p-[0.4cqw] bg-white rounded-[0.6cqw]" aria-hidden>
      {cells.map((on, i) => <span key={i} style={{ backgroundColor: on ? color : 'transparent' }} />)}
    </div>
  )
}

const cq = (n: number) => `${n}cqw`

// ── Labels ──────────────────────────────────────────────────────────────────

interface LabelProps { slab: SlabInfo; name: string; number: string; setName?: string }

// PSA's LightHouse label: white with fine wave lines in a red frame; the card's set / name /
// number on the left, the grade word over the number on the right, the cert number below it, and
// the hologram sticker at the bottom.
function PsaLabel({ slab, name, number, setName }: LabelProps) {
  const word = gradeWordFor('PSA', slab.grade, slab.tier)
  return (
    <div className="relative h-full rounded-[1.2cqw] overflow-hidden text-[#151515]"
      style={{
        backgroundColor: '#fdfdfd',
        backgroundImage: 'repeating-radial-gradient(ellipse at 30% 140%, rgba(200,16,46,0) 0, rgba(200,16,46,0) 2.2cqw, rgba(200,16,46,0.05) 2.4cqw, rgba(200,16,46,0) 2.6cqw)',
        boxShadow: 'inset 0 0 0 0.9cqw #c8102e, inset 0 0 0 1.25cqw #ffffff, 0 0.4cqw 1cqw rgba(0,0,0,0.25)',
      }}>
      <div className="absolute inset-[1.8cqw] flex">
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-[0.5cqw] font-bold uppercase leading-[1.05]" style={{ fontSize: cq(3.6) }}>
          <div className="truncate">{setName || ' '}</div>
          <div className="truncate" style={{ fontSize: cq(4.1) }}>{name}</div>
          <div className="truncate font-semibold">#{number}</div>
        </div>
        <div className="flex flex-col items-end justify-center pl-[2cqw] shrink-0 font-bold uppercase leading-none">
          <div style={{ fontSize: cq(4) }}>{word}</div>
          <div className="font-black mt-[0.6cqw]" style={{ fontSize: cq(9) }}>{slab.grade}</div>
          {slab.cert && <div className="font-semibold tabular-nums mt-[0.8cqw]" style={{ fontSize: cq(3) }}>{slab.cert}</div>}
        </div>
      </div>
      {/* LightHouse hologram */}
      <div className="absolute bottom-[1.5cqw] left-1/2 -translate-x-1/2 w-[9cqw] h-[3cqw] rounded-[0.5cqw]"
        style={{ background: 'linear-gradient(115deg, #c9d6e8, #f3d1e6 30%, #d6f0dc 55%, #f7ecc4 80%, #c9d6e8)', boxShadow: 'inset 0 0 0 0.25cqw rgba(255,255,255,0.7)' }}>
        <div className="w-full h-full flex items-center justify-center font-black italic text-[#c8102e]/80" style={{ fontSize: cq(1.9) }}>PSA</div>
      </div>
    </div>
  )
}

// Beckett: the label in its tier's colour (silver; gold for 9.5 / Pristine 10; black with gold
// lettering for Black Label) with the laurel "B" crest, the card on the left, the grade and its
// word on the right, and the four subgrades in a row along the bottom.
function BgsLabel({ slab, name, number, setName }: LabelProps) {
  const tone = labelTone('BGS', slab.grade, slab.tier)
  const bg = tone === 'black' ? 'linear-gradient(160deg, #1c1c1c, #050505)'
    : tone === 'gold' ? 'linear-gradient(160deg, #f0d993, #d6b45f 55%, #b8923e)'
    : 'linear-gradient(160deg, #eceef1, #c7ccd3 55%, #aeb4bd)'
  const fg = tone === 'black' ? '#e3c46e' : '#13181f'
  const sub = slab.subgrades ?? {}
  const subs: Array<[string, string | undefined]> = [['CENTERING', sub.centering], ['CORNERS', sub.corners], ['EDGES', sub.edges], ['SURFACE', sub.surface]]
  return (
    <div className="relative h-full rounded-[1.2cqw] overflow-hidden flex flex-col" style={{ background: bg, color: fg, boxShadow: `inset 0 0 0 0.5cqw ${tone === 'black' ? '#c9a24a' : 'rgba(0,0,0,0.25)'}, 0 0.4cqw 1cqw rgba(0,0,0,0.3)` }}>
      <div className="flex-1 min-h-0 flex items-center gap-[2cqw] px-[2.4cqw] pt-[1.4cqw]">
        {/* laurel crest */}
        <div className="shrink-0 rounded-full flex items-center justify-center font-black" style={{ width: cq(8), height: cq(8), fontSize: cq(4.6), border: `0.45cqw solid ${fg}`, boxShadow: `0 0 0 0.6cqw ${tone === 'black' ? '#000' : 'transparent'}` }}>B</div>
        <div className="flex-1 min-w-0 font-bold uppercase leading-[1.08]" style={{ fontSize: cq(3.3) }}>
          <div className="truncate opacity-80">{setName || ' '}</div>
          <div className="truncate" style={{ fontSize: cq(3.9) }}>{name}</div>
          <div className="truncate opacity-80">#{number}{slab.cert ? `  ·  ${slab.cert}` : ''}</div>
        </div>
        <div className="shrink-0 text-right leading-none uppercase">
          <div className="font-bold" style={{ fontSize: cq(slab.tier === 'black' ? 2.6 : 3.4) }}>{gradeWordFor('BGS', slab.grade, slab.tier)}</div>
          <div className="font-black mt-[0.5cqw]" style={{ fontSize: cq(9.5) }}>{slab.grade}</div>
        </div>
      </div>
      <div className="shrink-0 grid grid-cols-4 mx-[2.4cqw] mb-[1.4cqw] mt-[0.8cqw] rounded-[0.6cqw] overflow-hidden" style={{ border: `0.25cqw solid ${tone === 'black' ? '#c9a24a' : 'rgba(0,0,0,0.3)'}` }}>
        {subs.map(([k, v], i) => (
          <div key={k} className="flex items-center justify-center gap-[0.8cqw] py-[0.5cqw] font-bold" style={{ fontSize: cq(2.3), borderLeft: i ? `0.25cqw solid ${tone === 'black' ? '#c9a24a' : 'rgba(0,0,0,0.3)'}` : undefined }}>
            <span className="opacity-75 tracking-wide">{k}</span><span style={{ fontSize: cq(3) }}>{v || '–'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// CGC Cards: a silver-toned label with black accents — the black CGC block on the left, the card's
// lines in the middle, the grade box on the right; gold for Pristine 10.
function CgcLabel({ slab, name, number, setName }: LabelProps) {
  const gold = labelTone('CGC', slab.grade, slab.tier) === 'gold'
  return (
    <div className="relative h-full rounded-[1.2cqw] overflow-hidden flex items-stretch gap-[2cqw] p-[1.6cqw]"
      style={{ background: gold ? 'linear-gradient(160deg, #f1dc9c, #d2ae58 60%, #b8923e)' : 'linear-gradient(160deg, #f4f5f7, #d9dce1 60%, #c4c8cf)', color: '#111', boxShadow: 'inset 0 0 0 0.35cqw rgba(0,0,0,0.35), 0 0.4cqw 1cqw rgba(0,0,0,0.25)' }}>
      <div className="shrink-0 rounded-[0.8cqw] bg-[#111] text-white flex items-center justify-center font-black tracking-tight" style={{ width: cq(12), fontSize: cq(4.6) }}>CGC</div>
      <div className="flex-1 min-w-0 flex flex-col justify-center font-bold uppercase leading-[1.08]" style={{ fontSize: cq(3.3) }}>
        <div className="truncate">{setName || ' '}</div>
        <div className="truncate" style={{ fontSize: cq(3.9) }}>{name}</div>
        <div className="truncate font-semibold opacity-80">#{number}</div>
        {slab.cert && <div className="truncate font-semibold tabular-nums opacity-70 mt-[0.4cqw]" style={{ fontSize: cq(2.6) }}>{slab.cert}</div>}
      </div>
      <div className="shrink-0 rounded-[0.8cqw] flex flex-col items-center justify-center px-[1.6cqw] uppercase leading-none" style={{ background: gold ? '#2a1d05' : '#111', color: gold ? '#f1dc9c' : '#fff', minWidth: cq(16) }}>
        <div className="font-bold" style={{ fontSize: cq(2.6) }}>{gradeWordFor('CGC', slab.grade, slab.tier)}</div>
        <div className="font-black mt-[0.6cqw]" style={{ fontSize: cq(8.5) }}>{slab.grade}</div>
      </div>
    </div>
  )
}

// SGC: the black "tuxedo" label (gold for Pristine 10), white lettering, the SGC mark on the left
// and the grade on the right.
function SgcLabel({ slab, name, number, setName }: LabelProps) {
  const gold = labelTone('SGC', slab.grade, slab.tier) === 'gold'
  const fg = gold ? '#1d1404' : '#f2f2f2'
  return (
    <div className="relative h-full rounded-[1.2cqw] overflow-hidden flex items-stretch gap-[2cqw] p-[1.8cqw]"
      style={{ background: gold ? 'linear-gradient(160deg, #f0d993, #d0ac55 60%, #b38c3b)' : 'linear-gradient(160deg, #1d1d1d, #050505)', color: fg, boxShadow: 'inset 0 0 0 0.35cqw rgba(255,255,255,0.18), 0 0.4cqw 1cqw rgba(0,0,0,0.35)' }}>
      <div className="shrink-0 flex items-center justify-center font-black italic tracking-tight rounded-[0.8cqw]" style={{ width: cq(12), fontSize: cq(5), border: `0.4cqw solid ${fg}` }}>SGC</div>
      <div className="flex-1 min-w-0 flex flex-col justify-center font-bold uppercase leading-[1.08]" style={{ fontSize: cq(3.3) }}>
        <div className="truncate opacity-80">{setName || ' '}</div>
        <div className="truncate" style={{ fontSize: cq(3.9) }}>{name}</div>
        <div className="truncate opacity-80">#{number}{slab.cert ? `  ·  ${slab.cert}` : ''}</div>
      </div>
      <div className="shrink-0 flex flex-col items-end justify-center uppercase leading-none">
        <div className="font-bold" style={{ fontSize: cq(3) }}>{gradeWordFor('SGC', slab.grade, slab.tier)}</div>
        <div className="font-black mt-[0.6cqw]" style={{ fontSize: cq(9.5) }}>{slab.grade}</div>
      </div>
    </div>
  )
}

// TAG: no paper label — the lettering is printed inside the clear case, with the QR code and the
// cert number beside it.
function TagLabel({ slab, name, number, setName }: LabelProps) {
  return (
    <div className="relative h-full rounded-[1.2cqw] flex items-stretch gap-[2cqw] p-[1.6cqw] text-[#0f172a]"
      style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(2px)', boxShadow: 'inset 0 0 0 0.3cqw rgba(15,23,42,0.25)' }}>
      <div className="flex-1 min-w-0 flex flex-col justify-center uppercase leading-[1.08]">
        <div className="font-black tracking-[0.25em]" style={{ fontSize: cq(3) }}>TAG</div>
        <div className="truncate font-semibold opacity-80" style={{ fontSize: cq(3) }}>{setName || ' '}</div>
        <div className="truncate font-bold" style={{ fontSize: cq(3.8) }}>{name}</div>
        <div className="truncate font-semibold opacity-80" style={{ fontSize: cq(3) }}>#{number}</div>
      </div>
      <div className="shrink-0 flex flex-col items-end justify-center uppercase leading-none">
        <div className="font-bold" style={{ fontSize: cq(2.8) }}>{gradeWordFor('TAG', slab.grade, slab.tier)}</div>
        <div className="font-black mt-[0.5cqw]" style={{ fontSize: cq(9) }}>{slab.grade}</div>
      </div>
      <div className="shrink-0 flex items-center gap-[1cqw]">
        {slab.cert && <div className="font-semibold tabular-nums [writing-mode:vertical-rl] rotate-180" style={{ fontSize: cq(2.3) }}>{slab.cert}</div>}
        <div className="h-[80%]"><QrMark seed={slab.cert || name} color="#0f172a" /></div>
      </div>
    </div>
  )
}

// Any other grader: a plain label in neutral colours
function GenericLabel({ slab, name, number, setName }: LabelProps) {
  const st = slabStyle(slab.company, slab.grade, slab.tier)
  return (
    <div className="relative h-full rounded-[1.2cqw] overflow-hidden flex items-center gap-[2cqw] px-[2.4cqw]" style={{ backgroundColor: st.bg, color: st.fg, boxShadow: `inset 0 0 0 0.4cqw ${st.accent}, 0 0.4cqw 1cqw rgba(0,0,0,0.25)` }}>
      <div className="flex-1 min-w-0 font-bold uppercase leading-[1.08]" style={{ fontSize: cq(3.3) }}>
        <div className="truncate opacity-75">{setName || ' '}</div>
        <div className="truncate" style={{ fontSize: cq(3.9) }}>{name}</div>
        <div className="flex items-center gap-[1.2cqw]"><span className="italic font-black">{slab.company}</span><span className="opacity-75">#{number}</span></div>
      </div>
      <div className="shrink-0 text-right leading-none uppercase">
        <div className="font-bold" style={{ fontSize: cq(3) }}>{gradeWordFor(slab.company, slab.grade, slab.tier)}</div>
        <div className="font-black mt-[0.5cqw]" style={{ fontSize: cq(9) }}>{slab.grade}</div>
        {slab.cert && <Barcode seed={slab.cert} color={st.fg} className="h-[1.6cqw] mt-[0.8cqw] justify-end opacity-70" />}
      </div>
    </div>
  )
}

/** Just the label, drawn like the grader's own — for a slab, or on its own */
export function SlabLabel(props: LabelProps) {
  const c = String(props.slab.company ?? '').toUpperCase()
  if (c === 'PSA') return <PsaLabel {...props} />
  if (c === 'BGS') return <BgsLabel {...props} />
  if (c === 'CGC') return <CgcLabel {...props} />
  if (c === 'SGC') return <SgcLabel {...props} />
  if (c === 'TAG') return <TagLabel {...props} />
  return <GenericLabel {...props} />
}

// ── The whole slab ──────────────────────────────────────────────────────────

/** The full graded case — acrylic shell, the grader's label up top, the card in its window below
 *  (SGC's in its black "tuxedo" insert). Sizes scale with the slab's width. */
export function FullSlab({ slab, name, number, setName, children }: {
  slab: SlabInfo; name: string; number: string; setName?: string; children: React.ReactNode
}) {
  const c = String(slab.company ?? '').toUpperCase()
  const labelH = c === 'BGS' ? '22%' : '18%'
  const sgcInsert = c === 'SGC'
  return (
    <div
      className="relative w-full h-full rounded-[18px] p-[4%] flex flex-col gap-[3%] overflow-hidden"
      // Clear acrylic: barely-tinted see-through body, with the light caught at the thick polished
      // edges (bright outer rim, a softer inner bevel) the way a real slab reads.
      style={{
        containerType: 'inline-size',
        background: 'linear-gradient(160deg, rgba(235,244,255,0.20) 0%, rgba(220,232,245,0.07) 32%, rgba(220,232,245,0.04) 68%, rgba(235,244,255,0.15) 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.85), inset 0 0 0 3px rgba(225,235,248,0.22), inset 0 0 0 4px rgba(255,255,255,0.4), inset 0 0 0 9px rgba(225,235,248,0.07), inset 0 2px 12px rgba(255,255,255,0.22), inset 0 -8px 20px rgba(150,170,195,0.14)',
      }}
    >
      <div className="relative shrink-0" style={{ height: labelH }}>
        <SlabLabel slab={slab} name={name} number={number} setName={setName} />
      </div>
      {/* Card window */}
      <div
        className="relative flex-1 min-h-0 rounded-[8px] p-[2%] flex items-center justify-center"
        style={sgcInsert
          ? { background: '#0b0b0b', boxShadow: '0 0 0 1px rgba(255,255,255,0.25), inset 0 0 0 1px rgba(255,255,255,0.12), inset 0 2px 10px rgba(0,0,0,0.6)' }
          : { background: 'rgba(200,215,232,0.05)', boxShadow: '0 0 0 1px rgba(255,255,255,0.28), inset 0 0 0 1px rgba(255,255,255,0.55), inset 0 0 0 4px rgba(225,235,248,0.09), inset 0 2px 10px rgba(0,0,0,0.35)' }}
      >
        <div className="relative h-full rounded-[6px] overflow-hidden" style={{ aspectRatio: '5 / 7', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}>
          {children}
        </div>
      </div>
      {/* Acrylic glare sweeping across the whole case */}
      <div className="slab-glare absolute inset-0 pointer-events-none" />
    </div>
  )
}
