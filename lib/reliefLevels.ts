// Each piece's height for the Relief Studio's stepped mode, worked out once per kit.
//
// Levels used to come from each piece's median depth over the whole pin. Depth models see most pins
// slightly tilted (the bottom looks nearer), so whole regions jumped a level whatever they sat on,
// and raised lettering the depth model barely saw never got a step of its own. Here a piece's height
// comes from the change across its own borders instead: just inside each side of every border, the
// kit's depth (layers) and its fine detail (integrated from the normals, which see raised lettering
// clearly) are compared, and all borders are solved together (least squares, with a weak pull toward
// each piece's median depth so pieces with few borders still land sensibly). An overall tilt cancels
// out, because only neighbours are compared.
//
// The heights are then spread by rank (half area-weighted rank, half value), so the levels share the
// pin out instead of one tall group (a name across the bottom, a big figure) taking the top level
// and everything else crowding into the bottom one or two.
//
// Mirrors piece_heights() in tools/havenrelief/havenrelief.py — keep the two in step.

export interface LevelInput {
  size: number
  layers: Float32Array  // 0..1 depth inside the pin
  detail: Float32Array  // -1..1 fine detail
  pieces: Int32Array    // piece id per pixel, 0 = outside the pin
  pieceCount: number
}

/** Height per piece id (index = id; 0 and empty pieces = 0), 0..1. */
export function pieceHeights(k: LevelInput): Float64Array {
  const { size, layers, detail, pieces } = k
  const P = k.pieceCount + 1
  const B = Math.max(2, Math.round((12 * size) / 2048))
  // per border pair (a < b): the change (a's side − b's side) for each border pixel, in layers and detail
  const pairs = new Map<number, { l: number[]; d: number[] }>()
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    for (let y = 0; y < size - dy; y++) {
      for (let x = 0; x < size - dx; x++) {
        const i = y * size + x
        const pa = pieces[i], pb = pieces[i + dy * size + dx]
        if (!pa || !pb || pa === pb) continue
        let la = 0, da = 0, na = 0, lb = 0, db = 0, nb = 0
        for (let t = 2; t <= B; t += 2) {
          const xa = x - dx * t, ya = y - dy * t
          if (xa >= 0 && ya >= 0) {
            const j = ya * size + xa
            if (pieces[j] === pa) { la += layers[j]; da += detail[j]; na++ }
          }
          const xb = x + dx * (t + 1), yb = y + dy * (t + 1)
          if (xb < size && yb < size) {
            const j = yb * size + xb
            if (pieces[j] === pb) { lb += layers[j]; db += detail[j]; nb++ }
          }
        }
        if (!na || !nb) continue
        const sign = pa < pb ? 1 : -1
        const key = Math.min(pa, pb) * P + Math.max(pa, pb)
        let e = pairs.get(key)
        if (!e) pairs.set(key, (e = { l: [], d: [] }))
        e.l.push(sign * (la / na - lb / nb))
        e.d.push(sign * (da / na - db / nb))
      }
    }
  }
  const ea: number[] = [], eb: number[] = [], el: number[] = [], ed: number[] = [], en: number[] = []
  pairs.forEach((e, key) => {
    if (e.l.length < 4) return
    ea.push(Math.floor(key / P)); eb.push(key % P); el.push(median(e.l)); ed.push(median(e.d)); en.push(e.l.length)
  })
  // each piece's area and median depth (the weak pull)
  const area = new Float64Array(P)
  const hist = new Uint32Array(P * 256)
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    if (!p) continue
    area[p]++
    hist[p * 256 + Math.min(255, (layers[i] * 256) | 0)]++
  }
  const med = new Float64Array(P)
  let total = 0
  for (let p = 1; p < P; p++) {
    total += area[p]
    if (!area[p]) continue
    let acc = 0, b = 0
    for (; b < 256; b++) { acc += hist[p * 256 + b]; if (acc >= area[p] / 2) break }
    med[p] = (b + 0.5) / 256
  }
  // the detail's change in depth units (least squares over the borders), then half and half
  let num = 0, den = 0
  for (let j = 0; j < ea.length; j++) { num += en[j] * el[j] * ed[j]; den += en[j] * ed[j] * ed[j] }
  const scale = den > 0 ? num / den : 0
  const step = el.map((l, j) => 0.5 * l + 0.5 * scale * ed[j])
  // solve (conjugate gradient): Σ n (h_a − h_b − step)² + Σ λ (h_p − med_p)²
  const lam = new Float64Array(P)
  for (let p = 1; p < P; p++) lam[p] = area[p] ? (2 * area[p]) / Math.max(total, 1) : 0
  const A = (h: Float64Array, out: Float64Array) => {
    for (let p = 0; p < P; p++) out[p] = lam[p] * h[p]
    for (let j = 0; j < ea.length; j++) { const v = en[j] * (h[ea[j]] - h[eb[j]]); out[ea[j]] += v; out[eb[j]] -= v }
  }
  const rhs = new Float64Array(P)
  for (let p = 0; p < P; p++) rhs[p] = lam[p] * med[p]
  for (let j = 0; j < ea.length; j++) { rhs[ea[j]] += en[j] * step[j]; rhs[eb[j]] -= en[j] * step[j] }
  const h = Float64Array.from(med), r = new Float64Array(P), Ap = new Float64Array(P)
  A(h, Ap)
  for (let p = 0; p < P; p++) r[p] = rhs[p] - Ap[p]
  const d = Float64Array.from(r)
  let rr = dot(r, r)
  for (let it = 0; it < 1000 && rr > 1e-20; it++) {
    A(d, Ap)
    const alpha = rr / Math.max(dot(d, Ap), 1e-30)
    for (let p = 0; p < P; p++) { h[p] += alpha * d[p]; r[p] -= alpha * Ap[p] }
    const rr2 = dot(r, r)
    for (let p = 0; p < P; p++) d[p] = r[p] + (rr2 / rr) * d[p]
    rr = rr2
  }
  // spread: half area-weighted rank, half value
  const ids = Array.from({ length: P - 1 }, (_, i) => i + 1).filter((p) => area[p] > 0)
  const out = new Float64Array(P)
  if (!ids.length) return out
  let lo = Infinity, hi = -Infinity
  for (const p of ids) { if (h[p] < lo) lo = h[p]; if (h[p] > hi) hi = h[p] }
  const order = [...ids].sort((a, b) => h[a] - h[b] || a - b)
  let cum = 0
  for (const p of order) {
    const pct = (cum + area[p] / 2) / total
    cum += area[p]
    out[p] = 0.5 * pct + 0.5 * (h[p] - lo) / Math.max(hi - lo, 1e-9)
  }
  return out
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
