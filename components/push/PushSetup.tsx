'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import { enablePush, keepPushToken, onPushTap, pushPermission } from '@/lib/push'

// In the app, once signed in:
// - the first time (per phone), asks "Allow notifications?" — the phone's own prompt — a moment
//   after the app has opened (after the phone intro), so the token is saved to this account;
// - after that, keeps this phone's token current when notifications are allowed (never prompts);
// - opens the page a tapped notification is about.
// Renders nothing; does nothing in a browser. docs/push-notifications.md
const ASKED = 'haven:push-asked'
const ASK_DELAY_MS = 1800

export function PushSetup() {
  const { user } = useAuth()
  const router = useRouter()
  const uid = user?.uid
  useEffect(() => {
    if (!uid) return
    const stopKeeping = keepPushToken(uid)
    let asked = false
    try { asked = !!localStorage.getItem(ASKED) } catch { /* private mode */ }
    const t = asked ? null : setTimeout(async () => {
      if ((await pushPermission()) !== 'prompt') return
      try { localStorage.setItem(ASKED, '1') } catch { /* private mode */ }
      enablePush(uid).catch(() => {})
    }, ASK_DELAY_MS)
    return () => { stopKeeping(); if (t) clearTimeout(t) }
  }, [uid])
  useEffect(() => onPushTap((link) => router.push(link)), [router])
  return null
}
