'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

// The desktop sidebar's logo: goes home, and while hovered plays the doorway from the last frame
// back to the first and forwards again (20 → 0 → 20), a short rest, on loop. Driven frame by frame from here —
// one exact frame of public/logo-sprite-sm.webp at a time (21 frames side by side), never a slide
// between two. Built by scripts/logo-animation.mjs.
const FRAMES = 21
const FRAME_MS = 33 // 30 fps, as rendered
const HOLD = 5 // frames it rests on the last frame between loops

export function LogoHover() {
  const sprite = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const show = (frame: number) => {
    if (sprite.current) sprite.current.style.backgroundPosition = `${(frame / (FRAMES - 1)) * 100}% 0`
  }
  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    show(FRAMES - 1)
  }
  const start = () => {
    if (timer.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // 20 → 0 → 20, then rests on the last frame for HOLD frames before going again
    let frame = FRAMES - 1, step = -1, rest = 0
    timer.current = setInterval(() => {
      if (rest > 0) { rest--; return }
      if (frame + step < 0) step = 1
      frame += step
      show(frame)
      if (frame === FRAMES - 1) { rest = HOLD; step = -1 }
    }, FRAME_MS)
  }
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])
  return (
    <Link
      href="/"
      onMouseEnter={start} onMouseLeave={stop} onFocus={start} onBlur={stop}
      className="flex items-center gap-1.5 px-1 mb-6 rounded-xl"
      aria-label="TCGHaven — home"
    >
      <span
        ref={sprite}
        className="w-[4.5rem] h-[4.5rem] shrink-0 bg-no-repeat"
        style={{ backgroundImage: 'url(/logo-sprite-sm.webp)', backgroundSize: `${FRAMES * 100}% 100%`, backgroundPosition: '100% 0' }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-text.png" alt="" className="min-w-0 flex-1 h-auto object-contain" />
    </Link>
  )
}
