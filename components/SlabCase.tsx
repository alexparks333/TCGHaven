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

interface LabelProps { slab: SlabInfo; name: string; number: string; setName?: string; variety?: string }

// PSA's label, as on a current slab: a solid red frame around a white label; one plain uppercase
// sans at one size throughout — set / name / variety on the left, the card number, grade word,
// grade and cert number right-aligned on the right; a barcode under the left lines and a small
// silver hologram sticker at the bottom centre (a made-up emblem — not PSA's logo).
function PsaLabel({ slab, name, number, setName, variety }: LabelProps) {
  const word = gradeWordFor('PSA', slab.grade, slab.tier)
  const line = { fontSize: cq(3.9), lineHeight: 1.2 }
  return (
    <div className="relative h-full overflow-hidden rounded-[0.8cqw]"
      style={{ background: '#d71f2b', padding: cq(1.5), boxShadow: '0 0.3cqw 0.8cqw rgba(0,0,0,0.25), inset 0 0.2cqw 0 rgba(255,255,255,0.25)' }}>
      <div className="relative h-full rounded-[0.4cqw] text-[#1b1b1b] uppercase font-medium tracking-[0.01em]"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif', background: 'linear-gradient(180deg, #ffffff 0%, #f7f7f5 100%)', padding: `${cq(1.4)} ${cq(2.4)}` }}>
        <div className="flex h-full">
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div className="truncate" style={line}>{setName || ' '}</div>
            <div className="truncate" style={line}>{name}</div>
            <div className="truncate" style={line}>{variety || ' '}</div>
            <Barcode seed={slab.cert || name} color="#111" className="h-[3.6cqw] w-fit" />
          </div>
          <div className="shrink-0 flex flex-col items-end justify-between pl-[2cqw] text-right">
            <div style={line}>#{number}</div>
            <div style={line}>{word}</div>
            <div style={line}>{slab.grade}</div>
            <div className="tabular-nums" style={line}>{slab.cert || ' '}</div>
          </div>
        </div>
        {/* Hologram sticker, bottom centre */}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-[0.4cqw] flex items-center justify-center"
          style={{ bottom: cq(1.2), width: cq(10), height: cq(4.2), background: 'linear-gradient(120deg, #b9c3cf, #eef1f5 25%, #c7d7ea 45%, #f3e6f0 62%, #d9e7d6 80%, #b9c3cf)', boxShadow: 'inset 0 0 0 0.2cqw rgba(255,255,255,0.8), 0 0.1cqw 0.3cqw rgba(0,0,0,0.25)' }}>
          <svg viewBox="0 0 24 12" style={{ width: '60%', height: '70%' }} aria-hidden>
            <path d="M12 1 L15 6 L12 11 L9 6 Z" fill="#c8102e" opacity="0.85" />
            <path d="M3 6 H8 M16 6 H21" stroke="#1d3f8f" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
          </svg>
        </div>
      </div>
    </div>
  )
}

// Beckett: the label in its tier's colour (silver; gold for 9.5 / Pristine 10; black with gold
// lettering for Black Label): a crest (a made-up laurel "B", not Beckett's logo) and the card's
// lines on the left, the four subgrades stacked in a column, and the grade — big — with its word
// on the far right; the serial number under the card lines.
function BgsLabel({ slab, name, number, setName, variety }: LabelProps) {
  const tone = labelTone('BGS', slab.grade, slab.tier)
  const bg = tone === 'black' ? 'linear-gradient(160deg, #222 0%, #0a0a0a 55%, #000 100%)'
    : tone === 'gold' ? 'linear-gradient(160deg, #f2df9f 0%, #d8b765 50%, #c09a4a 100%)'
    : 'linear-gradient(160deg, #f1f2f4 0%, #cdd1d7 50%, #b5bac2 100%)'
  const fg = tone === 'black' ? '#e8cc78' : '#15191f'
  const rule = tone === 'black' ? 'rgba(232,204,120,0.55)' : 'rgba(0,0,0,0.28)'
  const sub = slab.subgrades ?? {}
  const subs: Array<[string, string | undefined]> = [['Centering', sub.centering], ['Corners', sub.corners], ['Edges', sub.edges], ['Surface', sub.surface]]
  return (
    <div className="relative h-full rounded-[1cqw] overflow-hidden flex items-stretch"
      style={{ background: bg, color: fg, fontFamily: 'Arial, Helvetica, sans-serif', padding: `${cq(1.6)} ${cq(2.2)}`, gap: cq(1.8), boxShadow: `inset 0 0 0 0.45cqw ${tone === 'black' ? '#b8913c' : 'rgba(0,0,0,0.22)'}, 0 0.4cqw 1cqw rgba(0,0,0,0.3)` }}>
      {/* crest */}
      <div className="shrink-0 self-center relative flex items-center justify-center font-black" style={{ width: cq(8.5), height: cq(8.5), fontSize: cq(4.8), fontFamily: 'Georgia, serif' }}>
        <svg viewBox="0 0 40 40" className="absolute inset-0 w-full h-full" aria-hidden>
          <circle cx="20" cy="18" r="12.5" fill="none" stroke={fg} strokeWidth="1.4" />
          <circle cx="20" cy="18" r="10.2" fill="none" stroke={fg} strokeWidth="0.6" opacity="0.7" />
          {/* laurel sprigs curving up from the bottom */}
          {[0, 1, 2].map((i) => {
            const a = (200 + i * 22) * Math.PI / 180, b = (340 - i * 22) * Math.PI / 180
            const lx = 20 + 16 * Math.cos(a), ly = 18 - 16 * Math.sin(a), rx = 20 + 16 * Math.cos(b), ry = 18 - 16 * Math.sin(b)
            return (
              <g key={i} fill={fg}>
                <ellipse cx={lx} cy={ly} rx="2.6" ry="1.1" transform={`rotate(${-60 + i * 22} ${lx} ${ly})`} />
                <ellipse cx={rx} cy={ry} rx="2.6" ry="1.1" transform={`rotate(${60 - i * 22} ${rx} ${ry})`} />
              </g>
            )
          })}
        </svg>
        <span className="relative" style={{ marginTop: '-8%' }}>B</span>
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center uppercase font-bold leading-[1.15]" style={{ fontSize: cq(3.1) }}>
        <div className="truncate">{setName || ' '}</div>
        <div className="truncate" style={{ fontSize: cq(3.5) }}>{name}</div>
        <div className="truncate opacity-85">#{number}{variety ? ` ${variety}` : ''}</div>
        <div className="truncate opacity-75 tabular-nums font-semibold mt-[0.4cqw]" style={{ fontSize: cq(2.5) }}>{slab.cert || ' '}</div>
      </div>
      <div className="shrink-0 flex flex-col justify-center pl-[1.6cqw] uppercase font-bold" style={{ borderLeft: `0.25cqw solid ${rule}`, fontSize: cq(2.35), lineHeight: 1.3 }}>
        {subs.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-[1.4cqw]"><span className="opacity-80">{k}</span><span className="tabular-nums">{v || '–'}</span></div>
        ))}
      </div>
      <div className="shrink-0 flex flex-col items-center justify-center pl-[1.6cqw] uppercase" style={{ borderLeft: `0.25cqw solid ${rule}`, minWidth: cq(15) }}>
        <div className="font-black leading-none tabular-nums" style={{ fontSize: cq(10) }}>{slab.grade}</div>
        <div className="font-bold text-center leading-tight mt-[0.6cqw]" style={{ fontSize: cq(slab.tier === 'black' ? 2.1 : 2.5) }}>{gradeWordFor('BGS', slab.grade, slab.tier)}</div>
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
  // (variety: the card's version/rarity line — PSA and BGS print it)
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
export function FullSlab({ slab, name, number, setName, variety, children }: {
  slab: SlabInfo; name: string; number: string; setName?: string; variety?: string; children: React.ReactNode
}) {
  const c = String(slab.company ?? '').toUpperCase()
  const labelH = c === 'BGS' ? '20%' : '19%'
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
        <SlabLabel slab={slab} name={name} number={number} setName={setName} variety={variety} />
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
