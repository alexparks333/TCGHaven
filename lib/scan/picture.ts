// The scanner's picture search: the phone sends a fingerprint of the scanned card (384 numbers from
// the trained picture AI — ios/App/App/CardScanner.swift CardFingerprinter; no photo leaves the
// phone), and this finds the catalog cards whose photos look most like it. The fingerprints of
// every catalog card live in Firebase Storage (catalog/scanner/, written by
// scripts/scanner-index.mjs) and are kept in memory per server process. Docs: docs/scanner-ai.md.

import type { ScanCatalogKey } from './scanMatch'

const DIM = 384
// Stored as int8 = value × INT8_SCALE (tools/scanner-ai/common.py SCALE — keep the two in step)
const INT8_SCALE = 384
// How long a loaded catalog index is trusted before the manifest is checked again
const RECHECK_MS = 30 * 60 * 1000

export interface PictureManifest {
  version: string
  dim: number
  scale: number
  model: { files: Record<string, string> }
  catalogs: Record<string, { count: number; rev: number }>
  updatedAt: string
}

interface CatalogIndex { rev: number; ids: string[]; vecs: Int8Array; pos: Map<string, number> }

const DIR = 'catalog/scanner'
function storageUrl(name: string): string {
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`${DIR}/${name}`)}?alt=media`
}

let manifestCache: { at: number; manifest: PictureManifest | null } | null = null
let manifestLoading: Promise<PictureManifest | null> | null = null

export async function pictureManifest(): Promise<PictureManifest | null> {
  if (manifestCache && Date.now() - manifestCache.at < RECHECK_MS) return manifestCache.manifest
  manifestLoading ??= (async () => {
    try {
      const res = await fetch(storageUrl('manifest.json'), { cache: 'no-store' })
      const manifest = res.ok ? ((await res.json()) as PictureManifest) : null
      manifestCache = { at: Date.now(), manifest: manifest ?? manifestCache?.manifest ?? null }
    } catch {
      manifestCache = { at: Date.now() - RECHECK_MS + 60_000, manifest: manifestCache?.manifest ?? null } // retry in a minute
    } finally {
      manifestLoading = null
    }
    return manifestCache!.manifest
  })()
  return manifestLoading
}

/** Where the phone downloads the Core ML model from: its version, and each file's public URL */
export async function pictureModel(): Promise<{ version: string; files: Record<string, string> } | null> {
  const m = await pictureManifest()
  if (!m?.model?.files) return null
  return { version: m.version, files: Object.fromEntries(Object.entries(m.model.files).map(([rel, name]) => [rel, storageUrl(name)])) }
}

const indexes = new Map<string, CatalogIndex>()
const loading = new Map<string, Promise<CatalogIndex | null>>()

async function catalogIndex(catalog: ScanCatalogKey): Promise<CatalogIndex | null> {
  const manifest = await pictureManifest()
  const entry = manifest?.catalogs?.[catalog]
  if (!manifest || !entry || manifest.dim !== DIM) return null
  const have = indexes.get(catalog)
  if (have && have.rev === entry.rev) return have
  const key = `${catalog}:${entry.rev}`
  if (!loading.has(key)) {
    loading.set(key, (async () => {
      try {
        const [bin, ids] = await Promise.all([
          fetch(`${storageUrl(`index-${catalog}.bin`)}&rev=${entry.rev}`, { cache: 'no-store' }).then((r) => (r.ok ? r.arrayBuffer() : null)),
          fetch(`${storageUrl(`index-${catalog}.json`)}&rev=${entry.rev}`, { cache: 'no-store' }).then((r) => (r.ok ? (r.json() as Promise<string[]>) : null)),
        ])
        // Caught mid-update (fingerprints and ids from different runs): keep what we had
        if (!bin || !ids || bin.byteLength !== ids.length * DIM) return have ?? null
        const idx: CatalogIndex = { rev: entry.rev, ids, vecs: new Int8Array(bin), pos: new Map(ids.map((id, i) => [id, i])) }
        indexes.set(catalog, idx)
        return idx
      } catch {
        return have ?? null
      } finally {
        loading.delete(key)
      }
    })())
  }
  return loading.get(key)!
}

/** Loads the picture indexes as the scanner opens, so the first card doesn't wait for them */
export async function warmPictures(catalogs: ScanCatalogKey[]): Promise<void> {
  await Promise.all(catalogs.map((c) => catalogIndex(c).catch(() => null)))
}

/** A fingerprint from the phone: 384 finite numbers, unit length (re-normalised here) */
export function cleanFingerprints(raw: unknown): Float32Array[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 3).flatMap((f) => {
    if (!Array.isArray(f) || f.length !== DIM) return []
    const v = new Float32Array(DIM)
    let n = 0
    for (let i = 0; i < DIM; i++) {
      const x = Number(f[i])
      if (!isFinite(x)) return []
      v[i] = x
      n += x * x
    }
    if (n < 1e-6) return []
    const k = 1 / Math.sqrt(n) / INT8_SCALE // folds the int8 scale in: dot product = cosine similarity
    for (let i = 0; i < DIM; i++) v[i] *= k
    return [v]
  })
}

function dot(q: Float32Array, vecs: Int8Array, row: number): number {
  let s = 0
  const o = row * DIM
  for (let i = 0; i < DIM; i++) s += q[i] * vecs[o + i]
  return s
}

export interface PictureHit { catalog: ScanCatalogKey; id: string; similarity: number }

/** Similarity (cosine, −1…1; a right card scores ~0.5–0.9 on a real scan) of the scan to each card,
 *  the best over the fingerprints sent (a landscape card comes in each turn). null = not indexed. */
export async function pictureSimilarity(fps: Float32Array[], cards: Array<{ catalog: ScanCatalogKey; id: string }>): Promise<Array<number | null>> {
  if (!fps.length) return cards.map(() => null)
  const byCat = new Map<ScanCatalogKey, CatalogIndex | null>()
  for (const c of cards) if (!byCat.has(c.catalog)) byCat.set(c.catalog, await catalogIndex(c.catalog))
  return cards.map((c) => {
    const idx = byCat.get(c.catalog)
    const row = idx?.pos.get(c.id)
    if (!idx || row === undefined) return null
    return Math.max(...fps.map((q) => dot(q, idx.vecs, row)))
  })
}

/** The catalog cards that look most like the scan, best first */
export async function pictureSearch(fps: Float32Array[], catalogs: ScanCatalogKey[], k = 8): Promise<PictureHit[]> {
  if (!fps.length) return []
  const top: PictureHit[] = []
  let floor = -Infinity
  for (const catalog of catalogs) {
    const idx = await catalogIndex(catalog)
    if (!idx) continue
    const n = idx.ids.length
    for (let row = 0; row < n; row++) {
      let s = -Infinity
      for (const q of fps) { const d = dot(q, idx.vecs, row); if (d > s) s = d }
      if (s <= floor) continue
      top.push({ catalog, id: idx.ids[row], similarity: s })
      if (top.length > k * 4) {
        top.sort((a, b) => b.similarity - a.similarity)
        top.length = k
        floor = top[k - 1].similarity
      }
    }
  }
  return top.sort((a, b) => b.similarity - a.similarity).slice(0, k)
}
