'use client'

import { useEffect, useRef, useState } from 'react'

// Phones only, once per visit: the doorway animation plays forwards (cards fly out) over the
// parchment with the TCGHaven wordmark below, then fades into the app (~1.3s; the app loads
// underneath meanwhile). The app shell is drawn only in the browser (app/layout.tsx), so before
// this mounts there's just the parchment — nothing flashes first. Skipped for reduced motion and
// on desktop. Frames: public/logo-sprite.webp, shown one exact frame at a time.
const SEEN = 'haven:intro'
const SPRITE = '/logo-sprite.webp'
const FRAMES = 21
const FRAME_MS = 33 // 30 fps, as rendered

export function SplashIntro() {
  const [phase, setPhase] = useState<'wait' | 'play' | 'out' | 'done'>('wait')
  const sprite = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let seen = false
    try { seen = !!sessionStorage.getItem(SEEN); sessionStorage.setItem(SEEN, '1') } catch { /* private mode */ }
    if (seen || window.matchMedia('(min-width: 768px), (prefers-reduced-motion: reduce)').matches) { setPhase('done'); return }
    let tick: ReturnType<typeof setInterval> | null = null
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    let started = false
    const play = () => {
      if (started) return
      started = true
      setPhase('play')
      // One exact frame at a time (0 → 20), then it holds on the last
      let frame = 0
      const show = () => { if (sprite.current) sprite.current.style.backgroundPosition = `${(frame / (FRAMES - 1)) * 100}% 0` }
      show()
      tick = setInterval(() => { frame++; show(); if (frame >= FRAMES - 1 && tick) clearInterval(tick) }, FRAME_MS)
      later(1000, () => setPhase('out')) // 0.7s of frames + a short hold on the last
      later(1300, () => setPhase('done'))
    }
    const img = new Image()
    img.onload = play
    img.src = SPRITE
    if (img.complete) play()
    // Slow connection: don't hold anyone up for a logo
    later(1500, () => { if (!started) { started = true; setPhase('out'); later(300, () => setPhase('done')) } })
    return () => { timers.forEach(clearTimeout); if (tick) clearInterval(tick) }
  }, [])
  if (phase === 'done') return null
  return (
    <div
      aria-hidden
      className={`md:hidden fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-[#d9c6a0] transition-opacity duration-300 ${phase === 'out' ? 'opacity-0 pointer-events-none' : ''}`}
    >
      <div
        ref={sprite}
        className="w-44 h-44 bg-no-repeat"
        style={{ backgroundImage: phase === 'wait' ? undefined : `url(${SPRITE})`, backgroundSize: `${FRAMES * 100}% 100%`, backgroundPosition: '0% 0' }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-text.png" alt="" className="w-56 h-auto object-contain" />
    </div>
  )
}
