import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { loadSetRegistry, type SetRegistry } from '@/lib/api/registry'

export const dynamic = 'force-dynamic'

const REGISTRY_PATH = join(process.cwd(), 'data', 'set-registry.json')

export async function GET() {
  return NextResponse.json(loadSetRegistry())
}

// Structured patch of a single set entry — used by the Settings "Needs Review" editor.
// Never touches TypeScript source; only ever reads/writes this one JSON file.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  const gameRaw = body?.game
  const setName = body?.setName
  const patch = body?.patch

  if ((gameRaw !== 'lorcana' && gameRaw !== 'riftbound') || typeof setName !== 'string' || typeof patch !== 'object' || patch === null) {
    return NextResponse.json({ error: 'Expected { game: "lorcana"|"riftbound", setName: string, patch: object }' }, { status: 400 })
  }
  const game: 'lorcana' | 'riftbound' = gameRaw

  let registry: SetRegistry
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'))
  } catch {
    return NextResponse.json({ error: 'set-registry.json does not exist yet' }, { status: 404 })
  }

  const sets = registry[game].sets as unknown as Array<Record<string, unknown>>
  const idx = sets.findIndex((s) => s.setName === setName)
  if (idx === -1) {
    return NextResponse.json({ error: `No ${game} set named "${setName}" in the registry` }, { status: 404 })
  }

  sets[idx] = { ...sets[idx], ...patch }

  const tmpPath = REGISTRY_PATH + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(registry, null, 2))
  renameSync(tmpPath, REGISTRY_PATH)

  return NextResponse.json({ ok: true, set: sets[idx] })
}
