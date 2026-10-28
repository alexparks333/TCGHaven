// Compress a 3D pin model in the browser before it's uploaded (staff portal Badges page — later the
// Creators flow). Raw Meshy GLBs are 30–120MB; Storage caps badge files at 25MB and every viewer
// downloads the file. This keeps the exact mesh (no simplifying) and does what
// `npm run optimize-pin` does: dedupe/weld, meshopt-compressed geometry, WebP textures (≤2048px).
// Loaded on demand (dynamic imports), so the libraries only download when a model is picked.

export type CompressStep = 'reading' | 'mesh' | 'textures' | 'packing'

const MAX_TEXTURE = 2048

export async function compressPinModel(file: Blob, onStep?: (step: CompressStep) => void): Promise<Blob> {
  const [{ WebIO }, { ALL_EXTENSIONS, EXTTextureWebP }, { dedup, weld, prune, meshopt }, { MeshoptEncoder, MeshoptDecoder }] = await Promise.all([
    import('@gltf-transform/core'),
    import('@gltf-transform/extensions'),
    import('@gltf-transform/functions'),
    import('meshoptimizer'),
  ])
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

  onStep?.('reading')
  const doc = await io.readBinary(new Uint8Array(await file.arrayBuffer()))

  onStep?.('mesh')
  await doc.transform(dedup(), weld(), prune())

  onStep?.('textures')
  let webp = false
  for (const tex of doc.getRoot().listTextures()) {
    const data = tex.getImage(), type = tex.getMimeType()
    if (!data || !/png|jpe?g/.test(type)) continue
    const bitmap = await createImageBitmap(new Blob([data as BlobPart], { type }))
    const k = Math.min(1, MAX_TEXTURE / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * k), Math.round(bitmap.height * k))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
    if (out.type !== 'image/webp' || out.size >= data.byteLength) continue // no WebP encoder, or no gain
    tex.setImage(new Uint8Array(await out.arrayBuffer())).setMimeType('image/webp')
    if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(png|jpe?g)$/i, '.webp'))
    webp = true
  }
  if (webp) doc.createExtension(EXTTextureWebP).setRequired(true)

  onStep?.('packing')
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const bytes = await io.writeBinary(doc)
  return new Blob([bytes as BlobPart], { type: 'model/gltf-binary' })
}
