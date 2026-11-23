// How a Riftbound TCGplayer product's collector number becomes the key it's priced under
// (catalog-sync.mjs fetchRiftboundPrices ↔ catalogKey). Kept apart from catalog-sync.mjs so it can
// be tested without Firebase (riftbound-tcgplayer.test.mjs, `npm run test:riftbound-tcgplayer`).

/** "Jarvan IV, Exemplar of Demacia (Signature)" → "jarvan iv, exemplar of demacia" */
const baseName = (name) => name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()

/**
 * The lookup key for a TCGplayer product. extNumber examples: "007a/298" (alt-art), "227/221"
 * (overnumber), "227*\/221" (signature), "SP3/006" (Vendetta's foil-only "Special" subset — its own
 * numbering line, unrelated to any plain card sharing the digit).
 *
 * Above-the-set numbers = a number above the set's size, whatever TCGplayer calls it: Radiance's
 * Overnumbereds are "(Heartsteel Overnumbered)", and the Ultimates (Unleashed's Baron Nashor #238,
 * Radiance's Packed Amphitheater #184) are "(Ultimate)". Only the literal "(Overnumbered)" used to
 * count, so those came out as plain cards that don't exist and their catalog cards were left at $0
 * (2026-11-23). Ultimates share the ":over" key (one card per number either way) — isUltimate()
 * is what tells the sync to call the card an Ultimate, a card type of its own.
 */
export function tcgKey(setCode, extNumber, name) {
  const spMatch = extNumber.match(/^SP(\d+)\//i)
  if (spMatch) return `${setCode}:sp${parseInt(spMatch[1], 10)}`
  const m = extNumber.match(/^(\d+)([a*]?)\/(\d+)?/)
  if (!m) return null
  const num = String(parseInt(m[1], 10))
  const suffix = m[2]
  const total = m[3] ? parseInt(m[3], 10) : NaN
  const isSig = suffix === '*' || name.includes('(Signature)')
  const isAlt = suffix === 'a' || name.includes('(Alternate Art)')
  const isOver = /Overnumbered\)|\(Ultimate\)/i.test(name) || (!suffix && parseInt(num, 10) > total)
  if (isSig) return `${setCode}:${num}:star`
  if (isAlt) return `${setCode}:${num}:altart`
  if (isOver) return `${setCode}:${num}:over`
  return `${setCode}:${num}:regular`
}

/** "Baron Nashor (Ultimate)" — Riot's gallery doesn't mark Ultimates, so TCGplayer's name is the signal. */
export const isUltimate = (name) => /\(Ultimate\)/i.test(name ?? '')

/**
 * Signatures TCGplayer has mis-numbered, set right. A Signature is the signed copy of an
 * Overnumbered card of the same name, so it takes that card's number: Radiance's Jarvan IV
 * Signature is listed as "179*\/167" — Aphelios's number — instead of 176*, and the two used to
 * fight over one key (the last one's price won, the product id was dropped). Returns
 * Map<productId, corrected extNumber> for the rows to fix.
 */
export function signatureNumberFixes(rows) {
  const overByName = new Map()
  for (const r of rows) {
    const m = (r.extNumber ?? '').match(/^(\d+)\/(\d+)/)
    if (!m || !r.name || /\(Signature\)/.test(r.name)) continue
    if (parseInt(m[1], 10) > parseInt(m[2], 10)) overByName.set(baseName(r.name), m[1])
  }
  const fixes = new Map()
  for (const r of rows) {
    const m = (r.extNumber ?? '').match(/^(\d+)\*\/(\d+)/)
    if (!m || !r.name) continue
    const right = overByName.get(baseName(r.name))
    if (right && parseInt(right, 10) !== parseInt(m[1], 10)) fixes.set(String(r.productId), `${right}*/${m[2]}`)
  }
  return fixes
}
