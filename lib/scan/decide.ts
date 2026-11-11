// The scanner's final call for one scanned card: text candidates (lib/scan/scanMatch.ts) plus
// the native picture comparison (ios/App/App/CardScanner.swift, PictureMatcher). Self-contained
// for tests.
//
// Two picture signals, either or both:
//  • distances — the phone's tile comparison with each candidate's photo (PictureMatcher), below;
//  • similarities — the trained picture AI (lib/scan/picture.ts, docs/scanner-ai.md): cosine
//    similarity of the scan's fingerprint to each card's, higher = more alike. On 57 real iPhone
//    scans (2026-11-10) the right card scored 0.35–0.89 (median 0.63); whenever another card
//    outscored it, the other card was ahead by at most 0.13, and same-name printings (Paras,
//    Grimer) by at most 0.10. Hence: the AI breaks a text tie only with a lead of 0.12+, vetoes a
//    text answer only when another card is 0.15+ more alike, and never adds a card on its own.
//    Used instead of the distances when every card still in the running has a similarity.
//
// Picture distances: 0 = the same picture, ~0.13 typical for the right card under normal phone
// conditions, ~0.35 under harsh glare/blur; a different card's art is usually 0.3–0.5 further
// away. (Measured 2026-11-08 on simulated phone scans of One Piece parallels and Pokémon
// Charizard printings — docs/card-scanner.md "Picture matching".) Same-art reprints are near 0 apart:
// the picture can't separate those — the printed number does.

export interface Scored {
  key: string     // "catalog:id"
  score: number   // text score, 0–100
  exact?: boolean // false = found only by a name several printings share
  trusted?: boolean // read off a grading label: the picture can't overrule it
}

export type ScanStatus = 'matched' | 'pick' | 'none'

export interface Decision<T extends Scored> {
  ranked: Array<T & { final: number; distance: number | null; similarity: number | null }>
  status: ScanStatus
}

// The picture is worth up to this many points: enough to separate cards the text ties on
// (One Piece parallels, alt arts), never enough to overturn a clear text win.
const PICTURE_POINTS = 25
// A candidate this much further from the scan than the closest one gets no picture points
const PICTURE_GAP = 0.15
// Beyond this, the picture looks like none of the candidates — it can't vouch for any of them
const LOOKS_LIKE_NOTHING = 0.7
// One candidate only: the picture confirms it (close) or contradicts the text (far)
const CONFIRMS = 0.4

export const AUTO_ACCEPT = 70   // final score needed to add a card without asking
export const MIN_LEAD = 10      // …and its lead over the runner-up
// …and, when pictures were compared, the scan must actually look like it. (Typical right-card
// distance is ~0.13, ~0.35 in harsh light; a wrong card added silently is far worse than one
// extra tap, so anything less convincing is asked about.)
export const PICTURE_CONFIRMS = 0.35

// The picture AI (similarities; see the top of this file)
const AI_POINTS = 25          // same weight as the tile comparison's
const AI_GAP = 0.12           // a candidate this much less alike than the best gets no points
const AI_TRUST_FROM = 0.35    // the best similarity below this vouches for nothing…
const AI_TRUST_FULL = 0.55    // …and from this up, fully
export const AI_DECISIVE = 0.12  // the picture alone settles a text tie only with this lead
const AI_VETO = 0.15          // another card this much more alike stops a text answer being added…
const AI_VETO_FROM = 0.6      // …when that other card really looks like the scan
const AI_CONFIRMS = 0.45      // the answer's own similarity that counts as "it looks like it"
export const AI_OFFER = 0.45  // a picture-only find worth asking about
const AI_NAMES_IT = 0.6       // found by name only: the picture names the card from here…
const AI_NAMES_LEAD = 0.15    // …with this lead over every other candidate

export function decide<T extends Scored>(candidates: T[], distances?: Array<number | null>, similarities?: Array<number | null | undefined>): Decision<T> {
  const ds = candidates.map((_, i) => {
    const d = distances?.[i]
    return typeof d === 'number' && isFinite(d) ? d : null
  })
  const ss = candidates.map((_, i) => {
    const s = similarities?.[i]
    return typeof s === 'number' && isFinite(s) ? s : null
  })
  const known = ds.filter((d): d is number => d !== null)
  const dmin = known.length ? Math.min(...known) : null
  // How much the best picture match is worth trusting at all, 0–1
  const trust = dmin === null ? 0 : Math.max(0, Math.min(1, (LOOKS_LIKE_NOTHING - dmin) / 0.3))

  // The AI decides the picture side when every card still in the running (text within 20 of the
  // best) has a similarity — a card too new to be fingerprinted falls back to the tile comparison
  const topText = Math.max(0, ...candidates.map((c) => c.score))
  const aiMode = ss.some((s) => s !== null) && candidates.every((c, i) => c.score < topText - 20 || ss[i] !== null)
  const sKnown = ss.filter((s): s is number => s !== null)
  const sBest = sKnown.length ? Math.max(...sKnown) : null
  const aiTrust = sBest === null ? 0 : Math.max(0, Math.min(1, (sBest - AI_TRUST_FROM) / (AI_TRUST_FULL - AI_TRUST_FROM)))

  const ranked = candidates.map((c, i) => {
    const d = ds[i], s = ss[i]
    let bonus = 0
    if (aiMode) {
      if (s !== null && sBest !== null) bonus = aiTrust * AI_POINTS * Math.max(0, 1 - (sBest - s) / AI_GAP)
    } else if (d !== null && dmin !== null && !(c.trusted && d > CONFIRMS)) {
      if (known.length === 1) bonus = d <= CONFIRMS ? PICTURE_POINTS / 2 : d >= LOOKS_LIKE_NOTHING ? -15 : 0
      else bonus = trust * PICTURE_POINTS * Math.max(0, 1 - (d - dmin) / PICTURE_GAP)
    }
    return { ...c, distance: d, similarity: s, final: Math.round(c.score + bonus) }
  }).sort((a, b) => b.final - a.final || (b.similarity ?? -9) - (a.similarity ?? -9) || (a.distance ?? 9) - (b.distance ?? 9))

  const [first, second] = ranked
  let status: ScanStatus = 'none'
  // The picture can veto a clear text answer only when it clearly disagrees: on real phone scans
  // (2026-11-09) right cards read by number + name scored 0.4–0.67 through toploaders and foil
  const textDecisive = !!first && first.exact !== false && first.score >= 90 && (!second || first.score - second.score >= 15)
  if (aiMode && first) {
    const s1 = first.similarity
    const othersBest = Math.max(-1, ...ranked.slice(1).map((c) => c.similarity ?? -1))
    const aiLead = s1 === null ? -1 : s1 - othersBest
    // Another card looks clearly more like the scan than the text's answer → ask
    const vetoed = !first.trusted && s1 !== null && sBest !== null && sBest >= AI_VETO_FROM && sBest - s1 >= AI_VETO
    const pictureOk = s1 === null || s1 >= AI_CONFIRMS || textDecisive || !!first.trusted
    // Found by name only, but the picture clearly picks one of the name's cards
    const pictureNamesIt = first.exact === false && first.score > 0 && s1 !== null && s1 >= AI_NAMES_IT && aiLead >= AI_NAMES_LEAD
      && (!second || first.final - second.final >= MIN_LEAD + 5)
    // The text alone puts it ahead, or the picture does — clearly
    const ahead = !second || first.score - second.score >= MIN_LEAD || aiLead >= AI_DECISIVE
    if ((first.exact !== false || pictureNamesIt) && pictureOk && !vetoed && ahead && first.final >= AUTO_ACCEPT && (!second || first.final - second.final >= MIN_LEAD)) status = 'matched'
    else if (first.final >= 30 || (sBest !== null && sBest >= AI_OFFER)) status = 'pick'
    return { ranked, status }
  }
  const pictureOk = known.length === 0 || (first?.distance ?? Infinity) <= PICTURE_CONFIRMS
    || (textDecisive && (first?.distance ?? Infinity) < LOOKS_LIKE_NOTHING + 0.1) || !!first?.trusted
  // Found by name only, but the picture is a near-exact match and clearly the closest: the name
  // and the picture together name the card (a real Squirtle scored 0.084)
  const pictureNamesIt = !!first && first.exact === false && (first.distance ?? Infinity) <= 0.2
    && (!second || first.final - second.final >= MIN_LEAD + 5)
  if (first && (first.exact !== false || pictureNamesIt) && pictureOk && first.final >= AUTO_ACCEPT && (!second || first.final - second.final >= MIN_LEAD)) status = 'matched'
  else if (first && first.final >= 30) status = 'pick'
  return { ranked, status }
}
