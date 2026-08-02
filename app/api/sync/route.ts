import { NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { openSync, readFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

const ROOT = process.cwd()
const RUNNING_PHASES = new Set([
  'downloading', 'diffing', 'matching-riftbound-groups', 'updating-registry',
  'repricing', 'building', 'restarting',
])

function readStatus() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'data', 'sync-status.json'), 'utf-8'))
  } catch {
    return { phase: 'idle' }
  }
}

// Kicks off scripts/sync-runner.mjs — see that file for the full phase pipeline
// (download → diff → riftbound group match → registry update → build → restart).
// Runs only against `npm run start` (production), never `npm run dev`, since the
// restart phase kills whatever is listening on port 3000.
export async function POST() {
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.json(
      {
        error: 'Sync + auto-restart only runs against the production server (`npm run build && npm run start`). ' +
          'You are running `npm run dev` right now — running this would kill your dev server.',
      },
      { status: 400 },
    )
  }

  const status = readStatus()
  if (RUNNING_PHASES.has(status.phase)) {
    return NextResponse.json({ error: 'A sync is already running', status }, { status: 409 })
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const logFd = openSync(join(ROOT, 'data', 'sync-run.log'), 'a')
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'sync-runner.mjs'), runId], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  child.unref()

  return NextResponse.json({ status: 'started', runId }, { status: 202 })
}
