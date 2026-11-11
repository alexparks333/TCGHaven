/**
 * The scanner's picture index — fingerprints of every catalog card's photo, made by the trained
 * picture AI (tools/scanner-ai/), stored in Firebase Storage under catalog/scanner/ (public read,
 * staff write — storage.rules' catalog/{game}/{fileName}). The scan route searches it
 * (lib/scan/picture.ts); the iPhone app downloads the matching Core ML model listed in the same
 * manifest. Full write-up: docs/scanner-ai.md.
 *
 *   npm run scanner-index -- status
 *       What's published: model version, cards per catalog, and how many catalog cards are missing.
 *   npm run scanner-index -- publish <packed dir> [--model <CardFingerprint.mlpackage> --weights <model.pt> --version <name>]
 *       Uploads a full index made on the Mac (tools/scanner-ai/pack.py). With --model, a new
 *       model too — the index must have been made with that same model.
 *   npm run scanner-index -- publish-android <card-fingerprint.onnx>
 *       The same model for the Android app (tools/scanner-ai/convert_onnx.py), under the version
 *       already published — it must be made from the same .pt as that version's Core ML file.
 *   npm run scanner-index -- update [--max 3000]
 *       Fingerprints catalog cards that aren't in the index yet (new sets, photos that arrived
 *       later) and uploads the catalogs that changed. Needs Python with tools/scanner-ai's
 *       requirements; downloads the model's weights from the manifest. Run twice a day by
 *       .github/workflows/scanner-index.yml.
 *
 * Requires ADMIN_EMAIL/ADMIN_PASSWORD + NEXT_PUBLIC_FIREBASE_* (.env.local or the environment) for
 * uploads; `status` only reads.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function loadEnvLocal() {
  const p = new URL('../.env.local', import.meta.url)
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/\\\$/g, '$')
  }
}
loadEnvLocal()

// After the env: catalog-sync.mjs initializes Firebase from NEXT_PUBLIC_FIREBASE_* when imported
const { ensureSignedIn } = await import('./lib/catalog-sync.mjs')
const { getApps } = await import('firebase/app')
const { getFirestore } = await import('firebase/firestore')
const { getStorage, ref, uploadBytes } = await import('firebase/storage')
const { readCompressedSnapshot } = await import('./lib/snapshot-codec.mjs')

const app = getApps()[0]
const storage = getStorage(app)
const db = getFirestore(app)
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
const DIR = 'catalog/scanner'
const DIM = 384
// Every catalog the scanner searches (lib/scan/server.ts GAME_CATALOGS)
const CATALOGS = ['pokemon', 'pokemon-jp', 'lorcana', 'riftbound', 'onepiece', 'mtg', 'yugioh', 'swu', 'gundam', 'fab', 'digimon', 'palworld', 'cyberpunk']

const publicUrl = (name) => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`${DIR}/${name}`)}?alt=media`

async function download(name) {
  const res = await fetch(`${publicUrl(name)}&t=${Date.now()}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function readManifest() {
  const bytes = await download('manifest.json')
  return bytes ? JSON.parse(Buffer.from(bytes).toString('utf8')) : null
}

async function upload(name, bytes, contentType, immutable = false) {
  await ensureSignedIn()
  await uploadBytes(ref(storage, `${DIR}/${name}`), bytes, {
    contentType,
    cacheControl: immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  console.log(`   uploaded ${name} (${(bytes.length / 1048576).toFixed(1)} MB)`)
}

async function saveManifest(manifest) {
  manifest.updatedAt = new Date().toISOString()
  await upload('manifest.json', Buffer.from(JSON.stringify(manifest, null, 1)), 'application/json')
}

/** Visible catalog cards with a photo — what the index should hold */
async function catalogCards(catalog) {
  const snap = await readCompressedSnapshot(db, catalog)
  return (snap?.cards ?? []).filter((c) => !c.hidden && c.imageUrl)
}

const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

if (cmd === 'status') {
  const manifest = await readManifest()
  if (!manifest) { console.log('Nothing published yet.'); process.exit(0) }
  console.log(`Model ${manifest.version} · ${manifest.dim} numbers · updated ${manifest.updatedAt}`)
  for (const catalog of CATALOGS) {
    const entry = manifest.catalogs?.[catalog]
    const ids = new Set(entry ? JSON.parse(Buffer.from(await download(`index-${catalog}.json`)).toString('utf8')) : [])
    const cards = await catalogCards(catalog)
    const missing = cards.filter((c) => !ids.has(c.id)).length
    console.log(`  ${catalog.padEnd(11)} ${String(ids.size).padStart(7)} fingerprinted · ${String(missing).padStart(6)} catalog cards not yet`)
  }
  process.exit(0)
}

if (cmd === 'publish') {
  const dir = args[1]
  if (!dir || !fs.existsSync(dir)) throw new Error('publish <packed dir> — made by tools/scanner-ai/pack.py')
  const old = await readManifest()
  const modelDir = flag('--model'), weights = flag('--weights'), version = flag('--version')
  if (modelDir && (!weights || !version)) throw new Error('--model needs --weights and --version too')
  if (!modelDir && !old) throw new Error('Nothing published yet: the first publish needs --model, --weights and --version')
  const manifest = old ? { ...old, catalogs: { ...old.catalogs } } : { dim: DIM, scale: 384, catalogs: {} }
  if (modelDir) {
    // The Core ML package's files, each under one flat name (Storage's rule allows one level)
    const files = {}
    for (const rel of ['Manifest.json', 'Data/com.apple.CoreML/model.mlmodel', 'Data/com.apple.CoreML/weights/weight.bin']) {
      const name = `model-${version}-${path.basename(rel)}`
      await upload(name, fs.readFileSync(path.join(modelDir, rel)), 'application/octet-stream', true)
      files[rel] = name
    }
    const weightsName = `model-${version}.pt`
    await upload(weightsName, fs.readFileSync(weights), 'application/octet-stream', true)
    Object.assign(manifest, { version, model: { files }, weights: weightsName })
    // The Android copy belongs to the old version — publish-android the new one after this
    delete manifest.modelAndroid
    console.log('   (Android model cleared — run publish-android with this version\'s .onnx next)')
  }
  for (const catalog of CATALOGS) {
    const bin = path.join(dir, `index-${catalog}.bin`), ids = path.join(dir, `index-${catalog}.json`)
    if (!fs.existsSync(bin)) continue
    const count = JSON.parse(fs.readFileSync(ids, 'utf8')).length
    if (fs.statSync(bin).size !== count * DIM) throw new Error(`${catalog}: ${bin} doesn't hold ${count} × ${DIM} bytes`)
    // The fingerprints first, then the ids, then the manifest — a reader checks the sizes agree
    await upload(`index-${catalog}.bin`, fs.readFileSync(bin), 'application/octet-stream')
    await upload(`index-${catalog}.json`, fs.readFileSync(ids), 'application/json')
    manifest.catalogs[catalog] = { count, rev: Date.now() }
  }
  await saveManifest(manifest)
  console.log(`✅ Published ${manifest.version}: ${Object.entries(manifest.catalogs).map(([k, v]) => `${k} ${v.count}`).join(', ')}`)
  process.exit(0)
}

if (cmd === 'publish-android') {
  const file = args[1]
  if (!file || !fs.existsSync(file)) throw new Error('publish-android <card-fingerprint.onnx> — made by tools/scanner-ai/convert_onnx.py')
  const manifest = await readManifest()
  if (!manifest?.version) throw new Error('Publish the model and index first (publish … --model)')
  const name = `model-${manifest.version}-android.onnx`
  await upload(name, fs.readFileSync(file), 'application/octet-stream', true)
  manifest.modelAndroid = { file: name }
  await saveManifest(manifest)
  console.log(`✅ Android model published for ${manifest.version}`)
  process.exit(0)
}

if (cmd === 'update') {
  const max = Number(flag('--max') ?? 3000)
  const manifest = await readManifest()
  if (!manifest?.weights) throw new Error('Nothing published yet — publish a full index from the Mac first (docs/scanner-ai.md)')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-index-'))
  const current = {}
  const todo = []
  for (const catalog of CATALOGS) {
    const idsBytes = manifest.catalogs?.[catalog] ? await download(`index-${catalog}.json`) : null
    const ids = idsBytes ? JSON.parse(Buffer.from(idsBytes).toString('utf8')) : []
    current[catalog] = { ids }
    const have = new Set(ids)
    for (const c of await catalogCards(catalog)) if (!have.has(c.id)) todo.push({ key: `${catalog}:${c.id}`, url: c.imageUrl })
  }
  console.log(`📷 ${todo.length} catalog card(s) not fingerprinted yet${todo.length > max ? ` — doing the first ${max} this run` : ''}`)
  if (todo.length === 0) process.exit(0)
  const batch = todo.slice(0, max)
  fs.writeFileSync(path.join(work, 'todo.json'), JSON.stringify(batch))
  const weightsPath = path.join(work, 'model.pt')
  fs.writeFileSync(weightsPath, await download(manifest.weights))
  const python = process.env.PYTHON ?? 'python3'
  const run = spawnSync(python, ['-I', new URL('../tools/scanner-ai/fingerprint_new.py', import.meta.url).pathname, weightsPath, path.join(work, 'todo.json'), path.join(work, 'new.npz')], { stdio: 'inherit' })
  if (run.status !== 0) throw new Error('fingerprinting failed')
  // The .npz back as plain files (keys + int8 rows) — a tiny Python step keeps Node free of numpy parsing
  const conv = spawnSync(python, ['-I', '-c', `import numpy as np,sys,json;d=np.load(sys.argv[1]);json.dump([str(k) for k in d['keys']],open(sys.argv[2],'w'));d['vecs'].astype(np.int8).tofile(sys.argv[3])`, path.join(work, 'new.npz'), path.join(work, 'new.json'), path.join(work, 'new.bin')], { stdio: 'inherit' })
  if (conv.status !== 0) throw new Error('reading the fingerprints failed')
  const keys = JSON.parse(fs.readFileSync(path.join(work, 'new.json'), 'utf8'))
  const vecs = fs.readFileSync(path.join(work, 'new.bin'))
  // (cards whose photo link is broken stay "not yet" and are tried again next run)
  if (keys.length === 0) { console.log('Nothing new could be fingerprinted (photos missing or broken)'); process.exit(0) }
  const added = {}
  keys.forEach((key, i) => {
    const at = key.indexOf(':'), catalog = key.slice(0, at)
    ;(added[catalog] ??= []).push({ id: key.slice(at + 1), row: vecs.subarray(i * DIM, (i + 1) * DIM) })
  })
  for (const [catalog, rows] of Object.entries(added)) {
    const oldBin = current[catalog].ids.length ? await download(`index-${catalog}.bin`) : new Uint8Array(0)
    if (oldBin.length !== current[catalog].ids.length * DIM) throw new Error(`${catalog}: published index is inconsistent — re-publish it from the Mac`)
    const bin = Buffer.concat([Buffer.from(oldBin), ...rows.map((r) => Buffer.from(r.row))])
    const ids = [...current[catalog].ids, ...rows.map((r) => r.id)]
    await upload(`index-${catalog}.bin`, bin, 'application/octet-stream')
    await upload(`index-${catalog}.json`, Buffer.from(JSON.stringify(ids)), 'application/json')
    manifest.catalogs[catalog] = { count: ids.length, rev: Date.now() }
    console.log(`   ${catalog}: +${rows.length} → ${ids.length}`)
  }
  await saveManifest(manifest)
  console.log(`✅ Added ${keys.length} fingerprint(s)`)
  process.exit(0)
}

console.error('Usage: npm run scanner-index -- status | publish <dir> [--model … --weights … --version …] | publish-android <onnx> | update [--max N]')
process.exit(1)
