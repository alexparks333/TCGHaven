// A graded card's slab, drawn like the grader's real one: each company's label (layout, colours,
// tier — PSA's red-framed white LightHouse label, Beckett's silver / gold / Black Label with its four
// subgrades, CGC's silver label and black grade box, SGC's black "tuxedo", TAG's text printed inside
// the clear case with its QR code), the cert number where they print it, and the acrylic case with
// the card in its window. Used by the Cardex (zoom view + grid tiles), profile tiles and Add Card's
// card view. The rules (grades, words, tiers) live in lib/grading.ts.
import { gradeWord as gradeWordFor, labelTone, type GradeTier, type Subgrades } from '@/lib/grading'
import { baseCardName } from '@/lib/utils'

export type SlabInfo = { company: string; grade: string; cert?: string; tier?: GradeTier | null; subgrades?: Subgrades; printing?: string }

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

function Barcode({ seed, color, className = '', bars: count = 26, unit = 0.28, gap = 0.35 }: { seed: string; color: string; className?: string; bars?: number; unit?: number; gap?: number }) {
  let h = 0
  for (const ch of seed || 'tcghaven') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const bars: number[] = []
  for (let i = 0; i < count; i++) { h = (h * 1103515245 + 12345) >>> 0; bars.push(1 + (h % 3)) }
  return (
    <div className={`flex items-stretch ${className}`} style={{ gap: `${gap}cqw` }} aria-hidden>
      {bars.map((w, i) => <span key={i} style={{ width: `${w * unit}cqw`, backgroundColor: color }} />)}
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

// PSA's label, as on a current slab (matched to photos): a thick orange-red frame with square
// corners around a white label; heavy, slightly condensed uppercase type that fills it — set /
// name (over two lines when long) on the left, card number / grade word / grade on the right; a wide
// barcode on the bottom row with the cert number opposite; and the silver hologram sticker hanging
// over the bottom edge of the frame (a made-up emblem — not PSA's logo). The label sits in a dark
// recess in the case.
function PsaLabel({ slab, name, number, setName }: LabelProps) {
  const word = gradeWordFor('PSA', slab.grade, slab.tier)
  const font = { fontFamily: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif', fontWeight: 600, fontSize: cq(4.4), lineHeight: 1, letterSpacing: '0' }
  const cell = 'flex items-center min-w-0'
  return (
    <div className="relative h-full" style={{ padding: cq(0.9), background: 'linear-gradient(180deg, rgba(40,40,40,0.55), rgba(70,70,70,0.4))', borderRadius: cq(0.6), boxShadow: 'inset 0 0.3cqw 0.6cqw rgba(0,0,0,0.45)' }}>
      <div className="relative h-full" style={{ background: '#e4432d', padding: cq(2.1) }}>
        <div className="relative h-full bg-white text-[#141414] uppercase grid grid-rows-4 grid-cols-[1fr_auto] gap-x-[3cqw]" style={{ ...font, padding: `${cq(0.9)} ${cq(2.6)} ${cq(0.9)} ${cq(2.6)}` }}>
          <div className={cell} style={{ gridRow: 1, gridColumn: 1 }}><span className="truncate">{setName || ' '}</span></div>
          <div className={`${cell} justify-end`} style={{ gridRow: 1, gridColumn: 2 }}>#{number}</div>
          {/* The name takes the second line, and the third when it's long */}
          <div className="min-w-0 flex items-start pt-[0.35em]" style={{ gridRow: '2 / span 2', gridColumn: 1 }}>
            <span className="line-clamp-2" style={{ lineHeight: 1.12 }}>{name}</span>
          </div>
          <div className={`${cell} justify-end`} style={{ gridRow: 2, gridColumn: 2 }}>{word}</div>
          <div className={`${cell} justify-end`} style={{ gridRow: 3, gridColumn: 2 }}>{slab.grade}</div>
          <div className={cell} style={{ gridRow: 4, gridColumn: 1 }}><Barcode seed={slab.cert || name} color="#141414" bars={34} unit={0.36} gap={0.32} className="h-[78%] w-fit" /></div>
          <div className={`${cell} justify-end tabular-nums`} style={{ gridRow: 4, gridColumn: 2 }}>{slab.cert || ' '}</div>
        </div>
      </div>
      {/* Hologram sticker hanging over the bottom of the frame */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center"
        style={{ bottom: cq(0.9), width: cq(13), height: cq(5.6), background: 'linear-gradient(115deg, #aeb7c2, #eef1f4 22%, #c9d5e4 40%, #f1e8ef 58%, #d6e3d4 76%, #aeb7c2)', boxShadow: 'inset 0 0 0 0.2cqw rgba(255,255,255,0.75), 0 0.1cqw 0.3cqw rgba(0,0,0,0.3)' }}>
        <svg viewBox="0 0 30 14" style={{ width: '62%', height: '72%' }} aria-hidden>
          <path d="M15 1.5 L19 7 L15 12.5 L11 7 Z" fill="#d23a2a" opacity="0.9" />
          <path d="M2.5 7 H9.5 M20.5 7 H27.5" stroke="#244a9a" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
        </svg>
      </div>
    </div>
  )
}

// Beckett, as on its current (2026) slab — matched to photos: the holder's black insert, a black
// block on the left with a laurel-wreath "B" crest and BECKETT under it (both made up — not
// Beckett's logo), and the label panel in its tier (metallic gold for 9.5 / Pristine 10; black with
// a gold rule and cream lettering for Black Label; silver below 9.5): the card's lines and the two
// pairs of subgrades in condensed type on the left, the big grade, its word and the serial number
// on the right.
function LaurelCrest({ color }: { color: string }) {
  // Leaves along two arcs that rise from a cross at the bottom
  const leaves: Array<{ x: number; y: number; r: number }> = []
  for (let i = 0; i < 8; i++) {
    const t = (i / 7)
    const ang = (228 - t * 140) * Math.PI / 180      // around the left side, bottom → top
    const R = 15.5
    leaves.push({ x: 20 + R * Math.cos(ang), y: 21 - R * Math.sin(ang), r: (ang * 180 / Math.PI) - 90 })
  }
  return (
    <svg viewBox="0 0 40 42" className="w-full h-full" aria-hidden>
      {[1, -1].map((side) => (
        <g key={side} transform={side === -1 ? 'translate(40 0) scale(-1 1)' : undefined}>
          <path d="M23 39 C13 35 5 27 4.5 15" fill="none" stroke={color} strokeWidth="0.9" />
          {leaves.map((l, i) => (
            <ellipse key={i} cx={l.x} cy={l.y} rx="1.7" ry="3.5" fill={color} transform={`rotate(${l.r + 38} ${l.x} ${l.y})`} />
          ))}
        </g>
      ))}
      <text x="20" y="27.5" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700" fontSize="19" fill={color}>B</text>
    </svg>
  )
}

function BgsLabel({ slab, name, number, setName }: LabelProps) {
  const tone = labelTone('BGS', slab.grade, slab.tier)
  const black = tone === 'black'
  const panel = black ? 'linear-gradient(170deg, #1a1a1a, #070707)'
    : tone === 'gold' ? 'linear-gradient(100deg, #b8913f 0%, #e9cf86 22%, #c9a556 48%, #f0d996 70%, #b8913f 100%)'
    : 'linear-gradient(100deg, #9fa5ad 0%, #e6e8eb 22%, #b9bec6 48%, #eef0f2 70%, #9fa5ad 100%)'
  const ink = black ? '#ecd9a6' : '#17130b'
  const big = black ? '#d9b45c' : '#17130b'
  const cond = { fontFamily: '"Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif' }
  const sub = slab.subgrades ?? {}
  const pair = (a: string, av?: string, b?: string, bv?: string) => (
    <div className="grid grid-cols-[auto_2.6em_auto_2.6em] gap-x-[1.2cqw]">
      <span>{a}</span><span className="text-right tabular-nums">{av || '–'}</span>
      <span>{b}</span><span className="text-right tabular-nums">{bv || '–'}</span>
    </div>
  )
  return (
    <div className="relative h-full flex bg-[#0a0a0a]" style={{ padding: cq(1.2), gap: cq(1.6), ...cond }}>
      {/* Crest block */}
      <div className="shrink-0 flex flex-col items-center justify-center" style={{ width: cq(15) }}>
        <div style={{ width: cq(9.5), height: cq(10) }}><LaurelCrest color="#f2f0ea" /></div>
        <div className="text-[#f2f0ea] font-bold tracking-[0.02em] leading-none" style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: cq(2.6), marginTop: cq(0.3) }}>BECKETT</div>
      </div>
      {/* Label panel */}
      <div className="flex-1 min-w-0 flex uppercase" style={{ background: panel, color: ink, padding: `${cq(1.1)} ${cq(2)}`, boxShadow: black ? 'inset 0 0 0 0.3cqw #b8913f' : 'inset 0 0 0 0.15cqw rgba(0,0,0,0.25)', borderRadius: cq(0.4) }}>
        <div className="flex-1 min-w-0 flex flex-col justify-between font-medium" style={{ fontSize: cq(2.6), lineHeight: 1.05 }}>
          <div>
            <div className="truncate">{setName || ' '}</div>
            <div className="line-clamp-2">#{number} {name}</div>
          </div>
          <div className="font-medium" style={{ lineHeight: 1.12 }}>
            {pair('Centering', sub.centering, 'Corners', sub.corners)}
            {pair('Edges', sub.edges, 'Surface', sub.surface)}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end justify-between pl-[2cqw] text-right">
          <div className="font-bold leading-none tabular-nums" style={{ fontSize: cq(9.5), color: big, letterSpacing: '-0.02em' }}>{slab.grade}</div>
          <div className="leading-tight">
            <div className="font-semibold" style={{ fontSize: cq(slab.tier === 'black' ? 2.3 : 2.7) }}>{gradeWordFor('BGS', slab.grade, slab.tier)}</div>
            <div className="font-medium tabular-nums" style={{ fontSize: cq(2.5) }}>{slab.cert || ' '}</div>
          </div>
        </div>
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
  // Labels are wide and short; PSA's is the shortest
  const labelH = c === 'PSA' ? '16.5%' : c === 'BGS' ? '13%' : '19%'
  // SGC's "tuxedo" and Beckett's current holder both put the card in a black insert
  const sgcInsert = c === 'SGC' || c === 'BGS'
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
        {/* The printing goes with the name, as graders print it: Charizard - Reverse Holo */}
        <SlabLabel slab={slab} name={slab.printing ? `${baseCardName(name)} - ${slab.printing}` : name} number={number} setName={setName} />
      </div>
      {/* Card window */}
      <div
        className="relative flex-1 min-h-0 rounded-[8px] p-[2%] flex items-center justify-center"
        style={sgcInsert
          ? { background: '#0b0b0b', boxShadow: '0 0 0 1px rgba(255,255,255,0.25), inset 0 0 0 1px rgba(255,255,255,0.12), inset 0 2px 10px rgba(0,0,0,0.6)' }
          : { background: 'rgba(200,215,232,0.05)', boxShadow: '0 0 0 1px rgba(255,255,255,0.28), inset 0 0 0 1px rgba(255,255,255,0.55), inset 0 0 0 4px rgba(225,235,248,0.09), inset 0 2px 10px rgba(0,0,0,0.35)' }}
      >
        {/* The card, as big as the window allows either way (5 : 7) */}
        <div className="absolute inset-[2%] flex items-center justify-center" style={{ containerType: 'size' }}>
          <div className="relative rounded-[6px] overflow-hidden" style={{ width: 'min(100cqw, calc(100cqh * 5 / 7))', aspectRatio: '5 / 7', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}>
            {children}
          </div>
        </div>
      </div>
      {/* Acrylic glare sweeping across the whole case */}
      <div className="slab-glare absolute inset-0 pointer-events-none" />
    </div>
  )
}
