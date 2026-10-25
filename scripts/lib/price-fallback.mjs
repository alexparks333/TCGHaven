// Backup prices for Pokémon cards TCGplayer's own feed (tcgcsv, downloadPokemon's Phase 2)
// leaves at $0. Layered, gap-only:
//
//   1. tcgcsv (TCGplayer)            — every card, the price of record. Not in this file.
//   2. api.pokemontcg.io             — TCGplayer's price for the same card, keyed by the exact
//                                      catalog id we already use (`${setId}-${number}`), so it
//                                      catches cards whose tcgcsv group/number matching failed.
//                                      Batched: one request per 40 cards.
//   3. api.tcgdex.net                — per card: its TCGplayer block if it has a fresh one, else
//                                      Cardmarket (the EU marketplace), converted EUR → USD and
//                                      tagged priceSource 'cardmarket' so the app labels it Est.
//
// Cost rules (the sync runs 4x/day):
//  - Only cards still unpriced after layer 1 are ever looked up — never a whole set.
//  - Each gap is re-checked at most once per FALLBACK_REFRESH_MS; the result (including "found
//    nothing") is cached in one Firestore doc and reused by the other syncs that day.
//  - A card that gets a real TCGplayer price drops out of the cache and is never looked up again.
//  - Lookups stop at MAX_LOOKUPS_PER_RUN or the time budget; the rest wait for the next sync.
//
// Pure apart from the injected loadCache/saveCache/fetchImpl, so it's testable without Firestore.

import { normSetName } from './text-norm.mjs'

export const FALLBACK_REFRESH_MS = 24 * 60 * 60 * 1000
// Backup source data older than this is ignored — a months-old price is worse than none.
export const MAX_SOURCE_AGE_MS = 45 * 24 * 60 * 60 * 1000
export const MAX_LOOKUPS_PER_RUN = 1500
export const DEFAULT_TIME_BUDGET_MS = 90 * 1000
// Firestore's 1MiB doc limit — a cache entry is ~100 bytes.
const MAX_CACHE_ENTRIES = 6000
const POKEMONTCG_BATCH = 40
// Bump when the price rules change, so cached results computed under the old rules are discarded
// instead of being reused for up to a day.
export const CACHE_VERSION = 2
const TCGDEX_CONCURRENCY = 6

export const SOURCE_TCGPLAYER_BACKUP = 'tcgplayer-backup'
export const SOURCE_CARDMARKET = 'cardmarket'

const round2 = (n) => Math.round(n * 100) / 100
const pos = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

export function isUnpriced(card) {
  return !(pos(card.marketPrice) || pos(card.marketPriceFoil))
}

// "020" / "20" / "GG04" / "GG4" → one comparable form (same rule as catalog-sync's normCardNum).
export function normNum(n) {
  const base = String(n ?? '').split('/')[0].trim()
  return base.replace(/^([A-Za-z]*)0*(\d+)([a-z]?)$/, (_, a, d, s) => a.toUpperCase() + parseInt(d, 10) + s) || base
}

function parseDate(s) {
  if (!s) return NaN
  return Date.parse(String(s).replace(/\//g, '-'))
}

// A TCGplayer price block (pokemontcg.io's `tcgplayer.prices`, or tcgdex's `pricing.tcgplayer`
// with its own field names) → { m, mf } using downloadPokemon's Phase 2 rule: base = normal,
// else holofoil; foil = holofoil, else reverse holo.
export function fromTcgplayerBlock(prices) {
  if (!prices || typeof prices !== 'object') return { m: 0, mf: 0 }
  const p = (k) => {
    const v = prices[k]
    if (!v || typeof v !== 'object') return 0
    return pos(v.market) || pos(v.marketPrice) || pos(v.mid) || pos(v.midPrice)
  }
  const normal = p('normal') || p('1stEditionNormal') || p('unlimited') || p('1stEdition')
  const holo = p('holofoil') || p('1stEditionHolofoil') || p('unlimitedHolofoil')
  const reverse = p('reverseHolofoil') || p('reverse-holofoil')
  return { m: round2(normal || holo), mf: round2(holo || reverse) }
}

// Cardmarket's trend, unless it's a spike: if it's more than 3x off the 30-day average, the
// average is the better estimate.
export function steadyCardmarketPrice(trend, avg30) {
  const t = pos(trend), a = pos(avg30)
  if (t && a && (t > a * 3 || t < a / 3)) return a
  return t || a
}

// Rarities that only ever exist as one (holo/special) printing. Cardmarket's normal-vs-holo split
// is unreliable for these: Deoxys's Rayquaza ☆ has its real price under "holo" (€511, "normal"
// €33 is a mislisted product) while Dragons Exalted's secret Rayquaza has it under "normal" (€202
// vs "holo" €7). For these the card's one price is the higher of the two. Common/Uncommon/Rare
// (and unknown) really do have separate normal and reverse-holo printings, so they keep the split.
export function isSinglePrintRarity(rarity) {
  const r = String(rarity ?? '').trim()
  return r !== '' && !/^(common|uncommon|rare|promo)$/i.test(r)
}

export function fromCardmarketBlock(cm, eurToUsd, { rarity } = {}) {
  if (!cm || !pos(eurToUsd)) return { m: 0, mf: 0 }
  const normal = steadyCardmarketPrice(cm.trend, cm.avg30)
  const holo = steadyCardmarketPrice(cm['trend-holo'], cm['avg30-holo'])
  if (isSinglePrintRarity(rarity)) {
    const one = round2(Math.max(normal, holo) * eurToUsd)
    return { m: one, mf: one }
  }
  return { m: round2(normal * eurToUsd), mf: round2(holo * eurToUsd) }
}

// ── Sources ─────────────────────────────────────────────────────────────────

async function getJson(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'TCGHaven/1.0', Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

// pokemontcg.io is flaky (bursts of 500/502/503 at any batch size, even one card), so a failed
// request gets two retries with a short backoff before the batch is given up for this sync.
async function getJsonWithRetry(fetchImpl, url, headers, { deadline = Infinity, delays = [1000, 3000] } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJson(fetchImpl, url, headers)
    } catch (err) {
      const wait = delays[attempt]
      if (wait === undefined || Date.now() + wait > deadline) throw err
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

// Layer 2. Returns Map<id, { m, mf, at }> for the ids pokemontcg.io has a fresh price for, plus
// `found.answered`: the ids whose request actually succeeded (a failed request proves nothing).
export async function lookupPokemonTcgIo(ids, { fetchImpl = fetch, now = Date.now(), apiKey = process.env.POKEMONTCG_API_KEY, deadline = Infinity, retryDelays } = {}) {
  const found = new Map()
  found.answered = new Set()
  const headers = apiKey ? { 'X-Api-Key': apiKey } : {}
  for (let i = 0; i < ids.length; i += POKEMONTCG_BATCH) {
    if (Date.now() > deadline) break
    const batch = ids.slice(i, i + POKEMONTCG_BATCH)
    const q = batch.map((id) => `id:"${id}"`).join(' OR ')
    const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&select=id,tcgplayer&pageSize=250`
    try {
      const { data = [] } = await getJsonWithRetry(fetchImpl, url, headers, { deadline, delays: retryDelays })
      batch.forEach((id) => found.answered.add(id))
      for (const c of data) {
        const at = parseDate(c.tcgplayer?.updatedAt)
        if (!(now - at <= MAX_SOURCE_AGE_MS)) continue
        const { m, mf } = fromTcgplayerBlock(c.tcgplayer?.prices)
        if (m || mf) found.set(c.id, { m, mf, at })
      }
    } catch (err) {
      console.warn(`   ⚠️  pokemontcg.io backup lookup failed (${batch.length} cards): ${err.message}`)
    }
  }
  return found
}

// Layer 3. `cards` are catalog cards ({ id, setName, number, rarity }). Returns Map<id, { m, mf, at,
// source }>, plus `found.answered` (cards tcgdex definitively answered for, including "tcgdex
// doesn't have this set/card"). Discovery: the set list once, then each affected set's card list
// (to learn tcgdex's own localId formatting), then one request per card.
export async function lookupTcgdex(cards, { fetchImpl = fetch, now = Date.now(), eurToUsd = 0, deadline = Infinity } = {}) {
  const found = new Map()
  found.answered = new Set()
  if (cards.length === 0) return found
  const BASE = 'https://api.tcgdex.net/v2/en'
  let sets
  try {
    sets = await getJson(fetchImpl, `${BASE}/sets`)
  } catch (err) {
    console.warn(`   ⚠️  tcgdex set list failed: ${err.message}`)
    return found
  }
  const setIdByName = new Map(sets.map((s) => [normSetName(s.name), s.id]))

  // card → tcgdex card id
  const bySet = new Map()
  for (const c of cards) {
    const sid = setIdByName.get(normSetName(c.setName ?? ''))
    if (!sid) { found.answered.add(c.id); continue }
    if (!bySet.has(sid)) bySet.set(sid, [])
    bySet.get(sid).push(c)
  }
  const targets = [] // [{ card, tcgdexId }]
  for (const [sid, setCards] of bySet) {
    if (Date.now() > deadline) break
    try {
      const set = await getJson(fetchImpl, `${BASE}/sets/${encodeURIComponent(sid)}`)
      const idByNum = new Map((set.cards ?? []).map((tc) => [normNum(tc.localId), tc.id]))
      for (const c of setCards) {
        const tid = idByNum.get(normNum(c.number))
        if (tid) targets.push({ card: c, tcgdexId: tid })
        else found.answered.add(c.id)
      }
    } catch (err) {
      console.warn(`   ⚠️  tcgdex set ${sid} failed: ${err.message}`)
    }
  }

  for (let i = 0; i < targets.length; i += TCGDEX_CONCURRENCY) {
    if (Date.now() > deadline) break
    await Promise.all(targets.slice(i, i + TCGDEX_CONCURRENCY).map(async ({ card, tcgdexId }) => {
      try {
        const tc = await getJson(fetchImpl, `${BASE}/cards/${encodeURIComponent(tcgdexId)}`)
        found.answered.add(card.id)
        const tp = tc.pricing?.tcgplayer
        const tpAt = parseDate(tp?.updated)
        if (tp && now - tpAt <= MAX_SOURCE_AGE_MS) {
          const { m, mf } = fromTcgplayerBlock(tp)
          if (m || mf) { found.set(card.id, { m, mf, at: tpAt, source: SOURCE_TCGPLAYER_BACKUP }); return }
        }
        const cm = tc.pricing?.cardmarket
        const cmAt = parseDate(cm?.updated)
        if (cm && now - cmAt <= MAX_SOURCE_AGE_MS) {
          const { m, mf } = fromCardmarketBlock(cm, eurToUsd, { rarity: card.rarity })
          if (m || mf) found.set(card.id, { m, mf, at: cmAt, source: SOURCE_CARDMARKET })
        }
      } catch {
        // one card failing just leaves it unpriced until its next daily check
      }
    }))
  }
  return found
}

// EUR → USD, refreshed at most daily (ECB rate via frankfurter.app). A rate up to a week old is
// still used if the refresh fails; with no usable rate Cardmarket prices are skipped entirely.
async function eurToUsdRate(cache, { fetchImpl, now }) {
  if (cache.fx && now - cache.fx.at < FALLBACK_REFRESH_MS) return cache.fx.rate
  try {
    const d = await getJson(fetchImpl, 'https://api.frankfurter.app/latest?from=EUR&to=USD')
    const rate = pos(d?.rates?.USD)
    if (rate > 0.5 && rate < 2) { cache.fx = { rate, at: now }; return rate }
  } catch (err) {
    console.warn(`   ⚠️  EUR→USD rate fetch failed: ${err.message}`)
  }
  if (cache.fx && now - cache.fx.at < 7 * FALLBACK_REFRESH_MS) return cache.fx.rate
  return 0
}

// ── Orchestration ───────────────────────────────────────────────────────────

/**
 * Fills marketPrice/marketPriceFoil/priceSource on the unpriced cards in `cards` (mutated in
 * place) from the backup layers. Cache shape (one Firestore doc):
 *   { entries: { [id]: { m, mf, src, at, checkedAt } }, fx: { rate, at } }
 */
export async function fillPokemonPriceGaps(cards, {
  loadCache, saveCache, fetchImpl = fetch, now = Date.now(),
  maxLookups = MAX_LOOKUPS_PER_RUN, timeBudgetMs = DEFAULT_TIME_BUDGET_MS, retryDelays,
} = {}) {
  const deadline = Date.now() + timeBudgetMs
  const gaps = cards.filter(isUnpriced)
  const cache = (await loadCache().catch(() => null)) ?? {}
  const entries = cache.v === CACHE_VERSION ? { ...(cache.entries ?? {}) } : {}

  // Cards that left the gap list (now priced by TCGplayer, or gone) stop being tracked.
  const gapIds = new Set(gaps.map((c) => c.id))
  for (const id of Object.keys(entries)) if (!gapIds.has(id)) delete entries[id]

  // Due for a check: never checked first, then the longest-unchecked.
  const due = gaps
    .filter((c) => !(now - (entries[c.id]?.checkedAt ?? 0) < FALLBACK_REFRESH_MS))
    .sort((a, b) => (entries[a.id]?.checkedAt ?? 0) - (entries[b.id]?.checkedAt ?? 0))
    .slice(0, maxLookups)

  let fromL2 = 0, fromL3 = 0
  if (due.length > 0) {
    const l2 = await lookupPokemonTcgIo(due.map((c) => c.id), { fetchImpl, now, deadline, retryDelays })
    const rest = due.filter((c) => !l2.has(c.id))
    const eurToUsd = rest.length > 0 ? await eurToUsdRate(cache, { fetchImpl, now }) : 0
    const l3 = await lookupTcgdex(rest, { fetchImpl, now, eurToUsd, deadline })
    for (const c of due) {
      const hit = l2.get(c.id) ? { ...l2.get(c.id), source: SOURCE_TCGPLAYER_BACKUP } : l3.get(c.id)
      if (hit) {
        entries[c.id] = { m: hit.m, mf: hit.mf, src: hit.source, at: hit.at, checkedAt: now }
        if (l2.has(c.id)) fromL2++; else fromL3++
      } else if (l2.answered.has(c.id) && l3.answered.has(c.id)) {
        // Both sources answered and neither has a usable price — remember that for a day.
        entries[c.id] = { m: 0, mf: 0, src: '', at: 0, checkedAt: now }
      }
      // Otherwise a source failed or the run ran out of time before reaching this card: leave
      // its previous entry (and any backup price it had) alone and retry next sync.
    }
  }

  // Apply every cached hit (fresh ones from this run and ones reused from earlier today).
  let applied = 0, estimated = 0
  for (const c of gaps) {
    const e = entries[c.id]
    if (!e || !(e.m || e.mf)) continue
    c.marketPrice = e.m
    c.marketPriceFoil = e.mf
    c.priceSource = e.src
    applied++
    if (e.src === SOURCE_CARDMARKET) estimated++
  }

  // Stay under the doc size limit: keep the most recently checked entries.
  const kept = Object.entries(entries).sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, MAX_CACHE_ENTRIES)
  await saveCache({ v: CACHE_VERSION, entries: Object.fromEntries(kept), fx: cache.fx ?? null }).catch((err) =>
    console.warn(`   ⚠️  Backup price cache not saved: ${err.message}`))

  const summary = { gaps: gaps.length, checked: due.length, fromL2, fromL3, applied, estimated, stillUnpriced: gaps.length - applied }
  console.log(`   Backup prices: ${summary.gaps} unpriced after TCGplayer, ${summary.checked} checked this run ` +
    `(${fromL2} pokemontcg.io, ${fromL3} tcgdex) → ${applied} filled (${estimated} Cardmarket estimates), ${summary.stillUnpriced} still unpriced`)
  return summary
}
