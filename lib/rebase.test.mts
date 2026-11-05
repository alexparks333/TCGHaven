// npm run test:rebase — two staff saving at once must never undo each other (lib/rebase.ts)
import assert from 'node:assert/strict'
import { rebaseList, mergeEdit, sameValue } from './rebase.ts'

type Item = { id: string; v: number }
const ids = (l: Item[]) => l.map((x) => `${x.id}${x.v}`).join(' ')
const L = (s: string): Item[] => s.split(' ').map((t) => ({ id: t[0], v: Number(t.slice(1)) }))
let n = 0
const check = (name: string, got: Item[], want: string) => { assert.equal(ids(got), want, name); n++ }

const base = L('a0 b0 c0')
check('nobody else saved → mine as-is', rebaseList(base, L('a0 b1 c0'), base, (x) => x.id), 'a0 b1 c0')
check('they edited another item → both edits', rebaseList(base, L('a1 b0 c0'), L('a0 b0 c2'), (x) => x.id), 'a1 b0 c2')
check('they added an item → kept, in their spot', rebaseList(base, L('a1 b0 c0'), L('a0 x0 b0 c0'), (x) => x.id), 'a1 x0 b0 c0')
check('I added, they added → both', rebaseList(base, L('a0 b0 y0 c0'), L('a0 b0 c0 x0'), (x) => x.id), 'a0 b0 y0 c0 x0')
check('they deleted one I left alone → stays deleted', rebaseList(base, L('a1 b0 c0'), L('a0 c0'), (x) => x.id), 'a1 c0')
check('I deleted one → deleted, their edit elsewhere kept', rebaseList(base, L('a0 c0'), L('a0 b0 c3'), (x) => x.id), 'a0 c3')
check('I edited one they deleted → mine comes back', rebaseList(base, L('a0 b5 c0'), L('a0 c0'), (x) => x.id), 'a0 b5 c0')
check('I reordered, they added → my order + their new one', rebaseList(base, L('c0 a0 b0'), L('a0 b0 x0 c0'), (x) => x.id), 'c0 a0 b0 x0')
check('they reordered, I edited → their order + my edit', rebaseList(base, L('a0 b1 c0'), L('c0 b0 a0'), (x) => x.id), 'c0 b1 a0')
check('both edited the same item → mine', rebaseList(base, L('a0 b1 c0'), L('a0 b2 c0'), (x) => x.id), 'a0 b1 c0')

// One record edited in a form
{
  const opened = { name: 'Pin', art: 'old.png', tiers: [75, 90] }
  const mine = { name: 'Pin (renamed)', art: 'old.png', tiers: [75, 90] }
  const theirs = { name: 'Pin', art: 'new.png', tiers: [75, 90] }
  const { merged, clashes } = mergeEdit(opened, mine, theirs)
  assert.deepEqual(merged, { name: 'Pin (renamed)', art: 'new.png', tiers: [75, 90] }, 'different fields → both land'); n++
  assert.deepEqual(clashes, []); n++
  const r2 = mergeEdit(opened, mine, { ...theirs, name: 'Pin (theirs)' })
  assert.deepEqual(r2.clashes, ['name'], 'same field changed both ways → a clash to ask about'); n++
  const r3 = mergeEdit(opened, { ...opened, art: undefined } as typeof opened, theirs)
  assert.equal('art' in r3.merged, false, 'a field I cleared is cleared'); n++
}
assert.ok(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1, d: undefined })); n++

console.log(`✓ ${n} rebase checks passed`)
