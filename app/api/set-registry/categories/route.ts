import { NextResponse } from 'next/server'
import { invalidateRegistryCache, loadSetRegistry, saveSetRegistry } from '@/lib/api/registry'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'
import { invalidateSetsCache } from '@/lib/api/search'

export const dynamic = 'force-dynamic'

// Cardex categories ("Main Sets", "Promos", "Special"…) for the games whose set picker the
// registry curates — Lorcana and Riftbound. A category is a label in the game's `groupOrder` (its
// order in the Cardex) that sets point at with `cardexGroup`. Staff manage them from the Admin
// Catalog's Categories panel.
//
// POST { game, action, ... }
//   add      { name }              — a new, empty category at the end
//   rename   { from, to }          — renames it everywhere (every set in it follows)
//   delete   { name }              — only when no set is in it
//   reorder  { order: string[] }   — the categories, in Cardex order
//   assign   { setName, category } — put a set in a category
//   move     { setName, dir: -1|1 } — move a set up/down among its category's sets (the registry's
//                                     set order is the order the Cardex lists them in)
type CategoryGame = 'lorcana' | 'riftbound'

export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized

  const body = await request.json().catch(() => null)
  const game = body?.game as CategoryGame
  if (game !== 'lorcana' && game !== 'riftbound') {
    return NextResponse.json({ error: 'Categories are only curated for lorcana and riftbound' }, { status: 400 })
  }
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  invalidateRegistryCache() // read-modify-write: never from a stale copy (a sync on another process may have changed it)
  const registry = await loadSetRegistry()
  const side = registry[game]
  const sets = side.sets as Array<{ setName: string; cardexGroup: string | null }>
  // Everything currently a category: the listed order, then any a set uses that it doesn't list.
  const order = [...side.groupOrder]
  for (const s of sets) if (s.cardexGroup && !order.includes(s.cardexGroup)) order.push(s.cardexGroup)
  const exists = (name: string) => order.some((c) => c.toLowerCase() === name.toLowerCase())
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

  switch (body?.action) {
    case 'add': {
      const name = clean(body.name)
      if (!name) return fail('A category needs a name')
      if (exists(name)) return fail(`"${name}" already exists`, 409)
      order.push(name)
      break
    }
    case 'rename': {
      const from = clean(body.from)
      const to = clean(body.to)
      if (!order.includes(from)) return fail(`No category "${from}"`, 404)
      if (!to) return fail('A category needs a name')
      if (to.toLowerCase() !== from.toLowerCase() && exists(to)) return fail(`"${to}" already exists`, 409)
      order[order.indexOf(from)] = to
      for (const s of sets) if (s.cardexGroup === from) s.cardexGroup = to
      break
    }
    case 'delete': {
      const name = clean(body.name)
      if (!order.includes(name)) return fail(`No category "${name}"`, 404)
      const inIt = sets.filter((s) => s.cardexGroup === name)
      if (inIt.length) return fail(`Move its ${inIt.length} set${inIt.length === 1 ? '' : 's'} out first (${inIt.map((s) => s.setName).join(', ')})`, 409)
      order.splice(order.indexOf(name), 1)
      break
    }
    case 'reorder': {
      const next = Array.isArray(body.order) ? (body.order as unknown[]).map(clean) : []
      if (next.length !== order.length || !order.every((c) => next.includes(c))) return fail('The new order must list every category exactly once')
      order.splice(0, order.length, ...next)
      break
    }
    case 'assign': {
      const set = sets.find((s) => s.setName === clean(body.setName))
      const category = clean(body.category)
      if (!set) return fail(`No ${game} set named "${clean(body.setName)}"`, 404)
      if (!category) return fail('Pick a category')
      if (!order.includes(category)) order.push(category)
      set.cardexGroup = category
      break
    }
    case 'move': {
      const i = sets.findIndex((s) => s.setName === clean(body.setName))
      if (i === -1) return fail(`No ${game} set named "${clean(body.setName)}"`, 404)
      const dir = body.dir === -1 ? -1 : 1
      // The neighbour in the same category, in that direction
      let j = i + dir
      while (j >= 0 && j < sets.length && sets[j].cardexGroup !== sets[i].cardexGroup) j += dir
      if (j < 0 || j >= sets.length) return fail('Already at the end of its category')
      ;[sets[i], sets[j]] = [sets[j], sets[i]]
      break
    }
    default:
      return fail('Unknown action — expected add, rename, delete, reorder, assign or move')
  }

  side.groupOrder = order
  await ensureAdminAuth()
  await saveSetRegistry(registry)
  invalidateSetsCache(game)

  return NextResponse.json({ ok: true, groupOrder: side.groupOrder, sets: sets.map((s) => ({ setName: s.setName, cardexGroup: s.cardexGroup })) })
}
