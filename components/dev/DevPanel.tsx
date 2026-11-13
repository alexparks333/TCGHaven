'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Wrench, Minus, Loader2, UserPlus, UserCheck, UserMinus, BookOpen, ExternalLink, BellRing, RefreshCw, Award, Trophy, Sparkles, Trash2, Users, Heart } from 'lucide-react'
import { fakeEarner, sendDevEarner, clearDevEarners, sendDevMember, clearDevMembers } from '@/lib/devBoard'
import { sendDevReactions } from '@/lib/wallReactions'
import { DEV_ALL_BADGES_KEY, DEV_ALL_BADGES_EVENT, readDevBadgePct } from '@/components/badges/BadgeLibrary'
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
const TAB_KEY = 'tcghaven-dev-panel-tab'
type Tab = 'general' | 'community'

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

  const [tab, setTabState] = useState<Tab>('general')
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1')
      if (localStorage.getItem(TAB_KEY) === 'community') setTabState('community')
    } catch { /* storage blocked */ }
  }, [])
  function setTab(next: Tab) {
    setTabState(next); setMessage('')
    try { localStorage.setItem(TAB_KEY, next) } catch { /* storage blocked */ }
  }

  // Community: fake earners on the Badge Achievements board (this device only, nothing saved)
  const [earnerName, setEarnerName] = useState('')
  const [burst, setBurst] = useState(false)
  function addEarner() {
    sendDevEarner(fakeEarner(earnerName)); setEarnerName('')
    setMessage('Sent — watch the Badge Achievements board.')
  }
  const [memberName, setMemberName] = useState('')
  function addMember() {
    sendDevMember(memberName); setMemberName('')
    setMessage('Joined — watch the Members column.')
  }
  async function addBurst() {
    setBurst(true)
    for (let i = 0; i < 5; i++) { sendDevEarner(fakeEarner()); await new Promise((r) => setTimeout(r, 1400)) }
    setBurst(false)
  }
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

  // Badges: preview every badge as if this % of it were collected — each tier's look (only on this
  // device, only on the dev server). null = off: the real progress.
  const [badgePct, setBadgePct] = useState<number | null>(null)
  useEffect(() => { setBadgePct(readDevBadgePct()) }, [])
  function setDevBadgePct(next: number | null) {
    setBadgePct(next)
    try { localStorage.setItem(DEV_ALL_BADGES_KEY, next === null ? '' : String(next)) } catch { /* storage blocked */ }
    window.dispatchEvent(new Event(DEV_ALL_BADGES_EVENT))
  }

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
      className={cn('fixed z-[55] md:!bottom-4 w-[min(300px,calc(100vw-24px))] max-h-[calc(100dvh-110px)] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl', position)}
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

      <div className="flex gap-1 p-1.5 pb-0">
        {([['general', 'Friends & badges'], ['community', 'Community']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('flex-1 rounded-lg py-1.5 text-[11px] font-bold transition-colors', tab === k ? 'bg-slate-800 text-ink' : 'text-slate-500 hover:text-ink')}>{label}</button>
        ))}
      </div>

      {tab === 'community' ? (
        <div className="p-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs font-bold text-ink px-1 mb-1"><Trophy size={13} />Badge Achievements board</div>
          <div className="flex gap-1.5">
            <input value={earnerName} onChange={(e) => setEarnerName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addEarner() }}
              placeholder="Name (blank = random)" maxLength={40}
              className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-2 text-[13px] text-ink placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-slate-600" />
            <button onClick={addEarner} className="shrink-0 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-3 text-[13px] font-semibold">Earn</button>
          </div>
          <button onClick={addBurst} disabled={burst} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}>
            {burst ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Five earners, one after another
          </button>
          <button onClick={() => { clearDevEarners(); setMessage('Fake earners cleared.') }} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}>
            <Trash2 size={15} />Clear fake earners
          </button>

          <div className="flex items-center gap-2 text-xs font-bold text-ink px-1 mt-2 mb-1"><Users size={13} />Members</div>
          <div className="flex gap-1.5">
            <input value={memberName} onChange={(e) => setMemberName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addMember() }}
              placeholder="Name (blank = random)" maxLength={40}
              className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-2 text-[13px] text-ink placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-slate-600" />
            <button onClick={addMember} className="shrink-0 rounded-xl bg-violet-600 hover:bg-violet-500 text-white px-3 text-[13px] font-semibold">Join</button>
          </div>
          <button onClick={() => { for (let i = 0; i < 5; i++) sendDevMember(); setMessage('Five members joined.') }} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}>
            <UserPlus size={15} />Five members join
          </button>
          <button onClick={() => { clearDevMembers(); setMessage('Fake members cleared.') }} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}>
            <Trash2 size={15} />Clear fake members
          </button>

          <div className="flex items-center gap-2 text-xs font-bold text-ink px-1 mt-2 mb-1"><Heart size={13} />Creator Wall</div>
          <button onClick={() => { sendDevReactions(); setMessage('Reactions added to every post on the wall.') }} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink')}>
            <Heart size={15} />Fake reactions on every post
          </button>

          <Link href={`/c/${uid}`} className={cn(btn, 'bg-slate-800 hover:bg-slate-700 text-ink mt-2')}>
            <ExternalLink size={15} />Open my community page
          </Link>
          <span className="text-[10px] text-slate-500 px-1">Fake earners get a random badge from your book; fake members a random number of your badges and cards. Only on this device — nothing is saved, a reload clears them.</span>
          {message && <div className="text-[11px] text-slate-400 px-1 pt-1">{message}</div>}
        </div>
      ) : (
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
        <div className="rounded-xl bg-slate-800 px-3 py-2 flex flex-col gap-1.5">
          <button onClick={() => setDevBadgePct(badgePct === null ? 100 : null)} className="flex items-center gap-2 text-sm text-ink">
            <Award size={15} />
            <span className="flex-1 text-left">Preview badge progress</span>
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', badgePct !== null ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300')}>{badgePct !== null ? `${badgePct}%` : 'OFF'}</span>
          </button>
          {badgePct !== null && (
            <>
              <input type="range" min={0} max={100} step={1} value={badgePct} onChange={(e) => setDevBadgePct(Number(e.target.value))} className="w-full accent-emerald-500" aria-label="Badge progress %" />
              <div className="flex gap-1">
                {[0, 50, 75, 90, 100].map((v) => (
                  <button key={v} onClick={() => setDevBadgePct(v)} className={cn('flex-1 rounded-md py-0.5 text-[11px] font-semibold', badgePct === v ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:text-ink')}>{v}%</button>
                ))}
              </div>
              <span className="text-[10px] text-slate-500">Every badge as if this much of it were collected — this device only</span>
            </>
          )}
        </div>
        <button onClick={replayPopups} className={cn(btn, 'text-slate-400 hover:text-ink hover:bg-slate-800')}>
          <BellRing size={15} />Replay request popups
        </button>

        {message && <div className="text-[11px] text-slate-400 px-1 pt-1">{message}</div>}
      </div>
      )}
    </div>
  )
}
