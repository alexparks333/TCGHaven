'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Mail, RefreshCw, RotateCcw, SearchX, LifeBuoy, Smartphone, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'
import { staffDb } from '@/lib/firebase/staff'
import { GAME_LABELS } from '@/lib/types'
import { loadSupportRequests, setSupportStatus, SUPPORT_TOPICS, type SupportRequest, type SupportStatus } from '@/lib/support'

// The staff portal's Support tab: what collectors sent from /support (lib/support.ts) — missing
// cards to add to the catalog, and help / bug reports to answer (by email: the reply link). Newest
// first; mark each done when it's dealt with.

type Show = 'open' | 'done' | 'all'
type Kind = 'all' | 'missing-card' | 'general'

const topicLabel = (id?: string) => SUPPORT_TOPICS.find((t) => t.id === id)?.label ?? 'Help'
const when = (r: SupportRequest) => r.createdAt?.toDate?.().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) ?? 'just now'

export function SupportInbox() {
  const [rows, setRows] = useState<SupportRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<Show>('open')
  const [kind, setKind] = useState<Kind>('all')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    loadSupportRequests(staffDb).then(setRows).catch((e) => { console.error(e); setError('Couldn’t load support reports.'); setRows([]) })
  }, [])
  useEffect(() => { load() }, [load])

  async function mark(r: SupportRequest, status: SupportStatus) {
    setBusy(r.id)
    try {
      await setSupportStatus(staffDb, r.id, status)
      setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? rs)
    } catch (e) {
      console.error(e)
      setError('Couldn’t update that report.')
    } finally {
      setBusy(null)
    }
  }

  const shown = useMemo(() => (rows ?? []).filter((r) =>
    (show === 'all' || r.status === show) && (kind === 'all' || r.kind === kind)), [rows, show, kind])
  const openCount = (rows ?? []).filter((r) => r.status === 'open').length

  const pill = (on: boolean) => cn('text-xs font-medium px-3 py-1 rounded-full transition-colors', on ? 'bg-slate-800 text-ink' : 'text-slate-500 hover:text-ink')

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink">Support</h1>
          <p className="text-slate-400 text-sm mt-0.5">Missing cards and help requests from /support{rows ? ` · ${openCount} open` : ''}.</p>
        </div>
        <button onClick={load} className="btn-secondary"><RefreshCw size={14} />Refresh</button>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex items-center rounded-full border border-slate-700 p-0.5">
          {([['open', 'Open'], ['done', 'Done'], ['all', 'All']] as const).map(([v, l]) => <button key={v} onClick={() => setShow(v)} className={pill(show === v)}>{l}</button>)}
        </div>
        <div className="flex items-center rounded-full border border-slate-700 p-0.5">
          {([['all', 'Everything'], ['missing-card', 'Missing cards'], ['general', 'Help']] as const).map(([v, l]) => <button key={v} onClick={() => setKind(v)} className={pill(kind === v)}>{l}</button>)}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {rows === null ? (
        <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
      ) : shown.length === 0 ? (
        <div className="card-glass py-14 text-center text-sm text-slate-500">Nothing here{show === 'open' ? ' — all caught up' : ''}.</div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => {
            const missing = r.kind === 'missing-card'
            const subject = encodeURIComponent(missing ? `Your missing card report: ${r.cardName ?? ''}` : `Re: ${topicLabel(r.topic)} — TCGHaven support`)
            return (
              <div key={r.id} className={cn('card-glass p-4', r.status === 'done' && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('inline-flex items-center gap-1 text-[0.6875rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full', missing ? 'bg-amber-500/15 text-amber-700' : 'bg-violet-600/15 text-violet-700')}>
                        {missing ? <SearchX size={11} /> : <LifeBuoy size={11} />}{missing ? 'Missing card' : topicLabel(r.topic)}
                      </span>
                      {r.status === 'done' && <span className="text-[0.6875rem] font-bold uppercase tracking-wide text-emerald-700">Done</span>}
                      <span className="text-xs text-slate-500">{when(r)}</span>
                      <span className="text-slate-600" title={r.platform === 'app' ? 'From the app' : 'From the website'}>{r.platform === 'app' ? <Smartphone size={12} /> : <Monitor size={12} />}</span>
                    </div>
                    {missing ? (
                      <div className="mt-2 text-sm text-ink">
                        <span className="font-semibold">{r.cardName}</span>
                        {r.number && <span className="text-slate-500"> · #{r.number}</span>}
                        <span className="text-slate-500"> · {r.game ? GAME_LABELS[r.game] ?? r.game : 'game not given'}{r.setName ? ` · ${r.setName}` : ''}</span>
                      </div>
                    ) : null}
                    {r.message && <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap break-words">{r.message}</p>}
                    <div className="mt-2 text-xs text-slate-500">
                      From <span className="text-ink font-medium">{r.name || 'a collector'}</span>
                      {' · '}<a href={`mailto:${r.email}?subject=${subject}`} className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink"><Mail size={11} />{r.email}</a>
                      {r.page && <> · from {r.page}</>}
                    </div>
                  </div>
                  <button
                    onClick={() => mark(r, r.status === 'done' ? 'open' : 'done')}
                    disabled={busy === r.id}
                    className="shrink-0 btn-secondary"
                  >
                    {busy === r.id ? <Loader2 size={14} className="animate-spin" /> : r.status === 'done' ? <RotateCcw size={14} /> : <Check size={14} />}
                    {r.status === 'done' ? 'Reopen' : 'Mark done'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
