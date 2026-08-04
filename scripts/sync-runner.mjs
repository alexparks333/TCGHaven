/**
 * One-shot orchestrator for the Settings "Sync Card Data" feature.
 * Spawned detached + unref'd by app/api/sync/route.ts so it survives the Next.js
 * server process it may eventually kill and restart (see the "restart" phase).
 *
 * Usage: node scripts/sync-runner.mjs <runId>
 *
 * Phases (each updates data/sync-status.json before/after):
 *   backup → download → diff → riftboundMatch → registryUpdate → build → restart
 * If `build` fails, the currently-running server is left untouched — only a
 * successful build ever triggers killPort3000()/startServer().
 */

import { spawn, execSync } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchSetName } from './lib/text-norm.mjs'
import { writeStatus } from './lib/sync-status.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const runId = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-')
const LOG_PATH = join(ROOT, 'data', 'sync-run.log')
const REGISTRY_PATH = join(ROOT, 'data', 'set-registry.json')
const TIMEOUT_MS = 15 * 60 * 1000
const startedAt = Date.now()

mkdirSync(join(ROOT, 'data'), { recursive: true })

function log(line) {
  try { appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`) } catch {}
}

function checkTimeout() {
  if (Date.now() - startedAt > TIMEOUT_MS) {
    throw new Error(`sync-runner exceeded its ${TIMEOUT_MS / 60000}-minute timeout`)
  }
}

const status = {
  runId,
  phase: 'backup',
  startedAt: new Date(startedAt).toISOString(),
  phases: {
    backup: { status: 'running' },
    download: { status: 'pending' },
    diff: { status: 'pending' },
    riftboundMatch: { status: 'pending' },
    registryUpdate: { status: 'pending' },
    build: { status: 'pending' },
    restart: { status: 'pending' },
  },
  summary: {
    newSets: { pokemon: 0, lorcana: [], riftbound: [] },
    riftboundGroupMatches: [],
    registryUpdates: [],
    build: { success: null, durationMs: null, errorTail: null },
    restart: { attempted: false, success: null, oldPid: null, newPid: null },
  },
  error: null,
}

function save() { writeStatus(ROOT, status) }
function setPhase(name) { status.phase = name; save() }
function phaseDone(name, extra = {}) { status.phases[name] = { status: 'done', ...extra }; save() }
function phaseFailed(name, reason) { status.phases[name] = { status: 'failed', reason }; save() }

function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
}
function saveRegistry(registry) {
  const tmp = REGISTRY_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(registry, null, 2))
  renameSync(tmp, REGISTRY_PATH)
}

function runCmd(cmd, args, { cwd = ROOT, label = cmd } = {}) {
  return new Promise((resolve) => {
    log(`$ ${cmd} ${args.join(' ')}`)
    const child = spawn(cmd, args, { cwd })
    let output = ''
    const onData = (buf) => {
      const text = buf.toString()
      output += text
      if (output.length > 20000) output = output.slice(-20000)
      try { appendFileSync(LOG_PATH, text) } catch {}
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('close', (code) => {
      log(`${label} exited with code ${code}`)
      resolve({ code, output })
    })
    child.on('error', (err) => {
      log(`${label} failed to spawn: ${err.message}`)
      resolve({ code: -1, output: output + `\n${err.message}` })
    })
  })
}

// Kills whatever is listening on port 3000 (SIGTERM, then SIGKILL after a 5s grace
// period). Coarse by design — only reachable from the "restart" phase, which only
// runs after a build succeeds AND only when POST /api/sync guarded NODE_ENV==='production',
// so this can never fire against `npm run dev`.
function killPort3000() {
  const listPids = () => {
    try { return execSync('lsof -ti :3000').toString().trim().split('\n').filter(Boolean) } catch { return [] }
  }
  const pids = listPids()
  for (const pid of pids) { try { process.kill(Number(pid), 'SIGTERM') } catch {} }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && listPids().length > 0) { /* brief synchronous wait — one-shot script, not a server */ }
  for (const pid of listPids()) { try { process.kill(Number(pid), 'SIGKILL') } catch {} }
  return pids
}

function startServer() {
  // Use the local `next` binary directly (not `npm run start`) so this doesn't
  // depend on npm's PATH resolution inside a detached, minimal-env child.
  const nextBin = join(ROOT, 'node_modules', '.bin', 'next')
  const child = spawn(nextBin, ['start', '-p', '3000'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()
  return child.pid
}

async function main() {
  // ── Phase: backup (non-destructive — nothing is ever deleted) ──────────────
  const backupDir = join(ROOT, 'data', 'backups', runId)
  mkdirSync(backupDir, { recursive: true })
  for (const f of ['pokemon-cards.json', 'lorcana-cards.json', 'riftbound-cards.json']) {
    const src = join(ROOT, 'public', 'data', f)
    if (existsSync(src)) copyFileSync(src, join(backupDir, f))
  }
  if (existsSync(REGISTRY_PATH)) copyFileSync(REGISTRY_PATH, join(backupDir, 'set-registry.json'))
  phaseDone('backup')
  log(`Backed up catalogs + registry to data/backups/${runId}`)
  checkTimeout()

  // ── Phase: download ─────────────────────────────────────────────────────────
  setPhase('downloading')
  status.phases.download.status = 'running'; save()
  const beforeRegistry = loadRegistry()
  const dl1 = await runCmd(process.execPath, ['--env-file=.env.local', join(ROOT, 'scripts', 'download-card-catalog.mjs')], { label: 'download-card-catalog.mjs' })
  if (dl1.code !== 0) {
    phaseFailed('download', `exit code ${dl1.code}`)
    status.phase = 'failed'
    status.error = 'Catalog download failed — nothing was rebuilt or restarted; previous catalogs are untouched.'
    save()
    return
  }
  phaseDone('download')
  checkTimeout()

  // ── Phase: diff ──────────────────────────────────────────────────────────────
  setPhase('diffing')
  const summaryPath = join(ROOT, 'data', 'last-download-summary.json')
  const dlSummary = JSON.parse(readFileSync(summaryPath, 'utf-8'))
  status.summary.newSets.pokemon = dlSummary.pokemon.setNames.length

  const knownLorcanaNames = new Set(beforeRegistry.lorcana.sets.map((s) => s.setName))
  const newLorcanaNames = dlSummary.lorcana.setNames.filter((n) => !knownLorcanaNames.has(n))
  status.summary.newSets.lorcana = newLorcanaNames

  const knownRiftboundNames = new Set(beforeRegistry.riftbound.sets.map((s) => s.setName))
  const newRiftboundNames = dlSummary.riftbound.setNames.filter((n) => !knownRiftboundNames.has(n))
  status.summary.newSets.riftbound = newRiftboundNames
  phaseDone('diff')
  save()
  checkTimeout()

  // ── Phase: riftboundMatch ────────────────────────────────────────────────────
  // Any Riftbound set that's brand-new OR already registered but still missing a
  // tcgcsvGroupId (e.g. released before its TCGPlayer group existed) gets a fresh
  // fuzzy-match attempt against the live tcgcsv.com group listing.
  setPhase('matching-riftbound-groups')
  const registry = loadRegistry()
  const needsGroupMatch = new Set(newRiftboundNames)
  for (const s of registry.riftbound.sets) {
    if (s.tcgcsvGroupId == null) needsGroupMatch.add(s.setName)
  }

  let groupsFetched = false
  if (needsGroupMatch.size > 0) {
    try {
      const res = await fetch('https://tcgcsv.com/tcgplayer/89/groups', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Referer': 'https://tcgcsv.com/' },
      })
      if (res.ok) {
        const data = await res.json()
        const groups = (data.results ?? []).map((g) => ({ groupId: g.groupId, name: g.name }))
        groupsFetched = true
        for (const setName of needsGroupMatch) {
          const alreadyUsed = new Set(registry.riftbound.sets.map((s) => s.tcgcsvGroupId).filter((id) => id != null))
          const candidateGroups = groups.filter((g) => !alreadyUsed.has(g.groupId))
          const result = matchSetName(setName, candidateGroups)
          status.summary.riftboundGroupMatches.push({
            setName, matched: !!result.match,
            groupId: result.match?.groupId ?? null,
            confidence: result.confidence,
            candidates: result.candidates,
          })
          const entry = registry.riftbound.sets.find((s) => s.setName === setName)
          if (entry && result.match) {
            entry.tcgcsvGroupId = result.match.groupId
            entry.groupMatchConfidence = result.confidence
            entry.needsReview = true // still flagged — see the post-reprice "zero prices" safety net below
          }
        }
      } else {
        log(`tcgcsv groups fetch failed: ${res.status}`)
      }
    } catch (err) {
      log(`tcgcsv groups fetch error: ${err.message}`)
    }
  }
  saveRegistry(registry)
  phaseDone('riftboundMatch', { groupsFetched })
  checkTimeout()

  // ── Phase: registryUpdate ────────────────────────────────────────────────────
  // Append genuinely new sets with conservative defaults, always needsReview: true.
  setPhase('updating-registry')
  const registry2 = loadRegistry()
  const nowIso = new Date().toISOString()

  for (const setName of newLorcanaNames) {
    if (registry2.lorcana.sets.some((s) => s.setName === setName)) continue
    registry2.lorcana.sets.push({
      setName, code: null, lorcastId: null, releaseDate: null,
      cardexGroup: 'Special Sets',
      packAnalysis: { included: false },
      needsReview: true, source: 'auto-detected', addedAt: nowIso,
    })
    status.summary.registryUpdates.push({ game: 'lorcana', setName, needsReview: true })
  }

  for (const setName of newRiftboundNames) {
    if (registry2.riftbound.sets.some((s) => s.setName === setName)) continue
    const cardCount = 0 // filled in below once we can read the fresh catalog
    registry2.riftbound.sets.push({
      setName, setCode: '', releaseDate: null, cardCount,
      cardexGroup: 'Main Sets', tcgcsvGroupId: null, groupMatchConfidence: null,
      needsReview: true, source: 'auto-detected', addedAt: nowIso,
    })
    status.summary.registryUpdates.push({ game: 'riftbound', setName, needsReview: true })
  }

  // Backfill setCode/cardCount for newly-added Riftbound sets from the fresh catalog
  // (trustworthy — comes directly from parsed card data, not a guess).
  if (newRiftboundNames.length > 0) {
    try {
      const riftCatalog = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'riftbound-cards.json'), 'utf-8'))
      for (const name of newRiftboundNames) {
        const entry = registry2.riftbound.sets.find((s) => s.setName === name)
        if (!entry) continue
        const matches = riftCatalog.filter((c) => c.setName === name)
        entry.cardCount = matches.length
        entry.setCode = matches[0]?.setCode ?? ''
      }
    } catch (err) {
      log(`riftbound catalog backfill error: ${err.message}`)
    }
  }

  // Carry forward any group-match writes from the previous phase (registry2 was
  // loaded fresh from disk, which already includes them since riftboundMatch saved).
  saveRegistry(registry2)
  phaseDone('registryUpdate')
  checkTimeout()

  // ── Conditional second download pass ─────────────────────────────────────────
  // New Riftbound sets are discovered from the gallery scrape (no group ID needed),
  // but a newly-matched tcgcsvGroupId can only be priced by re-running the download
  // now that the registry override is in place.
  const anyNewGroupMatched = status.summary.riftboundGroupMatches.some((m) => m.matched)
  if (anyNewGroupMatched) {
    setPhase('repricing')
    const dl2 = await runCmd(process.execPath, ['--env-file=.env.local', join(ROOT, 'scripts', 'download-card-catalog.mjs')], { label: 'download-card-catalog.mjs (repricing pass)' })
    if (dl2.code !== 0) {
      log(`repricing pass failed with code ${dl2.code} — proceeding with first-pass catalogs`)
    } else {
      // Safety net: a confident name match with zero priced cards for that set is a
      // strong signal the groupId is wrong (or the group's CSV isn't populated yet).
      try {
        const riftCatalog = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'riftbound-cards.json'), 'utf-8'))
        const registry3 = loadRegistry()
        for (const m of status.summary.riftboundGroupMatches) {
          if (!m.matched) continue
          const cards = riftCatalog.filter((c) => c.setName === m.setName)
          const anyPriced = cards.some((c) => (c.marketPrice ?? 0) > 0)
          if (!anyPriced && cards.length > 0) {
            const entry = registry3.riftbound.sets.find((s) => s.setName === m.setName)
            if (entry) entry.needsReview = true
            log(`${m.setName}: matched group ${m.groupId} but zero priced cards — flagged needsReview`)
          }
        }
        saveRegistry(registry3)
      } catch (err) {
        log(`post-reprice safety check error: ${err.message}`)
      }
    }
  }
  checkTimeout()

  // ── Phase: build ─────────────────────────────────────────────────────────────
  setPhase('building')
  status.phases.build.status = 'running'; save()
  const buildStart = Date.now()
  const nextBin = join(ROOT, 'node_modules', '.bin', 'next')
  const build = await runCmd(nextBin, ['build'], { label: 'next build' })
  const buildDurationMs = Date.now() - buildStart
  status.summary.build.durationMs = buildDurationMs

  if (build.code !== 0) {
    status.summary.build.success = false
    status.summary.build.errorTail = build.output.slice(-4000)
    phaseFailed('build', `exit code ${build.code}`)
    status.phase = 'failed'
    status.error = 'Build failed — the currently running server was left untouched. Check summary.build.errorTail.'
    save()
    return
  }
  status.summary.build.success = true
  phaseDone('build')
  checkTimeout()

  // ── Phase: restart (build succeeded — this is the only path that reaches here) ─
  setPhase('restarting')
  status.phases.restart.status = 'running'; save()
  status.summary.restart.attempted = true
  const oldPids = killPort3000()
  status.summary.restart.oldPid = oldPids[0] ?? null
  const newPid = startServer()
  status.summary.restart.newPid = newPid
  status.summary.restart.success = true
  phaseDone('restart')
  status.phase = 'done'
  save()
  log('Sync complete — server restarted.')
}

main().catch((err) => {
  log(`Fatal error: ${err.stack || err.message}`)
  status.phase = 'failed'
  status.error = err.message
  save()
  process.exit(1)
})
