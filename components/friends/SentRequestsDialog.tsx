'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { X, Send, Clock, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from './FriendsProvider'
import { Avatar } from './Avatar'
import { removeFriendship, profilePath } from '@/lib/firebase/friends'

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", then a date. */
export function timeAgo(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`
  return `on ${new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// Your active sent requests — opened from the "Sent" tile on the Friends page. Each shows who and
// how long ago you sent it, with Cancel. Portaled to <body> (it opens from inside a blurred card).
export function SentRequestsDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const { outgoing } = useFriends()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => { window.removeEventListener('keydown', onKey); clearInterval(tick) }
  }, [onClose])

  async function cancel(uid: string) {
    if (!user) return
    setBusy(uid); setError('')
    try { await removeFriendship(user.uid, uid) } catch (e) {
      console.error(e); setError('Couldn’t cancel — please try again.')
    } finally { setBusy(null) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Sent friend requests"
        className="add-card-panel relative w-full md:max-w-[440px] card-glass bg-slate-900 rounded-t-3xl md:rounded-2xl flex flex-col max-h-[80dvh] md:max-h-[560px] overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="md:hidden mx-auto mt-2 mb-1 w-10 h-1 rounded-full bg-slate-700" />
        <div className="flex items-center gap-2 px-5 pt-3 md:pt-5 pb-1">
          <Send size={17} className="text-slate-400" />
          <h2 className="text-lg font-bold text-ink">Sent requests</h2>
          {outgoing.length > 0 && <span className="text-xs font-bold text-slate-500 bg-slate-800/80 px-2 py-0.5 rounded-full">{outgoing.length}</span>}
          <button onClick={onClose} aria-label="Close" className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>
        <p className="px-5 text-xs text-slate-500 mb-3">Waiting for them to accept. Cancel any you no longer want.</p>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          {outgoing.length === 0 ? (
            <div className="flex flex-col items-center text-center py-10">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/70 flex items-center justify-center text-slate-400 mb-3"><Send size={24} /></div>
              <div className="text-sm font-bold text-ink">No requests waiting</div>
              <div className="text-xs text-slate-500 mt-1">Requests you send show up here until they&rsquo;re accepted.</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {outgoing.map((e) => (
                <div key={e.uid} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 pl-3 pr-2 py-2.5">
                  <Link href={profilePath(e.uid, e.profile?.username)} onClick={onClose} className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar seed={e.uid} name={e.profile?.displayName ?? ''} photoURL={e.profile?.photoURL} size={44} />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-ink truncate">{e.profile?.displayName ?? '…'}</div>
                      <div className="flex items-center gap-1 text-xs text-slate-500 truncate">
                        <Clock size={11} className="shrink-0" />Sent {timeAgo(e.friendship.createdAt, now) || 'just now'}
                      </div>
                    </div>
                  </Link>
                  <button
                    onClick={() => cancel(e.uid)}
                    disabled={busy === e.uid}
                    className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-700 text-xs font-semibold text-slate-400 hover:text-red-600 hover:border-red-600/40 hover:bg-red-100/20 transition-colors disabled:opacity-60"
                  >
                    {busy === e.uid ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}Cancel
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <div className="text-xs text-red-600 mt-3 text-center">{error}</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
