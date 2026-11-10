// A graded card's slab — the grader's label colours, the word printed beside the grade, and the
// full acrylic case (label up top, the card in its window below). Used by the Cardex zoom view
// (CardexPage.tsx) and Add Card's card preview (AddCardDialog.tsx).

export type SlabInfo = { company: string; grade: string }

// Label colors roughly matching each grader's real slab label.
const SLAB_LABEL: Record<string, { bg: string; fg: string; accent: string }> = {
  PSA: { bg: '#ffffff', fg: '#1a1a1a', accent: '#c8102e' },
  BGS: { bg: '#d9dce1', fg: '#111827', accent: '#9a7b2f' },
  CGC: { bg: '#1f3a68', fg: '#ffffff', accent: '#8fb3e8' },
  SGC: { bg: '#141414', fg: '#ffffff', accent: '#d4af37' },
  TAG: { bg: '#0b0b0b', fg: '#e5e5e5', accent: '#9ca3af' },
}
const SLAB_LABEL_FALLBACK = { bg: '#374151', fg: '#ffffff', accent: '#9ca3af' }

export function slabStyle(company: string) {
  return SLAB_LABEL[company.toUpperCase()] ?? SLAB_LABEL_FALLBACK
}

// The word each grader prints next to the number ("MINT 9", "GEM MT 10").
export function gradeWord(company: string, grade: string): string {
  const n = parseFloat(grade)
  if (!Number.isFinite(n)) return grade.toUpperCase()
  if (company.toUpperCase() === 'PSA') {
    const psa: Record<number, string> = { 10: 'GEM MT', 9: 'MINT', 8: 'NM-MT', 7: 'NM', 6: 'EX-MT', 5: 'EX', 4: 'VG-EX', 3: 'VG', 2: 'GOOD', 1.5: 'FR', 1: 'PR' }
    return psa[n] ?? ''
  }
  if (n >= 10) return 'PRISTINE'
  if (n >= 9.5) return 'GEM MINT'
  if (n >= 9) return 'MINT'
  if (n >= 8) return 'NM-MT'
  if (n >= 7) return 'NM'
  return ''
}

// Zoom-view slab: the full graded case — acrylic shell, grader label up top (card name, set,
// grade word + number), and the card sitting in its own inner window below.
export function FullSlab({ slab, name, number, setName, children }: {
  slab: SlabInfo; name: string; number: string; setName?: string; children: React.ReactNode
}) {
  const label = slabStyle(slab.company)
  const word = gradeWord(slab.company, slab.grade)
  return (
    <div
      className="relative w-full h-full rounded-[18px] p-[4%] flex flex-col gap-[3%] overflow-hidden"
      // Clear acrylic: barely-tinted see-through body, with the light caught at the thick polished
      // edges (bright outer rim, a softer inner bevel) the way a real slab reads.
      style={{
        background: 'linear-gradient(160deg, rgba(235,244,255,0.20) 0%, rgba(220,232,245,0.07) 32%, rgba(220,232,245,0.04) 68%, rgba(235,244,255,0.15) 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.85), inset 0 0 0 3px rgba(225,235,248,0.22), inset 0 0 0 4px rgba(255,255,255,0.4), inset 0 0 0 9px rgba(225,235,248,0.07), inset 0 2px 12px rgba(255,255,255,0.22), inset 0 -8px 20px rgba(150,170,195,0.14)',
      }}
    >
      {/* Label */}
      <div
        className="relative shrink-0 rounded-[6px] flex items-stretch overflow-hidden"
        style={{ height: '17%', backgroundColor: label.bg, color: label.fg, boxShadow: `inset 0 0 0 2px ${label.accent}, 0 1px 3px rgba(0,0,0,0.25)` }}
      >
        <div className="flex-1 min-w-0 flex flex-col justify-center pl-3 pr-1 py-1.5 gap-[2px]">
          <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70 truncate">{setName ?? ''}</div>
          <div className="text-[13px] font-extrabold uppercase leading-tight truncate">{name}</div>
          <div className="flex items-center gap-1.5 mt-[2px]">
            <span className="text-[11px] font-black italic tracking-wider px-1 rounded-[2px]" style={{ backgroundColor: label.accent, color: label.bg }}>{slab.company}</span>
            <span className="text-[10px] font-semibold opacity-70">#{number}</span>
          </div>
        </div>
        <div className="flex flex-col items-end justify-center pr-3 pl-2 shrink-0">
          {word && <div className="text-[11px] font-extrabold tracking-wide leading-none">{word}</div>}
          <div className="text-[30px] font-black leading-none mt-0.5">{slab.grade}</div>
          {/* decorative barcode */}
          <div className="flex items-end gap-[1px] h-[7px] mt-1 opacity-70">
            {[2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 2].map((w, i) => (
              <span key={i} style={{ width: w, height: '100%', backgroundColor: label.fg }} />
            ))}
          </div>
        </div>
      </div>
      {/* Card window */}
      <div
        className="relative flex-1 min-h-0 rounded-[8px] p-[2%] flex items-center justify-center"
        // The recessed well the card sits in — a raised clear frame around it, darker inside
        style={{ background: 'rgba(200,215,232,0.05)', boxShadow: '0 0 0 1px rgba(255,255,255,0.28), inset 0 0 0 1px rgba(255,255,255,0.55), inset 0 0 0 4px rgba(225,235,248,0.09), inset 0 2px 10px rgba(0,0,0,0.35)' }}
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
