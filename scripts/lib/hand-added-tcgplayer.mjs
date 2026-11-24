// Hand-added cards → their TCGplayer product, once TCGplayer lists one (2026-11-24, the Owner's
// call). A card staff added by hand (source 'manual' — e.g. the Chinese/Korean exclusives) has no
// sync behind it, so its price is stagnant (stagnant.mjs). Every Riftbound sync looks for it among
// all of TCGplayer's Riftbound products: exactly one product with the same collector number
// (suffix and set size included) and the same name, that no other catalog card already is → linked
// automatically (tcgProductId + tcgGroupId on the card) and priced live from then on; more than one
// → listed on the staff portal's Stagnant prices page to pick. Tests: npm run test:stagnant.

/** "Rengar, Trophy Hunter (Chinese Promo)" → "rengar, trophy hunter" */
const baseName = (n) => String(n ?? '').replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
/** …and the champion alone: "rengar" */
const headName = (n) => baseName(n).split(/\s*[,-]\s+/)[0]

/** A card's collector number: publicCode "SFD-025a/221" → { num: '25a', of: '221' }; else its `number` */
export function cardNumber(card) {
  const m = /^[A-Z0-9]+-0*(\d+[a-z*]?)\/0*(\d+)$/i.exec(String(card?.publicCode ?? '').trim())
  if (m) return { num: m[1].toLowerCase(), of: m[2] }
  const n = /^0*(\d+[a-z*]?)$/i.exec(String(card?.number ?? '').trim())
  return n ? { num: n[1].toLowerCase(), of: '' } : null
}

/** A TCGplayer row's: extNumber "025a/221" → { num: '25a', of: '221' } */
export function rowNumber(row) {
  const m = /^0*(\d+[a-z*]?)\s*\/\s*0*(\d+)$/i.exec(String(row?.extNumber ?? '').trim())
  return m ? { num: m[1].toLowerCase(), of: m[2] } : null
}

const sameName = (card, row) => {
  const a = baseName(card.name)
  const b = baseName(row.name)
  return !!a && (a === b || headName(card.name) === headName(row.name))
}

/**
 * handCards: hand-added cards (source 'manual') not linked yet; rows: TCGplayer rows
 * { productId, groupId, name, extNumber, marketPrice } from every Riftbound group; taken: Set of
 * product ids some catalog card already is (never linked twice). → { links: [{ cardId, productId,
 * groupId }], suggestions: [{ cardId, products: [{ productId, groupId, name, extNumber, marketPrice }] }] }
 */
export function matchHandAdded(handCards, rows, taken = new Set()) {
  const used = new Set([...taken].map(Number))
  const links = []
  const suggestions = []
  for (const card of handCards) {
    if (!card?.id || card.hidden || Number(card.tcgProductId) > 0) continue
    const cn = cardNumber(card)
    if (!cn) continue
    const seen = new Set()
    const cands = []
    for (const row of rows) {
      const pid = Number(row.productId)
      if (!(pid > 0) || used.has(pid) || seen.has(pid)) continue
      const rn = rowNumber(row)
      if (!rn || rn.num !== cn.num || (cn.of && rn.of !== cn.of) || !sameName(card, row)) continue
      seen.add(pid)
      cands.push({ productId: pid, groupId: Number(row.groupId) || null, name: row.name, extNumber: row.extNumber, marketPrice: Number(row.marketPrice) || 0 })
    }
    if (cands.length === 1) {
      links.push({ cardId: card.id, productId: cands[0].productId, groupId: cands[0].groupId })
      used.add(cands[0].productId)
    } else if (cands.length > 1) {
      suggestions.push({ cardId: card.id, products: cands })
    }
  }
  return { links, suggestions }
}

/**
 * The fresh card the sync writes for a linked hand-added card: its TCGplayer price (0 until it
 * sells — then a hand price is kept, stagnant.mjs keepHandPrice). null when its row isn't in this
 * run's download (a failed group) — the card is then left as it is.
 */
export function linkedHandCard(card, row) {
  if (!row) return null
  return {
    id: card.id, tcgProductId: Number(row.productId), ...(row.groupId && { tcgGroupId: Number(row.groupId) }),
    marketPrice: Number(row.marketPrice) || 0, marketPriceFoil: 0, lowPriceNM: Number(row.lowPrice) || 0, lowPriceNMFoil: 0,
  }
}
