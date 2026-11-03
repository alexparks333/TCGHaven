import { NextResponse } from 'next/server'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase/config'
import { invalidateRegistryCache, loadSetRegistry, saveSetRegistry, type RiftboundPlacement } from '@/lib/api/registry'
import { loadCatalog, invalidateCatalogCache } from '@/lib/api/catalog'
import { ensureAdminAuth } from '@/lib/firebase/adminAuth'
import { verifyAdminRequest } from '@/lib/firebase/verifyAdminRequest'

export const dynamic = 'force-dynamic'

// Staff review of the TCGplayer products a Riftbound sync placed on its own (Needs Review page) —
// see discoverRiftboundProducts() in scripts/lib/catalog-sync.mjs.
//
// POST { changes: [{ productId, setName?, reviewed?, denied?, displayName? }] }
//   setName      — move the card to that set
//   denied       — true: hide it and never add it back on a sync; false: recover it (into setName
//                  if given, else where it was before it was denied), back in the review queue
//   ignored      — true: not sure yet — hidden for now, offered again by the next sync (in that
//                  sync's batch); false: undo that. Accepting / moving / denying clears it.
//   displayName  — the name the website shows ('' = back to the name built from TCGplayer's)
//   image        — 'tcgplayer' | 'riot' | 'none' | 'auto' (TCGplayer's photo if any, else Riot's)
//   reviewed     — mark checked
// Every change applies to the catalog card (`tcg-{productId}`) right away, so it doesn't wait for
// the next sync, which then keeps it.

// Same naming as placementDefaultName() in catalog-sync.mjs (duplicated across the runtime
// boundary on purpose, like the other shared helpers there).
function defaultName(tcgplayerName: string): string {
  const base = tcgplayerName.replace(/\s*\([^)]*\)/g, '').trim()
  const parens = Array.from(tcgplayerName.matchAll(/\(([^)]*)\)/g)).map((m) => m[1].trim()).filter(Boolean)
  return `${base} (${parens.join(', ') || 'Promo'})`
}

interface Change {
  productId: number
  setName?: string | null
  reviewed?: boolean
  denied?: boolean
  ignored?: boolean
  displayName?: string
  image?: 'tcgplayer' | 'riot' | 'none' | 'auto'
}

const tcgPhotoUrl = (productId: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`

// TCGplayer's photo for a product, or '' if it hasn't photographed it (the URL 403s).
async function tcgPhotoIfAny(productId: number): Promise<string> {
  try {
    const res = await fetch(tcgPhotoUrl(productId), { method: 'HEAD', headers: { 'User-Agent': 'TCGHaven/1.0' } })
    return res.ok ? tcgPhotoUrl(productId) : ''
  } catch {
    return ''
  }
}

// Riot's gallery art for the card a placement is a printing of: same collector code ("013/298").
async function riotArt(publicCode: string | undefined): Promise<string> {
  const code = (publicCode ?? '').split('-').slice(1).join('-')
  if (!code) return ''
  const all = await loadCatalog<{ id: string; publicCode?: string; imageUrl?: string }>('riftbound')
  return all.find((c) => !c.id.startsWith('tcg-') && (c.publicCode ?? '').split('-').slice(1).join('-') === code)?.imageUrl ?? ''
}

export async function POST(request: Request) {
  const unauthorized = await verifyAdminRequest(request)
  if (unauthorized) return unauthorized

  const body = await request.json().catch(() => null)
  const changes = Array.isArray(body?.changes) ? (body.changes as Change[]) : null
  if (!changes || changes.some((c) => typeof c?.productId !== 'number')) {
    return NextResponse.json({ error: 'Expected { changes: [{ productId: number, setName?, reviewed?, denied?, displayName? }] }' }, { status: 400 })
  }

  invalidateRegistryCache() // read-modify-write: never from a stale copy (a sync on another process may have changed it)
  const registry = await loadSetRegistry()
  const placements = registry.riftbound.placements ?? []
  const setByName = new Map(registry.riftbound.sets.map((s) => [s.setName, s]))
  const touched = new Map<number, { placement: RiftboundPlacement; moved: boolean; renamed: boolean; image: Change['image'] }>()
  const mark = (p: RiftboundPlacement, what: 'moved' | 'renamed') => {
    const t = touched.get(p.productId) ?? { placement: p, moved: false, renamed: false, image: undefined }
    t[what] = true
    touched.set(p.productId, t)
  }

  for (const change of changes) {
    const p = placements.find((x) => x.productId === change.productId)
    if (!p) return NextResponse.json({ error: `No placement for TCGplayer product ${change.productId}` }, { status: 404 })
    if (typeof change.setName === 'string' && !setByName.has(change.setName)) {
      return NextResponse.json({ error: `No Riftbound set named "${change.setName}"` }, { status: 404 })
    }

    if (change.ignored === true && !p.ignored) {
      p.ignored = true
      p.reviewed = false
      mark(p, 'moved')
    } else if (p.ignored && (change.ignored === false || change.reviewed === true || change.setName !== undefined || change.denied !== undefined)) {
      p.ignored = false
      mark(p, 'moved')
    }

    if (change.denied === true && !p.denied) {
      p.previousSetName = p.setName
      p.setName = null
      p.denied = true
      p.reviewed = true
      p.auto = false
      mark(p, 'moved')
    } else if (change.denied === false && (p.denied || p.setName === null)) {
      // (setName null without `denied` = left out before Deny existed, or the sync couldn't place it)
      p.denied = false
      p.setName = change.setName !== undefined ? change.setName : p.previousSetName ?? null
      delete p.previousSetName
      p.reviewed = false
      p.auto = false
      mark(p, 'moved')
    } else if (change.setName !== undefined && change.setName !== p.setName) {
      p.setName = change.setName
      p.denied = false
      p.auto = false
      mark(p, 'moved')
    }

    if (change.displayName !== undefined) {
      const name = change.displayName.trim()
      if (name && name !== defaultName(p.name)) p.displayName = name
      else delete p.displayName
      mark(p, 'renamed')
    }
    if (change.image !== undefined) {
      if (change.image === 'auto') delete p.image
      else p.image = change.image
      const t = touched.get(p.productId) ?? { placement: p, moved: false, renamed: false, image: undefined }
      t.image = change.image
      touched.set(p.productId, t)
    }
    if (change.reviewed !== undefined) p.reviewed = change.reviewed
  }
  registry.riftbound.placements = placements

  await ensureAdminAuth()
  await saveSetRegistry(registry)

  // Apply to the catalog cards now. One the sync hasn't built yet is created by the next sync.
  let changedCards = 0
  const images: Record<number, string> = {}
  for (const { placement: p, moved, renamed, image } of Array.from(touched.values())) {
    const ref = doc(db, 'catalog', 'riftbound', 'cards', `tcg-${p.productId}`)
    const snap = await getDoc(ref)
    if (!snap.exists()) continue
    const set = p.setName ? setByName.get(p.setName) : null
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }
    if (moved) {
      if (set && !p.ignored) Object.assign(patch, { setName: set.setName, setCode: set.setCode, hidden: false, rarity: set.tcgplayerOnly ? set.tcgplayerRarity || 'Event Promo' : 'Promo' })
      else patch.hidden = true
    }
    if (renamed) patch.name = p.displayName ?? defaultName(p.name)
    if (image !== undefined) {
      const publicCode = snap.data().publicCode as string | undefined
      patch.imageUrl = image === 'none' ? ''
        : image === 'tcgplayer' ? await tcgPhotoIfAny(p.productId)
        : image === 'riot' ? await riotArt(publicCode)
        : (await tcgPhotoIfAny(p.productId)) || (await riotArt(publicCode))
      images[p.productId] = patch.imageUrl as string
    }
    await updateDoc(ref, patch)
    changedCards++
  }
  // No snapshot rebuild here (it reads every card — that's what made each click take seconds):
  // the edits carry updatedAt, so every server's catalog cache picks them up through its normal
  // delta pull; this server's is just dropped so it reloads now. The next sync rewrites the snapshot.
  if (changedCards > 0) invalidateCatalogCache('riftbound')

  return NextResponse.json({ ok: true, placements, changedCards, images })
}
