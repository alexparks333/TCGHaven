// Card grading — each grader's real grade scale, the words they print beside the grade, their
// special labels, and their certification ("slab ID") numbers. One source for Add Card's graded
// section and every slab the app draws (components/SlabCase.tsx). Researched 2026-11-10 from the
// graders' own pages and hobby references (docs/user-data.md "Graded cards").

/** A 10 can be more than one label: BGS Pristine (gold) / Black Label; CGC, SGC and TAG Gem Mint /
 *  Pristine. Absent = the grade's ordinary label. */
export type GradeTier = 'pristine' | 'black'

export interface Subgrades { centering?: string; corners?: string; edges?: string; surface?: string }
export const SUBGRADE_KEYS = ['centering', 'corners', 'edges', 'surface'] as const

export interface GraderInfo {
  id: string
  name: string
  /** Every numeric grade issued, high to low */
  grades: string[]
  /** The ones offered as one-tap choices */
  quick: string[]
  /** Labels a 10 can carry, besides the ordinary one ([] = just one kind of 10) */
  tens: Array<{ tier: GradeTier | null; label: string }>
  /** Subgrades printed on the label */
  subgrades: boolean
  cert: { hint: string; numeric: boolean; lookup?: (cert: string) => string; lookupPage?: string }
}

const halves = (from: number, to: number) => {
  const out: string[] = []
  for (let g = from; g >= to - 1e-9; g -= 0.5) out.push(String(g))
  return out
}

export const GRADERS: Record<string, GraderInfo> = {
  // PSA: whole grades, and half grades from 1.5 to 8.5 — never a 9.5. No premium labels.
  PSA: {
    id: 'PSA', name: 'PSA',
    grades: ['10', '9', ...halves(8.5, 1)],
    quick: ['10', '9', '8.5', '8', '7.5', '7'],
    tens: [],
    subgrades: false,
    cert: { hint: '8–9 digits', numeric: true, lookup: (c) => `https://www.psacard.com/cert/${encodeURIComponent(c)}` },
  },
  // BGS: half grades throughout. 10 = Pristine (gold label); Black Label = a 10 with all four
  // subgrades 10. 9.5 also gold, the rest silver. Four subgrades on every label.
  BGS: {
    id: 'BGS', name: 'Beckett (BGS)',
    grades: halves(10, 1),
    quick: ['10', '9.5', '9', '8.5', '8', '7.5'],
    tens: [{ tier: 'pristine', label: 'Pristine' }, { tier: 'black', label: 'Black Label' }],
    subgrades: true,
    cert: { hint: '10 digits', numeric: true, lookupPage: 'https://www.beckett.com/grading/card-lookup' },
  },
  // CGC Cards: half grades; 9.5 = Mint+; two 10s — Gem Mint and Pristine (gold label).
  CGC: {
    id: 'CGC', name: 'CGC',
    grades: halves(10, 1),
    quick: ['10', '9.5', '9', '8.5', '8', '7.5'],
    tens: [{ tier: null, label: 'Gem Mint' }, { tier: 'pristine', label: 'Pristine' }],
    subgrades: false,
    cert: { hint: '7–10 digits', numeric: true, lookup: (c) => `https://www.cgccards.com/certlookup/${encodeURIComponent(c)}/` },
  },
  // SGC: half grades; 9.5 = Mint+; two 10s — Gem Mint and Pristine (gold label). Black "tuxedo" label.
  SGC: {
    id: 'SGC', name: 'SGC',
    grades: halves(10, 1),
    quick: ['10', '9.5', '9', '8.5', '8', '7.5'],
    tens: [{ tier: null, label: 'Gem Mint' }, { tier: 'pristine', label: 'Pristine' }],
    subgrades: false,
    cert: { hint: '7 digits', numeric: false, lookupPage: 'https://gosgc.com/cert-code-lookup' },
  },
  // TAG: half grades except between 9 and 10 (no 9.5); two 10s — Gem Mint and Pristine.
  TAG: {
    id: 'TAG', name: 'TAG',
    grades: ['10', '9', ...halves(8.5, 1)],
    quick: ['10', '9', '8.5', '8', '7.5', '7'],
    tens: [{ tier: null, label: 'Gem Mint' }, { tier: 'pristine', label: 'Pristine' }],
    subgrades: false,
    cert: { hint: '1 letter + 7 digits', numeric: false, lookup: (c) => `https://my.taggrading.com/card/${encodeURIComponent(c)}` },
  },
}

/** Graders offered in Add Card, in this order ("Other" = any company, any grade) */
export const GRADER_CHOICES = ['PSA', 'BGS', 'CGC', 'SGC', 'TAG', 'HGA', 'CSG', 'Other']

export function graderOf(company: string | undefined): GraderInfo | undefined {
  return GRADERS[String(company ?? '').toUpperCase()]
}

const AUTH = /^(a|au|auth|authentic)$/i

/** Whether this grader issues this grade (unknown graders: any grade). "Authentic" is always fine. */
export function isValidGrade(company: string, grade: string): boolean {
  const g = graderOf(company)
  const t = grade.trim()
  if (!g || !t || AUTH.test(t)) return true
  const n = Number(t)
  return Number.isFinite(n) && g.grades.includes(String(n))
}

/** The grader's own word(s) for this grade, as printed on the label ("GEM MT", "NM-MT+", "PRISTINE") */
export function gradeWord(company: string, grade: string, tier?: GradeTier | null): string {
  const t = String(grade ?? '').trim()
  if (AUTH.test(t)) return 'AUTHENTIC'
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return t.toUpperCase()
  const half = n % 1 !== 0
  const base = Math.floor(n)
  const c = String(company ?? '').toUpperCase()
  if (c === 'PSA') {
    if (n === 1.5) return 'FR'
    const psa: Record<number, string> = { 10: 'GEM MT', 9: 'MINT', 8: 'NM-MT', 7: 'NM', 6: 'EX-MT', 5: 'EX', 4: 'VG-EX', 3: 'VG', 2: 'GOOD', 1: 'PR' }
    return (psa[base] ?? '') + (half && psa[base] ? '+' : '')
  }
  if (c === 'BGS') {
    if (n >= 10) return tier === 'black' ? 'BLACK LABEL PRISTINE' : 'PRISTINE'
    if (n === 9.5) return 'GEM MINT'
    const bgs: Record<number, string> = { 9: 'MINT', 8: 'NM-MT', 7: 'NM', 6: 'EX-MT', 5: 'EX', 4: 'VG-EX', 3: 'VG', 2: 'GOOD', 1: n === 1.5 ? 'FAIR' : 'POOR' }
    return n === 1.5 ? 'FAIR' : (bgs[base] ?? '') + (half && bgs[base] ? '+' : '')
  }
  if (c === 'CGC') {
    if (n >= 10) return tier === 'pristine' ? 'PRISTINE' : 'GEM MINT'
    if (n === 9.5) return 'MINT+'
    if (n === 1.5) return 'FAIR'
    const cgc: Record<number, string> = { 9: 'MINT', 8: 'NM/MINT', 7: 'NEAR MINT', 6: 'EX/NM', 5: 'EXCELLENT', 4: 'VG/EX', 3: 'VERY GOOD', 2: 'GOOD', 1: 'POOR' }
    return (cgc[base] ?? '') + (half && cgc[base] ? '+' : '')
  }
  if (c === 'SGC') {
    if (n >= 10) return tier === 'pristine' ? 'PRISTINE' : 'GEM MINT'
    if (n === 9.5) return 'MINT+'
    const sgc: Record<number, string> = { 9: 'MINT', 8: 'NM-MT', 7: 'NM', 6: 'EX-NM', 5: 'EX', 4: 'VG-EX', 3: 'VG', 2: 'GOOD', 1: 'POOR' }
    return (sgc[base] ?? '') + (half && sgc[base] ? '+' : '')
  }
  if (c === 'TAG') {
    if (n >= 10) return tier === 'pristine' ? 'PRISTINE' : 'GEM MINT'
    if (n === 1.5) return 'FAIR'
    const tag: Record<number, string> = { 9: 'MINT', 8: 'NM MT', 7: 'NM', 6: 'EX MT', 5: 'EX', 4: 'VG EX', 3: 'VG', 2: 'GOOD', 1: 'POOR' }
    return (tag[base] ?? '') + (half && tag[base] ? '+' : '')
  }
  // Other graders: the common wording
  if (n >= 10) return tier === 'pristine' ? 'PRISTINE' : 'GEM MINT'
  if (n >= 9.5) return 'GEM MINT'
  if (n >= 9) return 'MINT'
  if (n >= 8) return 'NM-MT'
  if (n >= 7) return 'NM'
  return ''
}

/** "BGS Black Label 10", "CGC Pristine 10", "PSA 9" — how a graded copy reads in a list */
export function gradeLine(company: string, grade: string, tier?: GradeTier | null): string {
  const t = tier === 'black' ? ' Black Label' : tier === 'pristine' && String(company).toUpperCase() !== 'BGS' ? ' Pristine' : ''
  return `${company}${t}${grade ? ` ${grade}` : ''}`
}

/** The label colour family a slab gets: BGS black / gold / silver; CGC, SGC gold for Pristine */
export function labelTone(company: string, grade: string, tier?: GradeTier | null): 'black' | 'gold' | 'silver' | 'standard' {
  const c = String(company ?? '').toUpperCase()
  const n = parseFloat(grade)
  if (c === 'BGS') return tier === 'black' ? 'black' : n >= 9.5 ? 'gold' : 'silver'
  if ((c === 'CGC' || c === 'SGC' || c === 'TAG') && tier === 'pristine' && n >= 10) return 'gold'
  return 'standard'
}
