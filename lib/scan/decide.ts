// The scanner's final call for one scanned card: text candidates (lib/scan/scanMatch.ts) plus
// the native picture comparison (ios/App/App/CardScanner.swift, PictureMatcher). Self-contained
// for tests.
//
// Picture distances: 0 = the same picture, ~0.13 typical for the right card under normal phone
// conditions, ~0.35 under harsh glare/blur; a different card's art is usually 0.3–0.5 further
// away. (Measured 2026-11-08 on simulated phone scans of One Piece parallels and Pokémon
// Charizard printings — CardScanner.md "Picture matching".) Same-art reprints are near 0 apart:
// the picture can't separate those — the printed number does.

export interface Scored {
  key: string     // "catalog:id"
  score: number   // text score, 0–100
  exact?: boolean // false = found only by a name several printings share
}

export type ScanStatus = 'matched' | 'pick' | 'none'

export interface Decision<T extends Scored> {
  ranked: Array<T & { final: number; distance: number | null }>
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

export function decide<T extends Scored>(candidates: T[], distances?: Array<number | null>): Decision<T> {
  const ds = candidates.map((_, i) => {
    const d = distances?.[i]
    return typeof d === 'number' && isFinite(d) ? d : null
  })
  const known = ds.filter((d): d is number => d !== null)
  const dmin = known.length ? Math.min(...known) : null
  // How much the best picture match is worth trusting at all, 0–1
  const trust = dmin === null ? 0 : Math.max(0, Math.min(1, (LOOKS_LIKE_NOTHING - dmin) / 0.3))

  const ranked = candidates.map((c, i) => {
    const d = ds[i]
    let bonus = 0
    if (d !== null && dmin !== null) {
      if (known.length === 1) bonus = d <= CONFIRMS ? PICTURE_POINTS / 2 : d >= LOOKS_LIKE_NOTHING ? -15 : 0
      else bonus = trust * PICTURE_POINTS * Math.max(0, 1 - (d - dmin) / PICTURE_GAP)
    }
    return { ...c, distance: d, final: Math.round(c.score + bonus) }
  }).sort((a, b) => b.final - a.final || (a.distance ?? 9) - (b.distance ?? 9))

  const [first, second] = ranked
  let status: ScanStatus = 'none'
  const pictureOk = known.length === 0 || (first?.distance ?? Infinity) <= PICTURE_CONFIRMS
  if (first && first.exact !== false && pictureOk && first.final >= AUTO_ACCEPT && (!second || first.final - second.final >= MIN_LEAD)) status = 'matched'
  else if (first && first.final >= 30) status = 'pick'
  return { ranked, status }
}
