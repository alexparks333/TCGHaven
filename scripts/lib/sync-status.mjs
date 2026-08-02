import { writeFileSync, renameSync, mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'

export function statusPath(root) {
  return join(root, 'data', 'sync-status.json')
}

// Atomic write-temp-then-rename so a concurrent GET never reads a half-written file.
export function writeStatus(root, status) {
  const p = statusPath(root)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2))
  renameSync(tmp, p)
}

export function readStatus(root) {
  try {
    return JSON.parse(readFileSync(statusPath(root), 'utf-8'))
  } catch {
    return { phase: 'idle' }
  }
}
