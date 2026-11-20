'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { enablePush, loadPushSettings, pushPermission, savePushPref, type PushPermission } from '@/lib/push'
import { PUSH_KINDS, type PushKind } from '@/lib/pushRules'

// Settings (the ⚙️ on your profile) → Notifications. In the app: turn them on for this phone, then
// choose which kinds you get. On the website: the same choices (they apply to all your phones),
// with a note that notifications come to the phone app. docs/push-notifications.md
export function PushSettings({ uid, row }: { uid: string; row: string }) {
  const [perm, setPerm] = useState<PushPermission | null>(null)
  const [prefs, setPrefs] = useState<Record<PushKind, boolean> | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    pushPermission().then(setPerm)
    loadPushSettings(uid).then((d) => setPrefs(d.prefs)).catch(() => setPrefs({ friendRequests: true, friendAccepts: true }))
  }, [uid])
  if (perm === null) return null
  const web = perm === 'unsupported'

  const turnOn = async () => {
    setBusy(true)
    try { setPerm(await enablePush(uid)) } catch { /* the prompt failed — leave it */ } finally { setBusy(false) }
  }
  const toggle = (kind: PushKind) => {
    if (!prefs) return
    const next = { ...prefs, [kind]: !prefs[kind] }
    setPrefs(next)
    savePushPref(uid, kind, next[kind]).catch(() => setPrefs(prefs))
  }

  return (
    <section>
      <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">Notifications</div>
      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800">
        {!web && perm !== 'granted' ? (
          <div className={row}>
            {perm === 'denied' ? <BellOff size={16} className="text-slate-500 shrink-0" /> : <Bell size={16} className="text-slate-500 shrink-0" />}
            <span className="flex-1 min-w-0 text-sm text-slate-400">
              {perm === 'denied' ? 'Notifications are off for TCGHaven in your phone’s Settings.' : 'Get a notification for friend requests.'}
            </span>
            {perm === 'prompt' && (
              <button onClick={turnOn} disabled={busy} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold disabled:opacity-60">
                {busy && <Loader2 size={12} className="animate-spin" />}Turn on
              </button>
            )}
          </div>
        ) : (
          PUSH_KINDS.map(({ kind, label, hint }) => (
            <label key={kind} className={`${row} cursor-pointer`}>
              <Bell size={16} className="text-slate-500 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink">{label}</span>
                <span className="block text-[0.6875rem] text-slate-500">{hint}</span>
              </span>
              <input type="checkbox" className="h-4 w-4 accent-violet-600 shrink-0" checked={prefs?.[kind] ?? true} disabled={!prefs} onChange={() => toggle(kind)} />
            </label>
          ))
        )}
      </div>
      {web && <p className="text-[0.6875rem] text-slate-500 mt-1.5 px-1">Notifications come to the TCGHaven app on your phone. These choices apply to every phone you’re signed in on.</p>}
    </section>
  )
}
