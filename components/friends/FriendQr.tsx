'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { Camera, ImageUp, Loader2, ScanLine, X } from 'lucide-react'

// Friend QR codes. Your code is just your invite link (/invite/{code}), so scanning it does
// exactly what opening the link does: you're friends instantly. A profile link (/u/{username})
// scans too and opens their profile.

// The page a scanned code should open, or null if it isn't one of ours. Only the path is used,
// so a code made on another copy of the site (e.g. the live one) still works here.
export function friendCodePath(text: string): string | null {
  let url: URL
  try { url = new URL(text.trim(), window.location.origin) } catch { return null }
  const m = url.pathname.match(/^\/(invite|u)\/([A-Za-z0-9_.-]{3,64})\/?$/)
  return m ? `/${m[1]}/${m[2]}` : null
}

export function InviteQrCode({ link, size = 200 }: { link: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !link) return
    // Always dark-on-white with a quiet zone, whatever the theme — cameras need the contrast.
    QRCode.toCanvas(ref.current, link, { width: size, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } })
      .catch((e: unknown) => console.error(e))
  }, [link, size])
  return <canvas ref={ref} width={size} height={size} className="rounded-xl bg-white" aria-label="Your friend QR code" />
}

// "Scan a friend's code": a button that opens the camera. Falls back to reading a photo when
// there's no camera access (blocked permission, or a page not served over HTTPS).
export function ScanFriendCode({ onFound }: { onFound?: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  function found(path: string) {
    setOpen(false)
    onFound?.()
    router.push(path)
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary w-full justify-center">
        <ScanLine size={15} />Scan a friend&rsquo;s code
      </button>
      {open && <Scanner onFound={found} onClose={() => setOpen(false)} />}
    </>
  )
}

function Scanner({ onFound, onClose }: { onFound: (path: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'no-camera'>('starting')
  const [message, setMessage] = useState('')
  const onFoundRef = useRef(onFound)
  onFoundRef.current = onFound

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let live = true
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    function tick() {
      const video = videoRef.current
      if (!live || !video || !ctx) return
      if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth) {
        // Decode a downscaled frame — plenty for a QR code, and much faster on phones.
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
        if (hit?.data) {
          const path = friendCodePath(hit.data)
          if (path) { onFoundRef.current(path); return }
          setMessage('That isn’t a TCGHaven friend code.')
        }
      }
      timer = setTimeout(tick, 150)
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('no-camera')
    } else {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(async (s) => {
          if (!live) { s.getTracks().forEach((t) => t.stop()); return }
          stream = s
          const video = videoRef.current
          if (!video) return
          video.srcObject = s
          await video.play().catch(() => {})
          setStatus('scanning')
          tick()
        })
        .catch(() => { if (live) setStatus('no-camera') })
    }

    return () => {
      live = false
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function readPhoto(file: File) {
    setMessage('')
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
      const path = hit?.data ? friendCodePath(hit.data) : null
      if (path) onFound(path)
      else setMessage(hit?.data ? 'That isn’t a TCGHaven friend code.' : 'Couldn’t find a QR code in that photo — try again closer up.')
    } catch (e) {
      console.error(e)
      setMessage('Couldn’t read that photo.')
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-sm card-glass bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-bold text-ink"><ScanLine size={16} className="text-violet-600" />Scan a friend&rsquo;s code</div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-ink"><X size={16} /></button>
        </div>

        {status !== 'no-camera' ? (
          <div className="relative aspect-square overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            {status === 'starting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-300">
                <Loader2 size={22} className="animate-spin" />Starting camera…
              </div>
            )}
            {/* Aiming frame */}
            <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        ) : (
          <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 px-6 text-center">
            <Camera size={26} className="text-slate-500" />
            <div className="text-sm font-semibold text-ink">Camera isn&rsquo;t available</div>
            <div className="text-xs text-slate-500">Allow camera access for this site, or take a photo of your friend&rsquo;s code instead.</div>
          </div>
        )}

        <p className="mt-3 min-h-[1rem] text-center text-xs text-slate-500">
          {message || (status === 'scanning' ? 'Point your camera at your friend’s QR code.' : '')}
        </p>

        <button onClick={() => fileRef.current?.click()} className="btn-secondary w-full justify-center mt-2">
          <ImageUp size={15} />Use a photo instead
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readPhoto(f) }}
        />
      </div>
    </div>
  )
}
