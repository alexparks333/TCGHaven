'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Wrench, Minus, Loader2, UserPlus, UserCheck, UserMinus, BookOpen, ExternalLink, BellRing, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/components/auth/AuthProvider'
import { ADMIN_UID } from '@/lib/firebase/config'
import { authFetch } from '@/lib/firebase/authFetch'

// Dev tools, bottom left, for the Owner only (ADMIN_UID — everyone else never sees it), and only
// on a local dev server: ClientWrapper renders it only when NODE_ENV is 'development', so it isn't
// in production builds at all. Drives a
// test collector, Tess Tester (app/api/dev/test-friend/route.ts), so the friends flow can be
// tried from one account: she can send you a request (→ the top-right popup), accept yours,
// unfriend you, and turn her Cardex sharing on/off. Minimized/open is remembered on this device.

interface TessStatus {
  exists: boolean
  uid?: string
  username?: string
  cardex?: boolean
  friendship?: { status: string; fromMe: boolean } | null
  error?: string
}

const OPEN_KEY = 'tcghaven-dev-panel-open'

export function DevPanel() {
  const { user } = useAuth()
  if (!user || !ADMIN_UID || user.uid !== ADMIN_UID) return null
  return <Panel uid={user.uid} />
}

function Panel({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<TessStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    try { setOpen(localStorage.getItem(OPEN_KEY) === '1') } catch { /* storage blocked */ }
  }, [])
  function toggle(next: boolean) {
    setOpen(next)
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0') } catch { /* storage blocked */ }
  }

  const call = useCallback(async (action: string, label?: string) => {
    setBusy(action); setMessage('')
    try {
      const res = await authFetch('/api/dev/test-friend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json()) as TessStatus
      if (!res.ok || data.error) { setMessage(data.error ?? `Failed (${res.status})`); return }
      setStatus(data)
      if (label) setMessage(label)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => { if (open && !status) call('status') }, [open, status, call])

  function replayPopups() {
    try { localStorage.removeItem(`tcghaven-seen-requests:${uid}`) } catch { /* storage blocked */ }
    setMessage('Reload the page to see pending request popups again.')
  }

  const f = status?.friendship
  const relation = !status?.exists ? 'Not created yet'
    : !f ? 'Not friends'
    : f.status === 'accepted' ? 'Friends ✓'
    : f.fromMe ? 'You sent her a request' : 'She sent you a request'

  const position = 'left-3 md:left-[288px]'
  const bottom = { bottom: 'calc(env(safe-area-inset-bottom) + 84px)' }

  if (!open) {
    return (
      <button
        onClick={() => toggle(true)}
        className={cn('fixed z-[55] md:!bottom-4 flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full bg-slate-50 text-slate-950 text-xs font-bold shadow-lg hover:scale-105 transition-transform', position)}
        style={bottom}
      >
        <Wrench size={13} />Dev
      </button>
    )
  }

  const btn = 'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 text-left'

  return (
    <div
      className={cn('fixed z-[55] md:!bottom-4 w-[min(300px,calc(100vw-24px))] rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl overflow-hidden', position)}
      style={bottom}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 text-slate-950">
        <Wrench size={14} />
        <span className="text-xs font-bold uppercase tracking-wider flex-1">Dev tools</span>
        <button onClick={() => call('status')} aria-label="Refresh" className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/10">
          <RefreshCw size={12} className={cn(busy === 'status' && 'animate-spin')} />
        </button>
        <button onClick={() => toggle(false)} aria-label="Minimize" className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/10">
          <Minus size={14} />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs mb-1 px-1">
          <span className="font-bold text-ink">Test friend: Tess</span>
          <span className="text-slate-500">{status ? relation : '…'}</span>
        </div>

        <button onClick={() => call('request', 'Tess sent you a friend request — watch the top right!')} disabled={!!busy} className={cn(btn, 'bg-violet-600 hover:bg-violet-500 text-white')}>
          {busy === 'request' ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
          Send me a friend request
        </button>
        <button
          onClick={() => call('accept', 'Tess accepted your request.')}
          disabled={!!busy || !(f?.status === 'pending' && f.fromMe)}
          title={f?.status === 'pending' && f.fromMe ? '' : 'First send Tess a request (search "tess" on the Friends page)'}
          className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}
        >
          {busy === 'accept' ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
          Accept my request (as Tess)
        </button>
        <button onClick={() => call('unfriend', 'Tess removed the friendship.')} disabled={!!busy || !f} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}>
          {busy === 'unfriend' ? <Loader2 size={15} className="animate-spin" /> : <UserMinus size={15} />}
          Unfriend / cancel (as Tess)
        </button>
        <button onClick={() => call('toggle-cardex')} disabled={!!busy || !status?.exists} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}>
          {busy === 'toggle-cardex' ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />}
          <span className="flex-1">Tess shares her Cardex</span>
          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', status?.cardex ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300')}>
            {status?.cardex ? 'ON' : 'OFF'}
          </span>
        </button>
        {status?.username && (
          <Link href={`/u/${status.username}`} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}>
            <ExternalLink size={15} />View Tess&rsquo;s profile
          </Link>
        )}
        <button onClick={replayPopups} className={cn(btn, 'text-slate-400 hover:text-ink hover:bg-slate-800')}>
          <BellRing size={15} />Replay request popups
        </button>

        {message && <div className="text-[11px] text-slate-400 px-1 pt-1">{message}</div>}
      </div>
    </div>
  )
}
