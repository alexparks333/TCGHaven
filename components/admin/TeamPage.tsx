'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, UserPlus, Trash2, KeyRound, Copy, Check, X, CalendarPlus, Clock, Search, Users, Radio, MailWarning, Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { friendlyAuthError } from '@/lib/auth-errors'
import {
  listStaff, addStaffMember, removeStaffMember, setStaffTitle, watchPresence, ONLINE_MS,
  STAFF_TITLES, STAFF_TITLE_COLORS, type StaffMember, type StaffPresence, type StaffTitle,
} from '@/lib/firebase/staff'
import { useStaff } from './StaffAuthProvider'

// Team (Owner only) — who can sign in to the staff portal, their job titles (just labels; every
// staff member can do the same work, only the Owner manages people), when they joined, and who's
// in the portal right now (staff_presence, written by each person's open portal — StaffPortal.tsx).
// Adding someone creates their staff login with a temporary password the Owner passes on; they
// choose their own on first sign-in. Removing someone deletes their staff record, which ends their
// access everywhere at once (firestore.rules, storage.rules and every staff-only server route).

// Readable temporary password: no look-alike characters, 12 long.
function makeTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

const ASSIGNABLE: StaffTitle[] = STAFF_TITLES.filter((t) => t !== 'Owner')

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const fmtJoined = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—')

export function TeamPage() {
  const { member } = useStaff()
  const [team, setTeam] = useState<StaffMember[] | null>(null)
  const [presence, setPresence] = useState<Record<string, StaffPresence>>({})
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(() => {
    listStaff().then(setTeam).catch((err) => setError(`Couldn't load the team: ${(err as Error).message}`))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => watchPresence(setPresence), [])
  // Re-read "online" / "x min ago" as time passes
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(t) }, [])

  const online = (uid: string) => !!presence[uid] && now - presence[uid].lastSeen < ONLINE_MS
  const names = useMemo(() => new Map((team ?? []).map((m) => [m.uid, m.name || m.email])), [team])

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = (team ?? []).filter((m) => !f || m.name.toLowerCase().includes(f) || m.email.includes(f) || m.title.toLowerCase().includes(f))
    const rank = (m: StaffMember) => STAFF_TITLES.indexOf(m.title)
    // Owner first, then who's here now, then by title, then name
    return list.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0)
      || Number(online(b.uid)) - Number(online(a.uid)) || rank(a) - rank(b) || a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, filter, presence, now])

  if (member?.role !== 'owner') {
    return <div className="card-glass p-5 text-sm text-slate-400">Only the Owner can manage the team.</div>
  }

  async function remove(m: StaffMember) {
    if (!window.confirm(`Remove ${m.name || m.email} from staff? They'll lose access to the staff portal immediately.`)) return
    try {
      await removeStaffMember(m.uid)
      load()
    } catch (err) {
      setError(`Couldn't remove ${m.email}: ${(err as Error).message}`)
    }
  }

  async function retitle(m: StaffMember, title: StaffTitle) {
    setTeam((t) => t?.map((x) => (x.uid === m.uid ? { ...x, title } : x)) ?? t)
    try { await setStaffTitle(m.uid, title) } catch (err) { setError(`Couldn't change ${m.name}'s title: ${(err as Error).message}`); load() }
  }

  const onlineCount = (team ?? []).filter((m) => online(m.uid)).length
  const pendingCount = (team ?? []).filter((m) => m.mustChangePassword).length

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Team</h1>
          <p className="text-slate-400 text-sm mt-0.5">Everyone who can sign in to the staff portal. Titles are labels — only the Owner adds or removes people.</p>
        </div>
        <button onClick={() => setAdding((v) => !v)} className="btn-primary">
          {adding ? <X size={16} /> : <UserPlus size={16} />}{adding ? 'Close' : 'Add staff member'}
        </button>
      </div>

      {/* At a glance */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat icon={Users} label="Team members" value={team ? team.length : '…'} />
        <Stat icon={Radio} label="In the portal now" value={team ? onlineCount : '…'} live={onlineCount > 0} />
        <Stat icon={MailWarning} label="Haven't signed in yet" value={team ? pendingCount : '…'} />
      </div>

      {adding && <AddStaffForm addedBy={member.uid} onAdded={load} />}

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-600">
          {error}<button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {team && team.length > 4 && (
        <div className="relative mb-4 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find someone by name, email or title" className="input-field !pl-9" />
        </div>
      )}

      {!team ? (
        <div className="card-glass p-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading team…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((m) => (
            <MemberCard
              key={m.uid}
              m={m}
              presence={presence[m.uid]}
              online={online(m.uid)}
              now={now}
              addedByName={m.addedBy && m.addedBy !== m.uid ? names.get(m.addedBy) : undefined}
              isYou={m.uid === member.uid}
              onRetitle={(t) => retitle(m, t)}
              onRemove={() => remove(m)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ icon: Icon, label, value, live }: { icon: typeof Users; label: string; value: number | string; live?: boolean }) {
  return (
    <div className="card-glass p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon size={13} className={live ? 'text-emerald-600' : undefined} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
    </div>
  )
}

function MemberCard({ m, presence, online, now, addedByName, isYou, onRetitle, onRemove }: {
  m: StaffMember; presence?: StaffPresence; online: boolean; now: number; addedByName?: string; isYou: boolean
  onRetitle: (t: StaffTitle) => void; onRemove: () => void
}) {
  const color = STAFF_TITLE_COLORS[m.title]
  const initials = (m.name || m.email || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="card-glass overflow-hidden flex flex-col">
      {/* A strip in their title's colour */}
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${color}, ${color}55)` }} />
      <div className="p-4 flex items-start gap-3">
        <div className="relative shrink-0">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: `linear-gradient(135deg, ${color}, ${color}bb)` }}>
            {initials}
          </div>
          <span
            className={cn('absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-[#efe4cc]', online ? 'bg-emerald-500' : 'bg-slate-500')}
            title={online ? 'In the portal now' : 'Away'}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-ink truncate">{m.name || m.email}</span>
            {isYou && <span className="text-[10px] font-semibold text-slate-500">(you)</span>}
          </div>
          <div className="text-xs text-slate-500 truncate">{m.email}</div>
          <div className="mt-2">
            {m.role === 'owner' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: color + '22', color }}>
                <Crown size={11} />Owner
              </span>
            ) : (
              <label className="relative inline-flex items-center">
                <select
                  value={m.title}
                  onChange={(e) => onRetitle(e.target.value as StaffTitle)}
                  aria-label={`${m.name}'s title`}
                  className="appearance-none cursor-pointer text-[11px] font-bold uppercase tracking-wider pl-2 pr-6 py-0.5 rounded-full border-0 outline-none"
                  style={{ backgroundColor: color + '22', color }}
                >
                  {ASSIGNABLE.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="pointer-events-none absolute right-2 text-[9px]" style={{ color }}>▼</span>
              </label>
            )}
          </div>
        </div>
        {m.role !== 'owner' && (
          <button onClick={onRemove} title="Remove from staff" className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-100/30">
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-px bg-slate-800/40 border-t border-slate-800">
        <div className="bg-[#e9dcc0]/60 px-4 py-2.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><Clock size={11} />Status</div>
          <div className={cn('text-xs font-semibold mt-0.5', online ? 'text-emerald-700' : 'text-slate-400')}>
            {m.mustChangePassword && !presence ? 'Hasn’t signed in yet'
              : online ? <>Online · {presence?.page || 'Portal'}</>
              : presence ? `Last seen ${ago(presence.lastSeen, now)}`
              : 'Not seen yet'}
          </div>
        </div>
        <div className="bg-[#e9dcc0]/60 px-4 py-2.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><CalendarPlus size={11} />Joined</div>
          <div className="text-xs font-semibold text-slate-400 mt-0.5 truncate">
            {fmtJoined(m.addedAt)}{addedByName && <span className="font-normal text-slate-500"> · by {addedByName.split(' ')[0]}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function AddStaffForm({ addedBy, onAdded }: { addedBy: string; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState<StaffTitle>('Staff')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Shown once after adding someone, so the Owner can pass the login on.
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCreated(null)
    const tempPassword = makeTempPassword()
    try {
      await addStaffMember({ name, email, tempPassword, title }, addedBy)
      setCreated({ email: email.trim(), password: tempPassword })
      setName('')
      setEmail('')
      setTitle('Staff')
      onAdded()
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code === 'auth/email-already-in-use'
        ? 'That email already has a TCGHaven login. Staff logins are separate from collector accounts — use a different email (e.g. a work address).'
        : friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!created) return
    await navigator.clipboard.writeText(`TCGHaven staff portal: https://tcghaven.org/admin\nEmail: ${created.email}\nTemporary password: ${created.password}`).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="card-glass p-5 mb-6">
      <h2 className="text-base font-semibold text-ink mb-3 flex items-center gap-2"><UserPlus size={17} /> Add a staff member</h2>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_170px_auto] gap-2">
        <input required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="input-field !py-2.5" />
        <input required type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field !py-2.5" />
        <select value={title} onChange={(e) => setTitle(e.target.value as StaffTitle)} className="input-field !py-2.5" aria-label="Title">
          {ASSIGNABLE.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" disabled={busy} className="btn-primary justify-center">
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {created && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink mb-2"><KeyRound size={15} /> Login created — send this to them</div>
          <div className="text-sm text-slate-300 space-y-0.5 font-mono break-all">
            <div>tcghaven.org/admin</div>
            <div>{created.email}</div>
            <div>{created.password}</div>
          </div>
          <p className="text-xs text-slate-500 mt-2">This temporary password is only shown now. They&apos;ll choose their own when they first sign in.</p>
          <button onClick={copy} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900">
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy login details</>}
          </button>
        </div>
      )}
    </div>
  )
}
