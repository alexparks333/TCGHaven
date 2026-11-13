// A picture a creator uploads (Creator Studio, or posting on their own community page): shrunk to at most
// 2400px on its long side, then stored under their own folder, creators/{uid}/ (storage.rules).

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { appStorage } from './firebase/appStorage'

export async function shrinkPicture(file: File): Promise<Blob> {
  const img = await createImageBitmap(file).catch(() => null)
  if (!img) return file
  const k = Math.min(1, 2400 / Math.max(img.width, img.height))
  if (k === 1 && file.size < 6 * 1024 * 1024) return file
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return new Promise((res) => c.toBlob((b) => res(b ?? file), type, 0.9))
}

/** Upload one picture to creators/{uid}/{prefix}-{time}; its download URL */
export async function uploadCreatorPicture(uid: string, file: File, prefix = 'blk'): Promise<string> {
  const blob = await shrinkPicture(file)
  const r = ref(appStorage, `creators/${uid}/${prefix}-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`)
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' })
  return getDownloadURL(r)
}
