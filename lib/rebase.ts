// Saving one person's edit onto a list (or object) someone else may have changed meanwhile.
// Several staff edit the same few Firestore docs (badge_catalog/main, registry/textKeys); writing
// a whole copy back would silently undo whatever anyone else saved since that copy was read. These
// replay only what THIS person changed (base → mine) onto the latest version (fresh).

/** Same value, ignoring key order and undefined fields (Firestore drops those anyway) */
export function sameValue(a: unknown, b: unknown): boolean {
  return stableKey(a) === stableKey(b)
}

function stableKey(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableKey(x))).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableKey((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/**
 * A list of items with ids, after this person's edit (base → mine) is replayed onto `fresh`:
 * - items they added, changed or deleted get their version; every other item keeps the latest one
 *   (so others' additions, edits and deletions all survive);
 * - an item they changed that someone else deleted comes back (their edit is the newer intent);
 * - order: theirs if they reordered anything, else the latest — new items from the other side go
 *   in right after the item they followed there.
 */
export function rebaseList<T>(base: T[], mine: T[], fresh: T[], idOf: (x: T) => string): T[] {
  const B = new Map(base.map((x) => [idOf(x), x]))
  const M = new Map(mine.map((x) => [idOf(x), x]))
  const F = new Map(fresh.map((x) => [idOf(x), x]))
  const changedByMe = (id: string) => !B.has(id) || !sameValue(B.get(id), M.get(id))

  const out = new Map<string, T>()
  for (const [id, f] of Array.from(F)) {
    if (B.has(id) && !M.has(id)) continue // deleted by me
    out.set(id, M.has(id) && changedByMe(id) ? M.get(id)! : f)
  }
  for (const [id, m] of Array.from(M)) if (!F.has(id) && changedByMe(id)) out.set(id, m)

  const shared = (list: T[], other: Map<string, T>) => list.map(idOf).filter((id) => other.has(id))
  const reordered = shared(base, M).join('\u0000') !== shared(mine, B).join('\u0000')
  const [primary, secondary] = reordered ? [mine, fresh] : [fresh, mine]

  const order = primary.map(idOf).filter((id) => out.has(id))
  const placed = new Set(order)
  let after = -1 // index in `order` of the last secondary item already placed
  for (const id of secondary.map(idOf)) {
    if (placed.has(id)) { after = order.indexOf(id); continue }
    if (!out.has(id)) continue
    order.splice(after + 1, 0, id)
    placed.add(id)
    after++
  }
  for (const id of Array.from(out.keys())) if (!placed.has(id)) order.push(id)
  return order.map((id) => out.get(id)!)
}

/**
 * One record edited in a form (base = what the form opened with, mine = what's being saved) onto
 * the latest version: only the fields this person changed are applied. `clashes` = fields both
 * they and someone else changed, to differently — the caller asks before overwriting those.
 */
export function mergeEdit<T extends object>(base: T, mine: T, latest: T): { merged: T; clashes: string[] } {
  const keys = Array.from(new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(latest)])) as (keyof T)[]
  const merged = { ...latest }
  const clashes: string[] = []
  for (const k of keys) {
    if (sameValue(base[k], mine[k])) continue // not touched by me
    if (!sameValue(base[k], latest[k]) && !sameValue(mine[k], latest[k])) clashes.push(String(k))
    if (mine[k] === undefined) delete merged[k]
    else merged[k] = mine[k]
  }
  return { merged, clashes }
}
