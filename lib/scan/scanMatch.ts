// The card scanner's text matcher: what the phone read off a card (Apple Vision OCR, in the
// iPhone app's native scanner — ios/App/App/CardScanner.swift) → which catalog cards it can be.
// Plan and research: CardScanner.md.
//
// Every game prints an identifier at the bottom of the card, and that's what pins down the exact
// printing (the picture alone confuses reprints of the same art):
//
//   Pokémon (EN)   "025/198", "TG05/TG30", "SWSH123" (black-star promo)
//   Pokémon (JP)   "001/066" + the set mark ("SV4K", "M6a") — the catalog's set names start with it
//   One Piece      "OP05-119", "ST01-012", "P-001" — reprints (The Best, Super Pre-Release…) keep
//                  the original code, so it's read from the card id, not the set it's sold in
//   Lorcana        "143/204 • EN • 10" — number / total • language • set number
//   Riftbound      "OGN • 048/298"
//   Magic          "0280" + "BLB • EN" (modern) or "123/264" + "M20 • EN"
//
// The name (fuzzy, OCR-tolerant) confirms it, and is the fallback when no code could be read.
// Candidates that still tie (One Piece parallels share a code and name; Pokémon reprints share a
// number) are separated by the native picture comparison — lib/scan/decide.ts combines the two.
//
// Self-contained (no imports) so `npm run test:scan` runs it straight under Node.

export interface OcrLine {
  text: string
  // Position on the flattened, upright card, 0–1 from the top-left
  x: number
  y: number
  w: number
  h: number
}

export interface ScanCard {
  id: string
  name: string
  number: string
  set?: string
  setName?: string
  setCode?: string
  publicCode?: string
}

export type ScanCatalogKey = 'pokemon' | 'pokemon-jp' | 'lorcana' | 'riftbound' | 'onepiece' | 'mtg'

export interface ScanCatalog {
  key: ScanCatalogKey
  cards: ScanCard[]
  // Pokémon sets (EN: id + total incl. secret rares; JP: id + name "SV4K: Ancient Roar")
  sets?: Array<{ id: string; name: string; total?: number }>
}

export interface ScanCandidate {
  catalog: ScanCatalogKey
  id: string
  name: string
  score: number   // 0–100 from the text alone
  why: string     // what matched — for the tray and for debugging
  // An identifier was read (number, code), or the name belongs to one card only. False = found by
  // a name many printings share — never added without asking.
  exact: boolean
}

export interface ScanClues {
  fractions: Array<{ pre: string; num: string; suf: string; den: number }>
  promos: string[]            // Pokémon black-star numbers: "SWSH123", "SM60"
  starPromo: Array<{ set: string; num: string }> // "SVP 085" → svp / 85
  opCodes: string[]           // "OP05-119", "P-001"
  jpPromos: Array<{ num: string; mark: string }> // "388/SM-P" → 388 in the "SM-P" promo set
  lorcanaSet: string[]        // "• EN • 10" → "10"
  mtgSets: string[]           // "BLB • EN" → "blb"
  bottomTokens: string[]      // short words near the bottom (set codes, Japanese set marks)
  bottomNumbers: string[]     // bare numbers near the bottom (MTG collector numbers)
  loneNumbers: string[]       // a number alone on its line low on the card ("95a" on e-Card era Pokémon)
  nameLines: string[]         // the biggest text — most likely the card name
  words: Set<string>          // every folded word read, for name matching
  japanese: boolean
  pokemonWords: boolean       // "HP", "Weakness", "Retreat" — printed on every Pokémon card
  slab: SlabLabel | null      // a graded card's label (PSA / CGC / BGS / SGC), when one was read
  riftboundPromo: boolean     // "156/219 • P" — the promo mark after a Riftbound number
}

/** What a grading company's label says. PSA's, for example:
 *    2022 POKEMON SWSH        #TG30
 *    FA/MEW VMAX              MINT
 *    LOST ORIGIN              9
 *                             140713476        */
export interface SlabLabel {
  company: 'PSA' | 'CGC' | 'BGS' | 'SGC' | ''
  grade: string        // "9", "10", "8.5", "Authentic"
  cert: string
  number: string       // "TG30"
  game: ScanCatalogKey | null
  text: string[]       // the label's other lines: name, set, variant ("FA/MEW VMAX", "LOST ORIGIN")
}

// ── Text helpers ────────────────────────────────────────────────────────────

export function fold(s: string): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`ʼ´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** "025" → "25", "TG05" → "tg5", "4a" → "4a" — same key on both sides of a comparison */
export function numKey(s: string | undefined): string {
  return fold(String(s ?? '').split('/')[0]).replace(/\d+/g, (d) => String(parseInt(d, 10))).replace(/ /g, '')
}

// OCR slips inside a card number: O for 0, l / I / | for 1, S for 5. Only applied to the digit
// part of something already shaped like "123/456", so real letters elsewhere are left alone.
const DIGITISH = '[0-9OoIlS|]'
function toDigits(s: string): string {
  return s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5')
}

// Cyrillic / Greek letters Vision sometimes reads in place of Latin ones ("Sv6а" with a Cyrillic а)
const HOMOGLYPHS: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  // …and digits: Cyrillic З for 3 ("TGЗ0/TG30" — read off a real Mew VMAX), б for 6, Ч for 4, О for 0
  'З': '3', 'з': '3', 'б': '6', 'Б': '6', 'Ч': '4', 'І': 'I', 'і': 'i', 'Ѕ': 'S', 'ѕ': 's', 'Ј': 'J', 'ј': 'j', 'Ү': 'Y',
  '•': '•', '・': '•', '／': '/',
}
function latin(s: string): string {
  let out = ''
  for (const ch of s) out += HOMOGLYPHS[ch] ?? ch
  return out
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** The name as printed on the card: catalog suffixes for stamps and variants aren't
 *  ("Pumpkaboo (Pokemon League) [4th Place]" → "Pumpkaboo", "Yone (Signature)" → "Yone",
 *  "Daybreak Ranger // Nightfall Predator" → "Daybreak Ranger"). A name's own brackets stay:
 *  One Piece's "Mr.3(Galdino)" has no space before them. */
export function printedName(name: string): string {
  return name.split(' // ')[0].replace(/\s+[([][^)\]]*[)\]]/g, '').trim() || name
}

/** How much of a card name was read on the card, 0–1 (OCR slips of a letter or two allowed) */
export function nameScore(name: string, words: Set<string>): number {
  const tokens = fold(name).split(' ').filter((t) => t.length >= 2)
  if (tokens.length === 0) return 0
  let got = 0
  for (const t of tokens) {
    if (words.has(t)) { got += 1; continue }
    if (t.length < 4) continue
    const max = t.length >= 7 ? 2 : 1
    for (const w of Array.from(words)) {
      if (editDistance(t, w, max) <= max) { got += 0.8; break }
    }
  }
  return got / tokens.length
}

const HP_NOISE = /\b(?:hp\s?\d{2,3}|\d{2,3}\s?hp|basic|stage\s?[12]|mega|evolves from.*)\b/gi

// ── Reading the clues off the OCR lines ─────────────────────────────────────

// "025/198", "TG05/TG30", "F091/086" (a regulation mark glued on), "226*/219" (Riftbound signature)
const FRACTION = new RegExp(`(?:^|[^A-Za-z0-9])([A-Z]{0,4}?)(${DIGITISH}{1,3})([a-z*]?)\\s?\\/\\s?(?:[A-Z]{0,4})\\s?(${DIGITISH}{2,3})(?![0-9])`, 'g')

export function readClues(lines: OcrLine[]): ScanClues {
  const clues: ScanClues = {
    fractions: [], promos: [], starPromo: [], opCodes: [], jpPromos: [], lorcanaSet: [], mtgSets: [], loneNumbers: [],
    bottomTokens: [], bottomNumbers: [], nameLines: [], words: new Set(), japanese: false, pokemonWords: false, slab: null, riftboundPromo: false,
  }
  const add = <T>(arr: T[], v: T, same: (a: T) => boolean) => { if (!arr.some(same)) arr.push(v) }

  for (const line of lines) {
    const raw = String(line.text ?? '').slice(0, 200)
    if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(raw)) clues.japanese = true
    const text = latin(raw)
    for (const w of fold(text).split(' ')) if (w) clues.words.add(w)

    for (const m of Array.from(text.matchAll(FRACTION))) {
      const digits = toDigits(m[2]), den = parseInt(toDigits(m[4]), 10)
      // At least one real digit on each side — "SOS/OIL" is not a card number
      if (!/\d/.test(m[2]) || !/\d/.test(m[4]) || !den) continue
      const num = String(parseInt(digits, 10))
      const pre = m[1], suf = m[3] ?? ''
      add(clues.fractions, { pre, num, suf, den }, (o) => o.pre === pre && o.num === num && o.suf === suf && o.den === den)
      // A single letter in front is usually the regulation mark, not part of the number
      if (pre.length === 1) add(clues.fractions, { pre: '', num, suf, den }, (o) => o.pre === '' && o.num === num && o.suf === suf && o.den === den)
    }
    if (/\d{2,3}\s?\/\s?\d{2,3}\s?[•·]\s?P\b/.test(text)) clues.riftboundPromo = true
    // Japanese promos: "388/SM-P", "010/PCG-P", "004/BW-P"
    for (const m of Array.from(text.matchAll(/(\d{3})\s?\/\s?([A-Za-z]{1,4}-?P)\b/g))) {
      const jp = { num: String(parseInt(m[1], 10)), mark: m[2].toLowerCase() }
      add(clues.jpPromos, jp, (o) => o.num === jp.num && o.mark === jp.mark)
    }
    for (const m of Array.from(text.matchAll(/\b(SWSH|SM|XY|BW|DP|HGSS)\s?(\d{1,3})\b/g))) {
      const p = `${m[1]}${parseInt(m[2], 10)}`
      add(clues.promos, p, (o) => o === p)
    }
    for (const m of Array.from(text.matchAll(/\b(SVP|MEP)\b\D{0,6}(\d{1,3})\b/g))) {
      const s = { set: m[1].toLowerCase(), num: String(parseInt(m[2], 10)) }
      add(clues.starPromo, s, (o) => o.set === s.set && o.num === s.num)
    }
    // "OP05-119", "OPO4-021" (O for 0), "OP17-042E" (the rarity glued on)
    for (const m of Array.from(text.toUpperCase().matchAll(/\b(OP|ST|EB|PRB|GC)\s?([0-9O]{2})\s?[-–—]\s?([0-9O]{3})/g))) {
      if (!/\d/.test(m[2] + m[3])) continue
      const c = `${m[1]}${m[2].replace(/O/g, '0')}-${m[3].replace(/O/g, '0')}`
      add(clues.opCodes, c, (o) => o === c)
    }
    for (const m of Array.from(text.toUpperCase().matchAll(/(?:^|[^A-Z0-9])P\s?[-–—]\s?(\d{3})(?![0-9])/g))) {
      const c = `P-${m[1]}`
      add(clues.opCodes, c, (o) => o === c)
    }
    for (const m of Array.from(text.matchAll(/\b(EN|FR|DE|IT|JA|ZH|ES)\s?[•·.*-]?\s?(\d{1,2})\b/g))) {
      const s = String(parseInt(m[2], 10))
      add(clues.lorcanaSet, s, (o) => o === s)
    }
    for (const m of Array.from(text.matchAll(/\b([A-Z0-9]{3,5})\s?[•·*.]\s?(EN|JP|JA|FR|DE|IT|ES|PT|KO|RU|ZHS|ZHT|PH)\b/g))) {
      const s = m[1].toLowerCase()
      add(clues.mtgSets, s, (o) => o === s)
    }
    // e-Card era Pokémon print the number on its own ("95a"), no "/total"
    const lone = text.trim().match(/^(\d{1,3})([a-z]?)$/)
    if (lone && line.y >= 0.75) {
      const n = `${parseInt(lone[1], 10)}${lone[2] ?? ''}`
      add(clues.loneNumbers, n, (o) => o === n)
    }
    if (line.y + line.h >= 0.8) {
      // Set codes and marks: "OGN", "BLB", "SV4K", "SM2+", "M6a" — also "SM 9b" read as two words,
      // and "s1la" (S11a with a 1 read as l)
      const parts = text.split(/[\s•·*|/]+/).map((p) => p.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+]+$/g, '')).filter(Boolean)
      const tokens = [...parts]
      for (let i = 0; i + 1 < parts.length; i++) {
        if (/^[A-Za-z]{1,3}$/.test(parts[i]) && /^\d/.test(parts[i + 1])) tokens.push(parts[i] + parts[i + 1])
      }
      for (const t of tokens) {
        if (!/^[A-Za-z]{1,4}[\dl]{0,2}[a-zA-Z+]?$/.test(t)) continue
        for (const v of [t, t.slice(0, 1) + t.slice(1).replace(/l(?=\d|[a-z]?$)/g, '1')]) add(clues.bottomTokens, v, (o) => o === v)
      }
      for (const m of Array.from(text.matchAll(/(?:^|[^0-9/])(\d{1,4})([a-z]?)(?![0-9/])/g))) {
        const n = `${parseInt(m[1], 10)}${m[2] ?? ''}`
        add(clues.bottomNumbers, n, (o) => o === n)
      }
    }
  }

  clues.slab = readSlabLabel(lines)
  clues.pokemonWords = ['hp', 'weakness', 'resistance', 'retreat', 'trainer', 'pokemon'].some((w) => clues.words.has(w))
    || lines.some((l) => /弱点|抵抗力|にげる/.test(l.text))
  // The name: the biggest text, or anything along the top edge (Pokémon and Magic print it there)
  const named = lines.filter((l) => /[A-Za-z\u3040-\u30ff\u4e00-\u9faf]{2,}/.test(l.text))
  const picks = [...named].sort((a, b) => b.h - a.h).slice(0, 6)
  for (const l of named) if (l.y < 0.12 && !picks.includes(l)) picks.push(l)
  clues.nameLines = picks
    .map((l) => latin(l.text).replace(HP_NOISE, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 2)
  return clues
}

// ── Graded slabs ────────────────────────────────────────────────────────────

const GRADE_WORDS = /^(GEM\s?MT|GEM\s?MINT|PRISTINE|MINT\+?|NM-MT\+?|NM\+?|EX-MT\+?|EX\+?|VG-EX\+?|VG\+?|GOOD\+?|FAIR|PR|POOR|AUTHENTIC|AUTH)\b/i

/** A grading company's label along the top of a slab: the card number ("#TG30"), the grade and
 *  the cert number, plus the name/set lines. Null when the lines don't look like a label. */
export function readSlabLabel(lines: OcrLine[]): SlabLabel | null {
  const top = lines.filter((l) => l.y < 0.3).map((l) => ({ ...l, text: latin(l.text).trim() }))
  const numLine = top.find((l) => /^#\s?[A-Z]{0,4}[0-9OIl]{1,4}[a-z]?$/i.test(l.text))
  const certLine = top.find((l) => /^\d{7,10}$/.test(l.text.replace(/\s/g, '')))
  const gradeIdx = top.findIndex((l) => GRADE_WORDS.test(l.text))
  // Two of the three tell-tales — a "#number", a cert, a grade word
  if ([numLine, certLine, gradeIdx >= 0 ? 1 : undefined].filter(Boolean).length < 2) return null

  let grade = ''
  if (gradeIdx >= 0) {
    const inline = top[gradeIdx].text.match(/(\d{1,2}(?:\.5)?)\s*$/)
    if (inline) grade = inline[1]
    else {
      // The number usually sits on its own line just below the grade word
      const below = top.filter((l) => /^\d{1,2}(\.5)?$/.test(l.text) && Math.abs(l.x - top[gradeIdx].x) < 0.15 && l.y > top[gradeIdx].y)
        .sort((a, b) => a.y - b.y)[0]
      if (below) grade = below.text
    }
    if (/^AUTH/i.test(top[gradeIdx].text)) grade = 'Authentic'
  }
  const all = top.map((l) => l.text).join(' ').toUpperCase()
  const company: SlabLabel['company'] = /\bCGC\b/.test(all) ? 'CGC' : /\bBGS\b|BECKETT/.test(all) ? 'BGS' : /\bSGC\b/.test(all) ? 'SGC' : 'PSA'
  const game: ScanCatalogKey | null = /POKEMON JAPANESE|JAPANESE/.test(all) ? 'pokemon-jp' : /POKEMON|POKÉMON/.test(all) ? 'pokemon'
    : /ONE PIECE/.test(all) ? 'onepiece' : /LORCANA/.test(all) ? 'lorcana' : /MAGIC|MTG/.test(all) ? 'mtg' : /RIFTBOUND/.test(all) ? 'riftbound' : null
  const number = numLine ? toDigitsAfterPrefix(numLine.text.replace(/^#\s?/, '')) : ''
  const used = new Set([numLine, certLine, gradeIdx >= 0 ? top[gradeIdx] : undefined].filter(Boolean))
  const text = top.filter((l) => !used.has(l) && !/^\d{1,2}(\.5)?$/.test(l.text) && /[A-Za-z]{2,}/.test(l.text))
    .map((l) => l.text.replace(/^\d{4}\s+/, '').replace(/^(FA|SA|AA|RH|HOLO|REV\.? FOIL)\//i, ''))
  return { company, grade, cert: certLine ? certLine.text.replace(/\s/g, '') : '', number, game, text }
}

/** "TG3O" → "TG30": the letters in front stay, O / I / l after them are digits */
function toDigitsAfterPrefix(s: string): string {
  const m = s.match(/^([A-Za-z]*?)([0-9OIl]+)([a-z]?)$/)
  return m ? m[1] + m[2].replace(/O/g, '0').replace(/[Il]/g, '1') + m[3] : s
}

// ── Candidates ──────────────────────────────────────────────────────────────

/** The code printed on a One Piece card. Reprints keep their original code: apitcg ids carry it
 *  ("OP01-006_p2" sold in PRB01 still says OP01-006); TCGplayer-only cards use set + number. */
export function onePiecePrintedCode(c: ScanCard): string {
  const m = c.id.match(/^([A-Z]{1,3}\d{0,2}-\d{3})(?:_p\d+)?$/)
  if (m) return m[1]
  return c.set === 'P' ? `P-${c.number}` : `${c.set}-${c.number}`
}

/** "SV4K: Ancient Roar" → "sv4k", "DPt-P Promotional cards" → "dpt-p" (Japanese set marks) */
function jpSetMark(setName: string): string | null {
  const m = setName.match(/^([A-Za-z0-9+-]{1,8}):/) ?? setName.match(/^([A-Za-z0-9+]{1,5}-P)\b/)
  return m ? m[1].toLowerCase() : null
}

function riftboundParts(publicCode: string | undefined) {
  const m = String(publicCode ?? '').match(/^([A-Z]+)-(\d+)([a-z*]?)\/(\d+)/)
  return m ? { set: m[1], num: String(parseInt(m[2], 10)) + m[3], den: parseInt(m[4], 10) } : null
}

type RbParts = NonNullable<ReturnType<typeof riftboundParts>>

// Lookups built once per catalog and reused: a scan only touches the cards whose number, code or
// name it read — never the whole catalog (160k cards across the games; looping over all of them
// took 1.5–2 s per scan on Vercel). Rebuilt when the catalog or its set list changes size, and
// every 10 minutes so price and photo updates from the syncs come through.
interface CatIndex {
  byId: Map<string, ScanCard>
  byNum: Map<string, ScanCard[]>     // numKey(card.number)
  byOpCode: Map<string, ScanCard[]>  // One Piece printed code
  bySet: Map<string, ScanCard[]>
  rb: Map<string, Array<{ c: ScanCard; p: RbParts }>> // Riftbound "num/den"
  names: Map<string, ScanCard[]>     // folded name (and printed name) → cards
  marks: Map<string, Set<string>>    // Japanese set mark → set ids
  totals: Map<string, number>        // set id → card count
}
const indexCache = new Map<string, { sig: string; at: number; index: CatIndex }>()
const INDEX_TTL_MS = 10 * 60 * 1000
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]) }

export function catalogIndex(cat: ScanCatalog): CatIndex {
  const sig = `${cat.cards.length}|${cat.cards[0]?.id}|${cat.cards[cat.cards.length - 1]?.id}|${cat.sets?.length ?? 0}`
  const hit = indexCache.get(cat.key)
  if (hit && hit.sig === sig && Date.now() - hit.at < INDEX_TTL_MS) return hit.index
  const index: CatIndex = { byId: new Map(), byNum: new Map(), byOpCode: new Map(), bySet: new Map(), rb: new Map(), names: new Map(), marks: new Map(), totals: new Map() }
  for (const c of cat.cards) {
    index.byId.set(c.id, c)
    const k = numKey(c.number)
    if (k) push(index.byNum, k, c)
    if (c.set) push(index.bySet, String(c.set), c)
    if (cat.key === 'onepiece') push(index.byOpCode, onePiecePrintedCode(c), c)
    if (cat.key === 'riftbound') {
      const p = riftboundParts(c.publicCode)
      if (p) push(index.rb, `${numKey(p.num)}/${p.den}`, { c, p })
    }
    // Lorcana names are "Elsa - Snow Queen"; the card prints the two parts on separate lines, so
    // the first part alone is a key too
    const keys = new Set([fold(c.name), fold(printedName(c.name))])
    if (cat.key === 'lorcana' && c.name.includes(' - ')) keys.add(fold(c.name.split(' - ')[0]))
    for (const nk of Array.from(keys)) if (nk) push(index.names, nk, c)
  }
  for (const st of cat.sets ?? []) {
    index.totals.set(st.id, st.total ?? 0)
    const mk = jpSetMark(st.name)
    if (!mk) continue
    if (!index.marks.has(mk)) index.marks.set(mk, new Set())
    index.marks.get(mk)!.add(st.id)
  }
  indexCache.set(cat.key, { sig, at: Date.now(), index })
  return index
}

// Enough that the right card survives a crowd of same-number look-alikes (Japanese cards share
// numbers across hundreds of sets) — the picture comparison sorts them out
const MAX_CANDIDATES = 40
const NAME_WEIGHT = 35

// Which game the card looks like from its layout text alone (several can be true; none = no hint)
function gameHints(clues: ScanClues, catalogs: ScanCatalog[]): Set<string> {
  const hints = new Set<string>()
  if (clues.pokemonWords) { hints.add('pokemon'); hints.add('pokemon-jp') }
  if (clues.opCodes.length) hints.add('onepiece')
  // "143/204 • EN • 10" — only Lorcana prints a set number after the language
  if (clues.lorcanaSet.length && clues.fractions.some((f) => !f.pre)) hints.add('lorcana')
  const mtg = catalogs.find((c) => c.key === 'mtg')
  if (mtg && clues.mtgSets.some((st) => catalogIndex(mtg).bySet.has(st))) hints.add('mtg')
  return hints
}

export function matchScan(clues: ScanClues, catalogs: ScanCatalog[]): ScanCandidate[] {
  const best = new Map<string, ScanCandidate>()
  const hints = gameHints(clues, catalogs)
  const offer = (catalog: ScanCatalogKey, c: ScanCard, codeScore: number, why: string, exact = true) => {
    // Stamps and variant suffixes aren't printed as words, so they mustn't count against a card:
    // a League-stamped copy ties with the plain one on text, and the picture (or the person) decides
    const printed = printedName(c.name)
    // Riftbound legends are "Master Yi, Wuju Bladesman" in some sets and just "Wuju Bladesman" in
    // others — the title alone is enough
    const ns = catalog === 'riftbound' && printed.includes(', ')
      ? Math.max(nameScore(printed, clues.words), nameScore(printed.split(', ').slice(1).join(', '), clues.words))
      : nameScore(printed, clues.words)
    let score = codeScore + ns * NAME_WEIGHT
    if (hints.size) score += hints.has(catalog) ? 6 : -12
    // Japanese text on the card → the Japanese catalog; none at all → probably not Japanese
    if (catalog === 'pokemon-jp') score += clues.japanese ? 10 : -15
    else if (clues.japanese && catalog === 'pokemon') score -= 15
    score = Math.max(0, Math.min(100, Math.round(score)))
    const key = `${catalog}:${c.id}`
    const prev = best.get(key)
    const reason = ns >= 0.75 ? `${why} + name` : why
    if (!prev || prev.score < score) best.set(key, { catalog, id: c.id, name: c.name, score, why: reason, exact: exact || !!prev?.exact })
    else if (exact && !prev.exact) prev.exact = true
  }

  // A graded slab's label names the card outright: number + set (+ name)
  if (clues.slab?.number) {
    const label = clues.slab
    const labelWords = new Set(label.text.flatMap((t) => fold(t).split(' ')).filter(Boolean))
    for (const cat of catalogs) {
      if (label.game && cat.key !== label.game && !(label.game === 'pokemon' && cat.key === 'pokemon-jp')) continue
      for (const c of catalogIndex(cat).byNum.get(numKey(label.number)) ?? []) {
        // The label's set line ("LOST ORIGIN") against the card's set name
        const setHit = nameScore(String(c.setName ?? ''), labelWords)
        offer(cat.key, c, 45 + setHit * 25, `${label.company} label #${label.number}${setHit >= 0.75 ? ' + set' : ''}`)
      }
    }
  }

  for (const cat of catalogs) {
    const ix = catalogIndex(cat)

    if (cat.key === 'pokemon') {
      for (const f of clues.fractions) {
        for (const c of ix.byNum.get(numKey(`${f.pre}${f.num}${f.suf}`)) ?? []) {
          let sc = 38
          const total = ix.totals.get(c.set ?? '') ?? 0
          if (total) {
            if (f.den <= total) sc += f.pre === '' && f.den === total ? 14 : 10
            else if (f.den > total + 5) sc -= 20
          }
          offer('pokemon', c, sc, `number ${f.pre}${f.num}/${f.den}`)
        }
      }
      for (const p of clues.promos) for (const c of ix.byNum.get(numKey(p)) ?? []) offer('pokemon', c, 55, `promo ${c.number}`)
      // A number alone low on the card: weaker than "number/total", so the name has to agree
      for (const n of clues.loneNumbers) for (const c of ix.byNum.get(numKey(n)) ?? []) offer('pokemon', c, 34, `number ${n}`)
      for (const p of clues.starPromo) {
        for (const c of ix.byNum.get(p.num) ?? []) if (c.set === p.set) offer('pokemon', c, 55, `promo ${p.set.toUpperCase()} ${p.num}`)
      }
    }

    if (cat.key === 'pokemon-jp') {
      const seenSets = new Set<string>()
      for (const t of clues.bottomTokens) for (const id of Array.from(ix.marks.get(t.toLowerCase()) ?? [])) seenSets.add(id)
      for (const p of clues.jpPromos) {
        for (const c of ix.byNum.get(p.num) ?? []) {
          if (ix.marks.get(p.mark)?.has(c.set ?? '')) offer('pokemon-jp', c, 60, `promo ${p.num}/${p.mark.toUpperCase()}`)
        }
      }
      for (const f of clues.fractions) {
        for (const c of ix.byNum.get(numKey(`${f.pre}${f.num}${f.suf}`)) ?? []) {
          const setHit = seenSets.has(c.set ?? '')
          const total = ix.totals.get(c.set ?? '') ?? 0
          // Japanese sets count their secret rares in the total too, so the printed number can be
          // lower — but never higher
          const fit = !total ? 0 : f.den === total ? 12 : f.den < total ? 6 : f.den > total + 5 ? -20 : 0
          offer('pokemon-jp', c, (setHit ? 58 : 30) + fit, setHit ? `set mark + number ${f.num}/${f.den}` : `number ${f.num}/${f.den}`)
        }
      }
    }

    if (cat.key === 'onepiece') {
      for (const code of clues.opCodes) for (const c of ix.byOpCode.get(code) ?? []) offer('onepiece', c, 60, `code ${code}`)
    }

    if (cat.key === 'lorcana') {
      for (const f of clues.fractions) {
        if (f.pre) continue
        for (const c of ix.byNum.get(numKey(`${f.num}${f.suf}`)) ?? []) {
          const setHit = clues.lorcanaSet.includes(String(c.set ?? ''))
          offer('lorcana', c, setHit ? 62 : 28, setHit ? `number ${f.num}/${f.den} set ${c.set}` : `number ${f.num}/${f.den}`)
        }
      }
    }

    if (cat.key === 'riftbound') {
      const tokens = new Set(clues.bottomTokens.map((t) => t.toUpperCase()))
      for (const f of clues.fractions) {
        const group = ix.rb.get(`${numKey(`${f.num}${f.suf}`)}/${f.den}`) ?? []
        for (const { c, p } of group) {
          const setHit = tokens.has(p.set) || f.pre === p.set
          // Reprints in their own sets (Metal "Best Of", Judge, Nexus promos) still print the
          // original card's code ("SFD • 193/221" on an MTL-193/221 card): a close second to the
          // original, for the picture or the person to decide
          const reprint = !setHit && group.some((o) => o.p.set !== p.set && tokens.has(o.p.set))
          // "226*/219": the star marks the Signature printing — when it's read, it decides
          const star = f.suf === '*' ? (p.num.endsWith('*') ? 10 : -10) : 0
          // "UNL • 156/219 • P": the P marks a promo printing
          const promo = clues.riftboundPromo ? (/promo/i.test(c.name) || /promo|nexus|judge/i.test(String(c.setName ?? '')) ? 8 : -8) : 0
          offer('riftbound', c, (setHit ? 65 : reprint ? 59 : 40) + star + promo, `${setHit ? p.set + ' ' : reprint ? 'reprint of ' : ''}${f.num}${f.suf}/${f.den}`)
        }
      }
    }

    if (cat.key === 'mtg') {
      const tokenSets = new Set(clues.bottomTokens.map((t) => t.toLowerCase()))
      const sets = new Set(clues.mtgSets)
      // "176a/264" (a double-faced card's front) is collector number 176 in the catalog
      const read = [...clues.bottomNumbers, ...clues.fractions.map((f) => `${f.num}${f.suf}`)]
      const numbers = new Set([...read, ...read.map((n) => n.replace(/[a-z*]$/, ''))].map(numKey))
      for (const set of Array.from(new Set([...Array.from(sets), ...Array.from(tokenSets)]))) {
        const strongSet = sets.has(set)
        for (const c of ix.bySet.get(set) ?? []) {
          if (numbers.has(numKey(c.number))) offer('mtg', c, strongSet ? 65 : 50, `${set.toUpperCase()} ${c.number}`)
          else offer('mtg', c, strongSet ? 15 : 5, `set ${set.toUpperCase()}`)
        }
        // A stamped promo ("MH3" card, collector number "222s", set "pmh3") looks the same as the
        // set's own card except for a small stamp — offered as a close second, for the person to pick
        for (const c of ix.bySet.get(`p${set}`) ?? []) {
          if (numbers.has(numKey(c.number).replace(/[sp]$/, ''))) offer('mtg', c, strongSet ? 50 : 38, `${set.toUpperCase()} ${c.number} promo`)
        }
      }
    }
  }

  // No identifier read (glare over the corner, an old card without one): the name alone
  const codeBest = Math.max(0, ...Array.from(best.values()).filter((c) => !c.why.startsWith('set ')).map((c) => c.score))
  if (codeBest < 55) {
    for (const cat of catalogs) {
      if (cat.key === 'pokemon-jp') continue // the Japanese catalog's names are English
      const index = catalogIndex(cat).names
      for (const line of clues.nameLines) {
        const tokens = fold(line).split(' ').filter(Boolean)
        for (let n = Math.min(tokens.length, 8); n >= 1; n--) {
          const hits = index.get(tokens.slice(0, n).join(' '))
          if (!hits) continue
          // A name shared by many printings (a basic land, a common Pokémon) can't be told
          // apart by name — keep a handful; the set code or the picture has to decide. A name
          // that's only the start of a longer line ("Sacrifice a creature…") is a weaker sign.
          const whole = n === tokens.length
          for (const c of hits.slice(0, 24)) offer(cat.key, c, (hits.length === 1 ? 32 : 24) - (whole ? 0 : 12), 'name', hits.length === 1)
          break
        }
      }
    }
  }

  return Array.from(best.values()).sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES)
}
