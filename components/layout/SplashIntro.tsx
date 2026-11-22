'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import { signedInOnlyPath } from './Sidebar'
import { hideLaunchScreen } from '@/lib/nativeApp'
import { LOGO_FRAMES, LOGO_FRAME_MS, SPLASH_VIDEO, splashFrame } from '@/lib/logoFrames'

// 2026-11-21: it's a VIDEO now (public/splash/splash.mp4, the same 21 frames —
// scripts/splash/make-splash-video.swift). Even the stacked frames below still stuttered mid-animation
// on the TestFlight app; a video plays on the phone's video hardware, apart from the page, so the app
// loading underneath can't hold it up. The whole file is fetched first (preloaded in app/layout.tsx)
// and played from memory — iPhone otherwise streams a video only once it's told to play. If it can't
// be read or played in time, the picture frames below play instead (the old way, unchanged).
//
// Phones only, once per visit — a splash screen, not a loader: the big doorway animation plays all
// the way through (cards fly out) over the parchment with the TCGHaven wordmark below, rests on its
// last frame for a moment, then fades into the app — Sign In for someone signed out, their
// collection otherwise (it waits on past that only if the app underneath isn't ready yet). Skipped
// for reduced motion and on desktop. Frames: public/splash/frame-00…20.webp (preloaded in
// app/layout.tsx), 720px each, on the splash's own tan, all decoded before the play starts.
//
// Each frame its own picture, not a slice of one big sheet: a slice has to be cut out and drawn the
// first time it shows — during the animation, so frames came late (the lag, 2026-11-20). A plain,
// already-decoded <img> iPhone Safari puts on screen as it is, with no drawing.
//
// The frames are played by the browser's compositor, not stepped from JavaScript: each frame is its
// own layer, all stacked at full opacity with frame 0 on top, and each fades OUT on cue to show the
// next (.splash-frame, globals.css) — so every frame is drawn before the play, during the fade-in.
// Fading each one IN over the last (until 2026-11-21) left frames 1–20 invisible, and iPhone Safari
// only drew each the moment it first showed: still a stutter on the TestFlight app. Stepped by a
// timer, a frame came late whenever the app underneath was busy loading (the same moment every
// time), and the old one-row strip (15,120px wide) was cut into tiles by iPhone Safari — the splash
// stuttered at the same spot on every start (2026-11-20).
//
// 2026-11-20 (iPhone app start-up): it used to give the frames 1.5s to arrive and then skip
// straight to the page, showed the wordmark alone while waiting, and faded out on a timer — so a
// slow start went parchment → half a logo → the plain loader → Sign In. Now: nothing but parchment
// until the frames are in, and no fade until the page underneath is the real one.
const SEEN = 'haven:intro'
const FRAMES = LOGO_FRAMES
const FRAME_MS = LOGO_FRAME_MS
const PLAY_MS = FRAMES * FRAME_MS + 60 // every frame, the last one included
const REST_MS = 800 // on the finished logo before the fade (2s felt frozen — 2026-11-20)
const WAIT_FOR_VIDEO_MS = 1500 // then the picture frames instead
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
  const [mode, setMode] = useState<'video' | 'frames'>('video')
  const video = useRef<HTMLVideoElement>(null)
  const restWatch = useRef<(() => void) | null>(null)

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
    let useVideo = true, videoUrl: string | null = null
    const maybePlay = () => { if (alive && decoded && launchGone) requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) play() })) }
    hideLaunchScreen().then(() => { launchGone = true; maybePlay() })
    const onDecoded = () => { decoded = true; maybePlay() }
    const rest = () => setPhase((p) => (p === 'play' ? 'rest' : p))
    const play = () => {
      if (started) return
      started = true
      setPhase('in')
      later(FADE_IN_MS, () => {
        setPhase('play')
        const v = video.current
        if (useVideo && v) {
          // Played through → rest on its last frame (the video stays on it); a play that's refused
          // or never ends still moves on
          v.addEventListener('ended', rest, { once: true })
          v.play().catch(() => later(PLAY_MS, rest))
          later(PLAY_MS + 700, rest)
        } else {
          later(PLAY_MS, rest)
        }
      })
    }
    // Rest → hold once 'rest' is reached, whichever way
    const toHold = () => later(REST_MS, () => setPhase((p) => (p === 'rest' ? 'hold' : p)))
    restWatch.current = toHold

    // The picture frames: only when the video can't be read or played in time
    const switchToFrames = () => {
      if (!useVideo || started || !alive) return
      useVideo = false
      setMode('frames')
      // Start only once every frame is decoded, so none is drawn half-loaded, late or skipped
      Promise.all(Array.from({ length: FRAMES }, (_, i) => {
        const img = new Image()
        img.src = splashFrame(i)
        return img.decode().catch(() => new Promise<void>((done) => { img.onload = img.onerror = () => done(); if (img.complete) done() }))
      })).then(onDecoded)
    }

    // The video, whole, from memory
    fetch(SPLASH_VIDEO, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        const v = video.current
        if (!alive || !useVideo || !v) return
        videoUrl = URL.createObjectURL(blob)
        v.muted = true
        v.defaultMuted = true
        const ready = () => { if (useVideo) onDecoded() }
        v.addEventListener('canplaythrough', ready, { once: true })
        v.addEventListener('error', switchToFrames, { once: true })
        v.src = videoUrl
        v.load()
      })
      .catch(switchToFrames)
    later(WAIT_FOR_VIDEO_MS, () => { if (!decoded) switchToFrames() })
    // Nothing came at all: no animation, but still no flash of a half-ready page
    later(WAIT_FOR_FRAMES_MS, () => { if (!started) { started = true; setPhase('hold') } })
    later(HOLD_MAX_MS, () => setMaxed(true))
    return () => { alive = false; timers.forEach(clearTimeout); if (videoUrl) URL.revokeObjectURL(videoUrl) }
  }, [])

  // Resting on the last frame for a moment, then on to hold (the timer is set up in the effect above)
  useEffect(() => { if (phase === 'rest') restWatch.current?.() }, [phase])

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
        {mode === 'video' ? (
          // The video, played from memory once fully loaded; it stays on its last frame when it ends
          <div className="relative w-[68vw] max-w-[18rem] aspect-square">
            <video
              ref={video}
              muted
              playsInline
              preload="none"
              disablePictureInPicture
              className="absolute inset-0 w-full h-full"
            />
          </div>
        ) : (
        /* The fallback: every frame its own layer, stacked with frame 0 on top; each hides at the next
           frame's time, the last (at the bottom) never does */
        <div className={`splash-frames relative w-[68vw] max-w-[18rem] aspect-square ${phase === 'wait' || phase === 'in' ? '' : 'playing'}`}>
          {Array.from({ length: FRAMES }, (_, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={splashFrame(i)}
              alt=""
              draggable={false}
              decoding="sync"
              className="splash-frame absolute inset-0 w-full h-full"
              style={{ zIndex: FRAMES - i, animationDelay: `${i * FRAME_MS}ms` }} // gone by frame i + 1's time
            />
          ))}
        </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-text.png" alt="" className="w-[76vw] max-w-[20rem] h-auto object-contain" />
      </div>
    </div>
  )
}
