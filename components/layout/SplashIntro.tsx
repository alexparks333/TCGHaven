'use client'

import { useEffect, useState } from 'react'

// Phones only, once per visit: the doorway animation plays forwards (cards fly out) over the
// parchment with the TCGHaven wordmark below, then fades into the app (~1.3s; the app loads
// underneath meanwhile). The app shell is drawn only in the browser (app/layout.tsx), so before
// this mounts there's just the parchment — nothing flashes first. Skipped for reduced motion and
// on desktop (md:hidden). Frames: public/logo-sprite.webp.
const SEEN = 'haven:intro'
const SPRITE = '/logo-sprite.webp'

export function SplashIntro() {
  const [phase, setPhase] = useState<'wait' | 'play' | 'out' | 'done'>('wait')
  useEffect(() => {
    let seen = false
    try { seen = !!sessionStorage.getItem(SEEN); sessionStorage.setItem(SEEN, '1') } catch { /* private mode */ }
    if (seen || window.matchMedia('(min-width: 768px), (prefers-reduced-motion: reduce)').matches) { setPhase('done'); return }
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    let started = false
    const play = () => {
      if (started) return
      started = true
      setPhase('play')
      later(1000, () => setPhase('out')) // 0.7s of frames + a short hold on the last
      later(1300, () => setPhase('done'))
    }
    const img = new Image()
    img.onload = play
    img.src = SPRITE
    if (img.complete) play()
    // Slow connection: don't hold anyone up for a logo
    later(1500, () => { if (!started) { started = true; setPhase('out'); later(300, () => setPhase('done')) } })
    return () => timers.forEach(clearTimeout)
  }, [])
  if (phase === 'done') return null
  return (
    <div
      aria-hidden
      className={`splash-intro md:hidden fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-[#d9c6a0] transition-opacity duration-300 ${phase === 'out' ? 'opacity-0 pointer-events-none' : ''}`}
    >
      <div className={`logo-sprite logo-intro w-44 h-44 ${phase === 'play' || phase === 'out' ? 'play' : ''}`} style={{ backgroundImage: `url(${SPRITE})` }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-text.png" alt="" className="w-56 h-auto object-contain" />
    </div>
  )
}
