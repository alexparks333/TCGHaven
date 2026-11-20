'use client'

import { useEffect, useState } from 'react'
import { Bell, Loader2, X } from 'lucide-react'
import { enablePush, pushPermission } from '@/lib/push'

// The Friends page, in the app, while notifications haven't been asked about yet: a small card
// offering them. "Not now" hides it on this phone. docs/push-notifications.md
const DISMISSED = 'haven:push-prompt-dismissed'

export function PushPrompt({ uid }: { uid: string }) {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let dismissed = false
    try { dismissed = !!localStorage.getItem(DISMISSED) } catch { /* private mode */ }
    if (!dismissed) pushPermission().then((p) => setShow(p === 'prompt'))
  }, [])
  if (!show) return null
  const hide = () => {
    try { localStorage.setItem(DISMISSED, '1') } catch { /* private mode */ }
    setShow(false)
  }
  const turnOn = async () => {
    setBusy(true)
    try { await enablePush(uid) } catch { /* left as it was */ }
    setBusy(false)
    setShow(false)
  }
  return (
    <div className="card-glass flex items-center gap-3 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600/15 text-violet-700"><Bell size={17} /></span>
      <span className="flex-1 min-w-0 text-sm text-ink">Get a notification when someone sends you a friend request or accepts yours.</span>
      <button onClick={turnOn} disabled={busy} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-60">
        {busy && <Loader2 size={12} className="animate-spin" />}Turn on
      </button>
      <button onClick={hide} aria-label="Not now" className="shrink-0 p-1 rounded-lg text-slate-500 hover:text-ink"><X size={15} /></button>
    </div>
  )
}
