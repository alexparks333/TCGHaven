// Catalog card search — the one ranking engine behind Add Card, Personal Collections and the
// Admin whole-catalog search, for all five games. Modeled on how eBay's keyword search behaves:
//
//  - Punctuation, accents and case never matter. "sabrinas", "Sabrina's" and "SABRINA S" are the
//    same search; "pokemon" finds "Pokémon"; "hooh"/"ho oh" find "Ho-Oh"; "mr mime"/"mrmime" find
//    "Mr. Mime".
//  - Every word must match somewhere — the card name first and foremost, but also the card's
//    "item specifics": set name, set code, rarity, Riftbound champion tags. "gengar fusion strike"
//    and "charizard 151" work; a name hit always outweighs the same word hitting the set.
//  - Words containing a digit ("9", "009", "TG05", "4/102", "OP01-024", "#25") are collector
//    numbers: never required, but a card whose number matches jumps to the top — "Charizard 9"
//    lists every Charizard with the #9 ones first.
//  - Automatic expansion: plurals ("charizards"), typos ("charzard", "gengr" — only when a word
//    matches nothing as typed, so a correct word is never second-guessed), symbols spelled out
//    (δ = delta, ★ = star, ◇ = prism, ♀/♂ = female/male, & = and).
//  - "Best Match" ranking: exact name > name prefix > set/rarity hit; exact full-name matches and
//    shorter names first ("Gengar" before "Gengar & Mimikyu GX"); ties go to the higher-value card.
//  - If nothing matches every word, results matching fewer words are shown instead of nothing.
//  - Power-user syntax like eBay's: "-word" excludes, "quoted phrase" must appear in the name.
//
// Pure and dependency-free (no Firestore, no Next) so it's directly unit-testable.

export interface SearchableCard {
  id: string
  name: string
  number?: string
  set?: string        // Pokémon/One Piece/MTG/Lorcana set code or id
  setCode?: string     // Riftbound set code
  setName?: string
  rarity?: string
  tags?: string[]      // Riftbound champion tags
  publicCode?: string  // Riftbound "OGN-007a/298"
  marketPrice?: number
  marketPriceFoil?: number
}

export interface SearchOptions {
  /** Extra searchable words per card (e.g. display rarity labels, "parallel"). */
  extraTerms?: (card: SearchableCard) => string | undefined
  /** Show "fewer words" results when nothing matches everything (default true). */
  relax?: boolean
}

export interface SearchHit<T> {
  card: T
  score: number
  /** A collector-number word in the query matched this card's number. */
  numberMatch: boolean
}

// ── Normalization ────────────────────────────────────────────────────────────

const SYMBOLS: Array<[RegExp, string]> = [
  [/[δΔ]/g, ' delta '],
  [/[★☆]/g, ' star '],
  [/◇/g, ' prism '],
  [/♀/g, ' female '],
  [/♂/g, ' male '],
  [/&/g, ' and '],
  [/[æÆ]/g, 'ae'],
  [/[œŒ]/g, 'oe'],
  [/ß/g, 'ss'],
]

/** Lowercase, accent-free, apostrophes removed (joined, not split), everything else
 * non-alphanumeric turned into a space. */
export function foldText(s: string): string {
  let out = String(s ?? '')
  for (const [re, rep] of SYMBOLS) out = out.replace(re, rep)
  return out
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`ʼ´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokensOf(s: string | undefined): string[] {
  const f = foldText(s ?? '')
  return f ? f.split(' ') : []
}

/** Collector-number comparison key: lowercase alphanumerics only, leading zeros dropped from
 * every digit run, and anything after a "/" (the set size in "4/102") ignored.
 * "009" → "9", "TG05" → "tg5", "OP01-024" → "op1024", "4/102" → "4". */
export function numberKey(s: string | undefined): string {
  const raw = String(s ?? '').split('/')[0]
  return foldText(raw).replace(/\d+/g, (d) => String(parseInt(d, 10))).replace(/ /g, '')
}

function digitsOf(key: string): string {
  const m = key.match(/\d+/g)
  return m && m.length === 1 ? m[0] : ''
}

// ── Per-card index (cached per card object) ──────────────────────────────────

interface CardDoc {
  name: string[]          // name tokens
  nameSuffixes: string[]  // nameSuffixes[i] = name[i] + name[i+1] + … (no spaces)
  namePhrase: string      // " " + tokens joined + " "
  set: string[]
  setSuffixes: string[]
  codes: string[]         // set/set-code tokens
  rarity: string[]
  tags: string[]
  numKeys: string[]       // collector-number keys
  numDigits: string[]     // bare digit parts of those keys
}

const docCache = new WeakMap<object, CardDoc>()

function suffixes(tokens: string[]): string[] {
  const out: string[] = new Array(tokens.length)
  let acc = ''
  for (let i = tokens.length - 1; i >= 0; i--) { acc = tokens[i] + acc; out[i] = acc }
  return out
}

function docFor(card: SearchableCard, extra?: string): CardDoc {
  const cached = docCache.get(card)
  if (cached) return cached
  const name = tokensOf(card.name)
  const set = tokensOf(card.setName)
  const codes = Array.from(new Set([...tokensOf(card.set), ...tokensOf(card.setCode)]))
  const rarity = Array.from(new Set([...tokensOf(card.rarity), ...tokensOf(extra)]))
  const tags = (card.tags ?? []).flatMap((t) => tokensOf(t))

  const numKeys = new Set<string>()
  const addNum = (s: string | undefined) => { const k = numberKey(s); if (k) numKeys.add(k) }
  addNum(card.number)
  if (card.publicCode) {
    addNum(card.publicCode)                                  // "ogn7a"
    addNum(card.publicCode.replace(/^[A-Za-z]+-/, ''))       // "7a"
  }
  // One Piece ids are the printed card code ("OP01-024", "OP01-024_p1")
  if (/^[A-Z]{1,4}\d{1,3}-\d{2,3}/.test(card.id)) addNum(card.id.replace(/_p\d+$/, ''))
  const keys = Array.from(numKeys)
  const digits = Array.from(new Set(keys.map(digitsOf).filter(Boolean)))

  const doc: CardDoc = {
    name, nameSuffixes: suffixes(name), namePhrase: ` ${name.join(' ')} `,
    set, setSuffixes: suffixes(set), codes, rarity, tags, numKeys: keys, numDigits: digits,
  }
  docCache.set(card, doc)
  return doc
}

// ── Query parsing ────────────────────────────────────────────────────────────

const FINISH_WORDS = new Set(['foil', 'holo', 'holofoil', 'reverse', 'rev', 'nonfoil'])

export interface ParsedQuery {
  words: string[]       // required words (folded), matched against name + item specifics
  numbers: string[]     // collector-number keys — soft, boost only
  rawNumbers: string[]  // the same words folded as text, also tried against name/set ("151")
  phrases: string[]     // quoted phrases — must appear in the name
  excludes: string[]    // -words — card excluded if its name/set/rarity has them
  finish: 'foil' | 'normal' | null
}

export function parseQuery(raw: string): ParsedQuery {
  const q: ParsedQuery = { words: [], numbers: [], rawNumbers: [], phrases: [], excludes: [], finish: null }
  let text = String(raw ?? '')
  text = text.replace(/"([^"]+)"/g, (_, p: string) => {
    const f = foldText(p)
    if (f) q.phrases.push(f)
    return ` ${p} `
  })
  for (let w of text.split(/\s+/)) {
    if (!w) continue
    if (w.length > 1 && w[0] === '-' && /[a-z]/i.test(w[1])) {
      q.excludes.push(...tokensOf(w.slice(1)))
      continue
    }
    w = w.replace(/^(#|no\.?(?=\d))/i, '')
    if (/\d/.test(w)) {
      const key = numberKey(w)
      if (key) q.numbers.push(key)
      q.rawNumbers.push(...tokensOf(w))
      continue
    }
    for (const t of tokensOf(w)) {
      if (FINISH_WORDS.has(t)) {
        q.finish = t === 'nonfoil' ? 'normal' : 'foil'
        continue
      }
      q.words.push(t)
    }
  }
  return q
}

// ── Matching ─────────────────────────────────────────────────────────────────

// Optimal string alignment distance, bounded — returns max+1 as soon as it can't be ≤ max.
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

function typoBudget(word: string): number {
  if (word.length < 4) return 0
  return word.length >= 9 ? 2 : 1
}

/** How far `token` is from `word` (or from what `word` is the start of — the user may still be
 * typing), or Infinity if it's beyond the typo budget. */
function typoDistance(word: string, token: string): number {
  const max = typoBudget(word)
  if (!max || token.length < 3) return Infinity
  let best = editDistance(word, token, max)
  for (let len = word.length - 1; len <= word.length + 1; len++) {
    if (len < 3 || len >= token.length) continue
    best = Math.min(best, editDistance(word, token.slice(0, len), max))
  }
  return best <= max ? best : Infinity
}

function singular(w: string): string | null {
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1)
  return null
}

const W = {
  nameExact: 30, nameSpanExact: 28, namePlural: 26, namePrefix: 16, nameSpanPrefix: 13, nameFuzzy: 10,
  tag: 20, tagPrefix: 12,
  code: 14, setExact: 9, setPrefix: 6,
  rarityExact: 6, rarityPrefix: 4,
  numberExact: 70, numberDigits: 30, numberAsSet: 45, numberInName: 50,
}

interface WordHit { score: number; inName: boolean }

function matchTokens(word: string, tokens: string[], sufs: string[], exact: number, spanExact: number, prefix: number, spanPrefix: number): number {
  let best = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === word) return exact
    if (t.startsWith(word)) { if (prefix > best) best = prefix; continue }
    // "hooh" → "ho oh", "mrmime" → "mr mime", "pokeball" → "poke ball"
    const s = sufs[i]
    if (s.length > t.length && word.length > t.length && s.startsWith(word)) {
      let acc = ''
      let ends = false
      for (let j = i; j < tokens.length && acc.length < word.length; j++) { acc += tokens[j]; if (acc === word) ends = true }
      const v = ends ? spanExact : spanPrefix
      if (v > best) best = v
    }
  }
  return best
}

function matchWord(word: string, doc: CardDoc, fuzzy: Set<string> | undefined): WordHit {
  let s = matchTokens(word, doc.name, doc.nameSuffixes, W.nameExact, W.nameSpanExact, W.namePrefix, W.nameSpanPrefix)
  if (s < W.namePlural) {
    const sing = singular(word)
    if (sing && doc.name.includes(sing)) s = W.namePlural
  }
  if (!s && fuzzy) {
    for (const t of doc.name) if (fuzzy.has(t)) { s = W.nameFuzzy; break }
  }
  if (s) return { score: s, inName: true }

  for (const t of doc.tags) {
    if (t === word) return { score: W.tag, inName: true }
    if (t.startsWith(word)) s = Math.max(s, W.tagPrefix)
  }
  if (s) return { score: s, inName: true }

  if (doc.codes.includes(word)) return { score: W.code, inName: false }
  s = matchTokens(word, doc.set, doc.setSuffixes, W.setExact, W.setExact, W.setPrefix, W.setPrefix)
  if (!s) {
    for (const t of doc.rarity) {
      if (t === word) { s = W.rarityExact; break }
      if (t.startsWith(word)) s = W.rarityPrefix
    }
  }
  if (!s && fuzzy) {
    for (const t of doc.set) if (fuzzy.has(t)) { s = W.setPrefix - 2; break }
  }
  return { score: s, inName: false }
}

function matchNumber(key: string, raw: string[], doc: CardDoc): { score: number; isNumber: boolean } {
  if (doc.numKeys.includes(key)) return { score: W.numberExact, isNumber: true }
  // "9" typed for a "TG09"/"SV009" style number — weaker, the prefix wasn't typed
  if (/^\d+$/.test(key) && doc.numDigits.includes(key)) return { score: W.numberDigits, isNumber: true }
  // a number word that's really part of a set name ("151") or code ("sv3pt5")
  for (const r of raw) {
    if (doc.set.includes(r) || doc.codes.includes(r)) return { score: W.numberAsSet, isNumber: false }
    if (doc.name.includes(r)) return { score: W.numberInName, isNumber: false }
  }
  return { score: 0, isNumber: false }
}

/** Every distinct word in the searchable fields, for typo correction. */
function vocabulary(docs: CardDoc[]): string[] {
  const seen = new Set<string>()
  for (const d of docs) {
    for (const t of d.name) seen.add(t)
    for (const t of d.set) seen.add(t)
  }
  return Array.from(seen)
}

interface Scored<T> extends SearchHit<T> { matched: number; price: number }

/**
 * Ranks `cards` against a free-text query, best match first. Cards that don't match are left
 * out. See the header comment for the matching rules.
 */
/** Builds (and caches) every card's search index without searching — Add Card's warm-up. */
export function buildSearchIndex(cards: SearchableCard[], opts: SearchOptions = {}): void {
  for (const c of cards) docFor(c, opts.extraTerms?.(c))
}

export function searchCatalog<T extends SearchableCard>(cards: T[], rawQuery: string, opts: SearchOptions = {}): SearchHit<T>[] {
  const q = parseQuery(rawQuery)
  if (!q.words.length && !q.numbers.length && !q.phrases.length) return []

  const docs = cards.map((c) => docFor(c, opts.extraTerms?.(c)))
  const fuzzy: Array<Set<string> | undefined> = q.words.map(() => undefined)

  const run = (minMatched: number): Scored<T>[] => {
    const out: Scored<T>[] = []
    for (let i = 0; i < cards.length; i++) {
      const doc = docs[i]
      if (q.excludes.length && q.excludes.some((x) => doc.name.includes(x) || doc.set.includes(x) || doc.rarity.includes(x))) continue
      if (q.phrases.length && !q.phrases.every((p) => doc.namePhrase.includes(` ${p} `))) continue

      let score = 0
      let matched = 0
      let allInName = true
      for (let w = 0; w < q.words.length; w++) {
        const hit = matchWord(q.words[w], doc, fuzzy[w])
        if (hit.score) { matched++; score += hit.score; if (!hit.inName) allInName = false }
        else allInName = false
      }
      if (matched < minMatched) continue

      let numberMatch = false
      let numberScore = 0
      for (const key of q.numbers) {
        const n = matchNumber(key, q.rawNumbers, doc)
        if (n.score > numberScore) numberScore = n.score
        if (n.isNumber) numberMatch = true
      }
      // A number-only query ("TG05", "OP01-024") must actually match something.
      if (!q.words.length && !q.phrases.length && !numberScore) continue
      score += numberScore

      if (q.words.length) {
        if (allInName && matched === q.words.length) score += 20
        const first = q.words[0]
        if (doc.name[0] === first || doc.name[0]?.startsWith(first)) score += 10
        const phrase = ` ${q.words.join(' ')} `
        if (doc.namePhrase === phrase) score += 40
        else if (doc.namePhrase.startsWith(phrase)) score += 12
        else if (doc.namePhrase.includes(phrase)) score += 6
        // shorter names first: each name word the query didn't ask for costs a little
        score -= Math.min(12, Math.max(0, doc.name.length - matched) * 1.5)
      }
      if (q.phrases.length) score += 15

      const c = cards[i]
      out.push({ card: c, score, numberMatch, matched, price: Math.max(c.marketPrice ?? 0, c.marketPriceFoil ?? 0) })
    }
    return out
  }

  let hits = run(q.words.length)
  // A number-only search ("OGN-007a", "TG05") is a lookup: once some card's number matches, the
  // cards that only matched on set code are noise.
  if (!q.words.length && !q.phrases.length && hits.some((h) => h.numberMatch)) hits = hits.filter((h) => h.numberMatch)

  // Typo correction, only for words that matched nothing at all as typed.
  if (!hits.length && q.words.length) {
    let vocab: string[] | null = null
    let corrected = false
    for (let w = 0; w < q.words.length; w++) {
      const word = q.words[w]
      if (!typoBudget(word)) continue
      const anyHit = docs.some((d) => matchWord(word, d, undefined).score > 0)
      if (anyHit) continue
      vocab = vocab ?? vocabulary(docs)
      // Only the closest corrections: "charzard" → charizard (1 edit), not charmander (2).
      let bestDist = Infinity
      let alts: string[] = []
      for (const t of vocab) {
        const d = typoDistance(word, t)
        if (d < bestDist) { bestDist = d; alts = [t] } else if (d === bestDist && d !== Infinity) alts.push(t)
      }
      if (alts.length) { fuzzy[w] = new Set(alts); corrected = true }
    }
    if (corrected) hits = run(q.words.length)
  }

  // eBay's "results matching fewer words": better than an empty dropdown.
  if (!hits.length && q.words.length > 1 && opts.relax !== false) {
    hits = run(Math.ceil(q.words.length / 2)).filter((h) => h.matched > 0)
  }

  hits.sort((a, b) =>
    b.matched - a.matched ||
    b.score - a.score ||
    b.price - a.price ||
    (a.card.name < b.card.name ? -1 : a.card.name > b.card.name ? 1 : 0) ||
    (a.card.id < b.card.id ? -1 : 1),
  )
  return hits.map(({ card, score, numberMatch }) => ({ card, score, numberMatch }))
}

/** Convenience: just the ranked cards. */
export function rankCards<T extends SearchableCard>(cards: T[], rawQuery: string, opts?: SearchOptions): T[] {
  return searchCatalog(cards, rawQuery, opts).map((h) => h.card)
}
