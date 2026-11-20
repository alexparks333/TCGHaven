'use client'

import { useEffect, useRef } from 'react'

// The doorway logo, animated frame by frame from a strip of its 21 frames (built by
// scripts/logo-animation.mjs): while `playing`, it goes from the last frame (cards out — the
// still logo) back to the shut door and forwards again (20 → 0 → 20), rests `hold` frames on the
// last frame, and loops. One exact frame at a time — never a slide between two. Not playing (or
// reduced motion) = the last frame. Used by the sidebar logo's hover and the sign-in pages.
const FRAMES = 21
const FRAME_MS = 33 // 30 fps, as rendered

export function LogoFrames({
  playing, hold = 5, sprite = '/logo-sprite-sm.webp', className = '',
}: { playing: boolean; hold?: number; sprite?: string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const show = (frame: number) => {
      if (el.current) el.current.style.backgroundPosition = `${(frame / (FRAMES - 1)) * 100}% 0`
    }
    if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { show(FRAMES - 1); return }
    let frame = FRAMES - 1, step = -1, rest = 0
    const timer = setInterval(() => {
      if (rest > 0) { rest--; return }
      if (frame + step < 0) step = 1
      frame += step
      show(frame)
      if (frame === FRAMES - 1) { rest = hold; step = -1 }
    }, FRAME_MS)
    return () => { clearInterval(timer); show(FRAMES - 1) }
  }, [playing, hold])
  return (
    <span
      ref={el}
      aria-hidden
      className={`block bg-no-repeat ${className}`}
      style={{ backgroundImage: `url(${sprite})`, backgroundSize: `${FRAMES * 100}% 100%`, backgroundPosition: '100% 0' }}
    />
  )
}
