'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, UserPlus, Trash2, KeyRound, Copy, Check } from 'lucide-react'
import { friendlyAuthError } from '@/lib/auth-errors'
import { listStaff, addStaffMember, removeStaffMember, type StaffMember } from '@/lib/firebase/staff'
import { useStaff } from './StaffAuthProvider'

// Team (Owner only) — who can sign in to the staff portal. Adding someone creates their staff
// login with a temporary password the Owner passes on; they choose their own on first sign-in.
// Removing someone deletes their staff record, which ends their access everywhere at once
// (firestore.rules, storage.rules and every staff-only server route all check it).

// Readable temporary password: no look-alike characters, 12 long.
function makeTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export function TeamPage() {
  const { member } = useStaff()
  const [team, setTeam] = useState<StaffMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    listStaff().then(setTeam).catch((err) => setError(`Couldn't load the team: ${(err as Error).message}`))
  }, [])
  useEffect(() => { load() }, [load])

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

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Team</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          People who can sign in to the staff portal. Staff can do all catalog, sync and review work;
          only the Owner can add or remove people.
        </p>
      </div>

      <AddStaffForm addedBy={member.uid} onAdded={load} />

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      <div className="card-glass overflow-hidden">
        {!team ? (
          <div className="p-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading team…</div>
        ) : (
          team.map((m) => (
            <div key={m.uid} className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-800/50 last:border-0">
              <div className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                {(m.name || m.email || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink truncate">{m.name || m.email}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    {m.role === 'owner' ? 'Owner' : 'Staff'}
                  </span>
                  {m.mustChangePassword && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700">hasn&apos;t signed in yet</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 truncate">{m.email}</div>
              </div>
              {m.role !== 'owner' && (
                <button onClick={() => remove(m)} title="Remove from staff" className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-100/30">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function AddStaffForm({ addedBy, onAdded }: { addedBy: string; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
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
      await addStaffMember({ name, email, tempPassword }, addedBy)
      setCreated({ email: email.trim(), password: tempPassword })
      setName('')
      setEmail('')
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

  const field = 'w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-violet-500'

  return (
    <div className="card-glass p-5 mb-6">
      <h2 className="text-base font-semibold text-ink mb-3 flex items-center gap-2"><UserPlus size={17} /> Add staff</h2>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
        <input required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
        <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
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
