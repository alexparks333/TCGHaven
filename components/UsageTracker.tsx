'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from '@/components/friends/FriendsProvider'
import { useStore } from '@/lib/store'
import { inApp } from '@/lib/nativeApp'
import { batchIsEmpty, emptyBatch, flushUsage, saveSummary, sectionOf, summarize, usageDay } from '@/lib/usage'

// Feeds the staff portal's Statistics (lib/usage.ts): how long and where the app is used, and a
// counts-only summary of the account. Mounted once in ClientWrapper; renders nothing.
//
// Time only counts while the page is in front AND someone has touched it in the last 2 minutes —
// an app left open on a desk isn't "use". A new session starts on opening the app or coming back
// after 30 minutes away.

const TICK_MS = 15_000
const IDLE_MS = 2 * 60_000
const FLUSH_MS = 2 * 60_000
const NEW_SESSION_MS = 30 * 60_000
const SUMMARY_MIN_MS = 30 * 60_000
const SESSION_KEY = 'tcghaven-usage-last'
const SUMMARY_KEY = 'tcghaven-usage-summary'

export function UsageTracker() {
  const { user, loading, dataLoading } = useAuth()
  const { friends, myBadges } = useFriends()
  const { cards, soldCards } = useStore()
  const pathname = usePathname() ?? '/'
  const uid = user?.uid ?? null
  const platform: 'app' | 'web' = inApp() ? 'app' : 'web'

  const batch = useRef(emptyBatch())
  const section = useRef(sectionOf(pathname))
  const lastInput = useRef(Date.now())

  // Activity: tick, idle detection, sessions, flushing
  useEffect(() => {
    if (!uid) return
    const now = () => Date.now()
    const readLast = () => { try { return Number(localStorage.getItem(SESSION_KEY)) || 0 } catch { return 0 } }
    const writeLast = () => { try { localStorage.setItem(SESSION_KEY, String(now())) } catch {} }
    // Opening the app (or coming back after a long while) is a session
    const maybeSession = () => { if (now() - readLast() > NEW_SESSION_MS) batch.current.sessions += 1; writeLast() }
    maybeSession()

    const onInput = () => { lastInput.current = now() }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, onInput, { passive: true, capture: true }))

    let flushing = false
    const flush = () => {
      if (flushing || batchIsEmpty(batch.current)) return
      const b = batch.current
      batch.current = emptyBatch()
      flushing = true
      flushUsage(uid, b, platform)
        .catch(() => {
          // Couldn't save (offline): put it back for next time
          const n = batch.current
          n.seconds += b.seconds; n.sessions += b.sessions
          for (const [k, v] of Object.entries(b.pages)) n.pages[k] = (n.pages[k] ?? 0) + v
          for (const [k, v] of Object.entries(b.visits)) n.visits[k] = (n.visits[k] ?? 0) + v
        })
        .finally(() => { flushing = false })
    }

    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible' || now() - lastInput.current > IDLE_MS) return
      const s = TICK_MS / 1000
      batch.current.seconds += s
      batch.current.pages[section.current] = (batch.current.pages[section.current] ?? 0) + s
      writeLast()
    }, TICK_MS)
    const flusher = setInterval(flush, FLUSH_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
      else { lastInput.current = now(); maybeSession() }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      clearInterval(tick); clearInterval(flusher)
      events.forEach((e) => window.removeEventListener(e, onInput, { capture: true }))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [uid, platform])

  // Each part of the app opened counts as a visit
  useEffect(() => {
    const s = sectionOf(pathname)
    section.current = s
    batch.current.visits[s] = (batch.current.visits[s] ?? 0) + 1
  }, [pathname])

  // The counts-only summary: saved when it changes (at most every 30 minutes), and once a day
  // anyway so "last active" stays right
  const earned = myBadges ? Object.keys(myBadges.earned).length : 0
  useEffect(() => {
    // Only once the collection has really loaded — never a "0 cards" summary from a half-loaded app
    if (!uid || !user || loading || dataLoading || !myBadges) return
    const firstDay = user.metadata.creationTime ? usageDay(Date.parse(user.metadata.creationTime)) : usageDay()
    const t = setTimeout(() => {
      const s = summarize(cards, soldCards.length, friends.length, earned, firstDay, platform)
      const sig = JSON.stringify(s)
      let prev: { uid: string; sig: string; at: number } | null = null
      try { prev = JSON.parse(localStorage.getItem(SUMMARY_KEY) || 'null') } catch {}
      const same = prev?.uid === uid && prev.sig === sig
      const recent = prev?.uid === uid && Date.now() - prev.at < SUMMARY_MIN_MS
      if (same || recent) return
      saveSummary(uid, s)
        .then(() => { try { localStorage.setItem(SUMMARY_KEY, JSON.stringify({ uid, sig, at: Date.now() })) } catch {} })
        .catch(() => {})
    }, 5_000) // let quick bursts of changes settle into one save
    return () => clearTimeout(t)
  }, [uid, user, loading, dataLoading, myBadges, cards, soldCards.length, friends.length, earned, platform])

  return null
}
