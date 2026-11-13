/**
 * The real-scan check — real iPhone scans run through a running TCGHaven server and judged exactly
 * as the phone would (lib/scan/decide.ts shortlist → decide → trayVerdict). Run on every push by
 * .github/workflows/checks.yml against the freshly built site, so a version that scans worse never
 * goes live. Docs: docs/card-scanner.md "The real-scan check".
 *
 *   npm run test:realscans -- [base URL, default http://localhost:3000] [--verbose] [--text-only]
 *
 * The scans (scripts/scanner-realscans.json, built by tools/scanner-ai/realscans.py): the text the
 * phone read, the picture AI's fingerprint, the right card. All 13 games are searched, like a
 * collector who tracks every game.
 *
 * Fails when: a scan would be ADDED AS THE WRONG CARD (more than LIMITS allow), fewer scans are
 * added right or have the right card first, or the server stays busy / errors.
 * While the file's fingerprints come from a different model than the published one (just after a
 * retrain), it runs on text only with its own limits — and says to rebuild the file.
 */
import fs from 'node:fs'
import { shortlist, decide, trayVerdict, type Offered } from '../lib/scan/decide.ts'

// Measured 2026-11-13 on the 66 scans: with the picture AI 41 added right, 0 wrong, 51 right card
// first; text only 37 / 0 / 48 (64 scans). The limits leave 2 scans of room (a catalog sync can
// shift a close call). Raise them as the scanner gets better; lowering one means accepting a worse scanner.
const LIMITS = {
  picture: { maxWrongAdds: 0, minAddedRight: 39, minRightFirst: 49 },
  textOnly: { maxWrongAdds: 0, minAddedRight: 35, minRightFirst: 46 },
}

const GAMES = ['pokemon', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']
const args = process.argv.slice(2)
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/$/, '')
const verbose = args.includes('--verbose')
const forceText = args.includes('--text-only') // measure the text-only limits

interface Scan { id: string; card: string; title: string; lines: unknown[]; fingerprint: number[] }
const file = JSON.parse(fs.readFileSync(new URL('./scanner-realscans.json', import.meta.url), 'utf8')) as { model: string; scans: Scan[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function fetchJson(url: string, init?: RequestInit, tries = 6): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) })
      if (res.ok) return await res.json()
      if (i >= tries - 1) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.slice(0, 200))
    } catch (err) {
      if (i >= tries - 1) throw err
    }
    await sleep(3000 * (i + 1))
  }
}

// The published picture model: the file's fingerprints only mean something to the same model
const published = (await fetchJson(`${base}/api/cards/scan?model=1`))?.model?.version ?? null
const withPicture = published === file.model && !forceText
if (published !== file.model) {
  console.log(`⚠ The test file's fingerprints are from ${file.model}, the published model is ${published ?? 'unknown'} — checking on text only.`)
  console.log('  Rebuild the file: tools/scanner-ai/realscans.py (docs/card-scanner.md "The real-scan check").')
}
const limits = withPicture ? LIMITS.picture : LIMITS.textOnly

// Load every catalog and picture index first (a cold server takes a while)
const t0 = Date.now()
await fetchJson(`${base}/api/cards/scan?warm=1&games=${GAMES.join(',')}`)
console.log(`Server ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

type Result = 'added right' | 'ADDED WRONG' | 'asked, right first' | 'asked, right listed' | 'asked, right missing' | 'dropped'
const tally = new Map<Result, number>()
const wrong: string[] = []
for (const s of file.scans) {
  const body = { lines: s.lines, games: GAMES, ...(withPicture && { fingerprints: [s.fingerprint] }) }
  const { candidates } = await fetchJson(`${base}/api/cards/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as { candidates: Array<Offered & { key: string; name: string; setName: string; number: string; exact: boolean; picture: number | null }> }
  const { close, rest } = shortlist(candidates)
  const { ranked, status } = decide(close.map((c) => ({ ...c, trusted: c.why.includes(' label ') })), undefined, close.map((c) => c.picture))
  const ordered = [...ranked, ...rest]
  const verdict = trayVerdict(status, ordered[0], null, ranked[0]?.similarity ?? null)
  const top = ordered[0]
  const at = ordered.slice(0, 12).findIndex((c) => c.key === s.card)
  const result: Result = verdict === 'reject' ? 'dropped'
    : verdict === 'matched' ? (top?.key === s.card ? 'added right' : 'ADDED WRONG')
    : at === 0 ? 'asked, right first' : at > 0 ? 'asked, right listed' : 'asked, right missing'
  tally.set(result, (tally.get(result) ?? 0) + 1)
  const line = `${result.padEnd(21)} ${s.title} (${s.card})${top && top.key !== s.card ? ` → top: ${top.name}, ${top.setName} #${top.number}` : ''}`
  if (result === 'ADDED WRONG') wrong.push(line)
  if (verbose || result === 'ADDED WRONG') console.log(line)
}

const n = (r: Result) => tally.get(r) ?? 0
const addedRight = n('added right'), rightFirst = n('added right') + n('asked, right first'), wrongAdds = n('ADDED WRONG')
console.log(`\n${file.scans.length} real scans (${withPicture ? 'text + picture AI' : 'text only'}):`)
for (const r of ['added right', 'ADDED WRONG', 'asked, right first', 'asked, right listed', 'asked, right missing', 'dropped'] as Result[]) console.log(`  ${r.padEnd(21)} ${n(r)}`)

const fails: string[] = []
if (wrongAdds > limits.maxWrongAdds) fails.push(`${wrongAdds} scans would be added as the wrong card (limit ${limits.maxWrongAdds})`)
if (addedRight < limits.minAddedRight) fails.push(`only ${addedRight} added right (needs ${limits.minAddedRight})`)
if (rightFirst < limits.minRightFirst) fails.push(`only ${rightFirst} with the right card first (needs ${limits.minRightFirst})`)
if (fails.length) {
  console.error(`\n✗ The scanner got worse on real scans — not going live:\n  ${fails.join('\n  ')}`)
  process.exit(1)
}
console.log('\n✓ Real-scan check passed')
