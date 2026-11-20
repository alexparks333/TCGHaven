'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import { signedInOnlyPath } from './Sidebar'
import { hideLaunchScreen } from '@/lib/nativeApp'

// Phones only, once per visit — a splash screen, not a loader: the big doorway animation plays all
// the way through (cards fly out) over the parchment with the TCGHaven wordmark below, rests on its
// last frame for a moment, then fades into the app — Sign In for someone signed out, their
// collection otherwise (it waits on past that only if the app underneath isn't ready yet). Skipped
// for reduced motion and on desktop. Frames: public/logo-splash.webp (preloaded in app/layout.tsx),
// a 7 × 3 grid of 720px frames on the splash's own tan.
//
// The frames are played by the browser's compositor, not stepped from JavaScript: each frame is its
// own layer, faded in over the one before in its slot by a CSS animation (.splash-frame, globals.css). Stepped by a
// timer, a frame came late whenever the app underneath was busy loading (the same moment every
// time), and the old one-row strip (15,120px wide) was cut into tiles by iPhone Safari — the splash
// stuttered at the same spot on every start (2026-11-20).
//
// 2026-11-20 (iPhone app start-up): it used to give the frames 1.5s to arrive and then skip
// straight to the page, showed the wordmark alone while waiting, and faded out on a timer — so a
// slow start went parchment → half a logo → the plain loader → Sign In. Now: nothing but parchment
// until the frames are in, and no fade until the page underneath is the real one.
const SEEN = 'haven:intro'
const SPRITE = '/logo-splash.webp' // 720px frames — sharp at this size on a 3× iPhone screen (scripts/logo-animation.mjs)
const FRAMES = 21
const COLS = 7, ROWS = 3 // the grid the frames are laid out in
const FRAME_MS = 33 // 30 fps, as rendered
const PLAY_MS = FRAMES * FRAME_MS + 60 // every frame, the last one included
const REST_MS = 800 // on the finished logo before the fade (2s felt frozen — 2026-11-20)
const WAIT_FOR_FRAMES_MS = 3000 // a very slow connection: give up on the animation, not on the hold
const HOLD_MAX_MS = 6000 // never keep anyone on the logo longer than this from opening
const FADE_IN_MS = 350 // the logo fades in on its first frame, then plays
// The app's own launch screen (iPhone / Android) must be gone before the fade-in starts, or the
// fade plays hidden behind it: lib/nativeApp.ts hideLaunchScreen() resolves once it is
const FADE_MS = 300

// Decided once per page load, not per effect run: React runs effects twice in development, and
// the second run read the "seen" mark the first had just written — the splash vanished on the dev
// build (2026-11-20). The live site runs it once, but either way the answer must not change.
let playThisLoad: boolean | null = null
function shouldPlay(): boolean {
  if (playThisLoad === null) {
    let seen = false
    try { seen = !!sessionStorage.getItem(SEEN); sessionStorage.setItem(SEEN, '1') } catch { /* private mode */ }
    playThisLoad = !seen && !window.matchMedia('(min-width: 768px), (prefers-reduced-motion: reduce)').matches
  }
  return playThisLoad
}

export function SplashIntro() {
  // wait (parchment) → in (fades in on frame 0) → play (the frames) → rest (a moment on the last) →
  // hold (only if the app isn't ready) → out → done
  const [phase, setPhase] = useState<'wait' | 'in' | 'play' | 'rest' | 'hold' | 'out' | 'done'>('wait')
  const [maxed, setMaxed] = useState(false)

  // Where the app is heading is known once sign-in is known — and, for a signed-out visitor on a
  // sign-in-only page, once AuthGuard has moved them on to Sign In
  const { user, loading, dataLoading } = useAuth()
  const pathname = usePathname() ?? '/'
  const ready = !loading && (user ? !dataLoading : !signedInOnlyPath(pathname))

  useEffect(() => {
    if (!shouldPlay()) { setPhase('done'); return }
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    let started = false
    // The fade-in needs the invisible logo actually drawn first: with the picture already cached it
    // decoded at once and the logo went straight to visible — no fade (2026-11-20). So: wait for the
    // launch screen, then two animation frames (one drawn at opacity 0), then fade.
    let decoded = false, launchGone = false, alive = true
    const maybePlay = () => { if (alive && decoded && launchGone) requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) play() })) }
    hideLaunchScreen().then(() => { launchGone = true; maybePlay() })
    const onDecoded = () => { decoded = true; maybePlay() }
    const play = () => {
      if (started) return
      started = true
      setPhase('in')
      // Then the frames play (the 'playing' class starts their CSS animations) and hold on the last
      later(FADE_IN_MS, () => setPhase('play'))
      later(FADE_IN_MS + PLAY_MS, () => setPhase('rest'))
      later(FADE_IN_MS + PLAY_MS + REST_MS, () => setPhase('hold'))
    }
    // Start only once the whole picture is decoded, so no frame is drawn half-loaded or skipped
    const img = new Image()
    img.src = SPRITE
    img.decode().then(onDecoded, () => { img.onload = onDecoded; if (img.complete) onDecoded() })
    // The frames never came: no animation, but still no flash of a half-ready page
    later(WAIT_FOR_FRAMES_MS, () => { if (!started) { started = true; setPhase('hold') } })
    later(HOLD_MAX_MS, () => setMaxed(true))
    return () => { alive = false; timers.forEach(clearTimeout) }
  }, [])

  // Played (or gave up waiting) and the page underneath is the right one: fade into it
  useEffect(() => {
    if (phase !== 'hold' || !(ready || maxed)) return
    setPhase('out')
    const t = setTimeout(() => setPhase('done'), FADE_MS)
    return () => clearTimeout(t)
  }, [phase, ready, maxed])

  if (phase === 'done') return null
  const showLogo = phase !== 'wait'
  return (
    <div
      aria-hidden
      className={`md:hidden fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-[#d9c6a0] transition-opacity duration-300 ${phase === 'out' ? 'opacity-0 pointer-events-none' : ''}`}
    >
      {/* Before the frames arrive: just the parchment (the wordmark alone looked like half a logo).
          Then the logo and the wordmark fade in together on the first frame. */}
      <div
        className="flex flex-col items-center gap-5 transition-opacity ease-out"
        style={{ opacity: showLogo ? 1 : 0, transitionDuration: `${FADE_IN_MS}ms` }}
      >
        {/* Every frame its own layer, stacked; frame 0 shows before the play, the last stays after */}
        <div className={`splash-frames relative w-[68vw] max-w-[18rem] aspect-square ${phase === 'wait' || phase === 'in' ? '' : 'playing'}`}>
          {Array.from({ length: FRAMES }, (_, i) => (
            <div
              key={i}
              className="splash-frame absolute inset-0 bg-no-repeat"
              style={{
                backgroundImage: `url(${SPRITE})`,
                backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
                backgroundPosition: `${((i % COLS) / (COLS - 1)) * 100}% ${(Math.floor(i / COLS) / (ROWS - 1)) * 100}%`,
                animationDelay: `${(i - 1) * FRAME_MS}ms`, // fully in at its own frame time
              }}
            />
          ))}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-text.png" alt="" className="w-[76vw] max-w-[20rem] h-auto object-contain" />
      </div>
    </div>
  )
}
