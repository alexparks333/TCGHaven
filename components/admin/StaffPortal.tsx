'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Library, RefreshCw, ClipboardCheck, Users, LogOut, Loader2, Lock, Mail, ArrowUpRight, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { friendlyAuthError } from '@/lib/auth-errors'
import { LogoLoader } from '@/components/LogoLoader'
import { StaffAuthProvider, useStaff } from './StaffAuthProvider'

// The staff portal at /admin — everything admin lives here, behind its own staff sign-in
// (lib/firebase/staff.ts), with its own layout instead of the collector app's sidebar
// (ClientWrapper.tsx skips the collector shell for /admin/*).

const NAV = [
  { href: '/admin', label: 'Catalog', icon: Library, ownerOnly: false },
  { href: '/admin/sync', label: 'Sync', icon: RefreshCw, ownerOnly: false },
  { href: '/admin/review', label: 'Needs Review', icon: ClipboardCheck, ownerOnly: false },
  { href: '/admin/team', label: 'Team', icon: Users, ownerOnly: true },
]

export function StaffPortal({ children }: { children: React.ReactNode }) {
  return (
    <StaffAuthProvider>
      <StaffGate>{children}</StaffGate>
    </StaffAuthProvider>
  )
}

function StaffGate({ children }: { children: React.ReactNode }) {
  const { user, member, loading } = useStaff()
  if (loading) return <LogoLoader fullScreen label="Loading staff portal…" />
  if (!user) return <StaffSignIn />
  if (!member) return <NoAccess />
  if (member.mustChangePassword) return <ChooseOwnPassword />
  return <Shell>{children}</Shell>
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { member, signOut } = useStaff()
  const nav = NAV.filter((n) => !n.ownerOnly || member?.role === 'owner')
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href))

  return (
    <div className="flex flex-col md:flex-row h-dvh overflow-hidden">
      {/* Desktop sidebar — dark, so the portal never looks like the collector app */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-[#2b2014] text-[#ede1c6]">
        <div className="px-5 pt-6 pb-5 border-b border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-text.png" alt="TCGHaven" className="h-7 w-auto object-contain brightness-150" />
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d6c49f]/70">Staff Portal</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive(href) ? 'bg-white/15 text-white' : 'text-[#d6c49f] hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon size={17} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/10 space-y-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{member?.name}</div>
            <div className="text-xs text-[#d6c49f]/70 truncate">{member?.email}</div>
            <div className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-[#ede1c6]">
              {member?.role === 'owner' ? 'Owner' : 'Staff'}
            </div>
          </div>
          <Link href="/" className="flex items-center gap-2 text-xs text-[#d6c49f] hover:text-white">
            <ArrowUpRight size={14} /> Open collector app
          </Link>
          <button onClick={signOut} className="flex items-center gap-2 text-xs text-[#d6c49f] hover:text-white">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* Phone top bar + sideways-scrolling tabs */}
      <header className="md:hidden shrink-0 bg-[#2b2014] text-[#ede1c6] pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-text.png" alt="TCGHaven" className="h-5 w-auto object-contain brightness-150" />
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d6c49f]/70 mt-0.5">Staff Portal</div>
          </div>
          <button onClick={signOut} className="flex items-center gap-1.5 text-xs text-[#d6c49f]">
            <LogOut size={14} /> Sign out
          </button>
        </div>
        <nav className="flex gap-1 px-3 pb-2 overflow-x-auto [scrollbar-width:none]">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
                isActive(href) ? 'bg-white/15 text-white' : 'text-[#d6c49f]',
              )}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 md:py-8 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          {children}
        </div>
      </main>
    </div>
  )
}

// ── Sign-in / gate screens ────────────────────────────────────────────────────

function GateCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="h-dvh overflow-y-auto bg-[#2b2014] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="w-20 h-20 object-contain mb-3" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-text.png" alt="TCGHaven" className="w-48 h-auto object-contain brightness-150" />
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d6c49f]/70">Staff Portal</div>
        </div>
        <div className="bg-[#ede1c6] rounded-2xl p-6 shadow-2xl">
          <h1 className="text-lg font-bold text-ink">{title}</h1>
          <p className="text-sm text-slate-500 mt-1 mb-5">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full bg-white border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-violet-500'

function StaffSignIn() {
  const { signInWithEmail, signInWithGoogle } = useStaff()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signInWithEmail(email, password)
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  async function google() {
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(friendlyAuthError(err))
    }
  }

  return (
    <GateCard title="Staff sign in" subtitle="For TCGHaven staff only. Use the login the Owner gave you.">
      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="email" autoComplete="username" required placeholder="Staff email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </div>
        <div className="relative">
          <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="password" autoComplete="current-password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'Sign in'}
        </button>
      </form>
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-slate-700" />
        <span className="text-xs text-slate-500">or</span>
        <div className="flex-1 h-px bg-slate-700" />
      </div>
      <button onClick={google} className="w-full py-2.5 rounded-xl bg-white text-ink text-sm font-medium border border-slate-700 hover:bg-slate-950">
        Continue with Google
      </button>
    </GateCard>
  )
}

function NoAccess() {
  const { user, signOut } = useStaff()
  return (
    <GateCard title="No staff access" subtitle={`${user?.email ?? 'This account'} isn't on the TCGHaven staff list.`}>
      <div className="flex items-start gap-2 text-sm text-slate-400 mb-5">
        <ShieldAlert size={16} className="shrink-0 mt-0.5" />
        If you work for TCGHaven, ask the Owner to add you, then sign in with the login they give you.
      </div>
      <button onClick={signOut} className="btn-primary w-full justify-center">Sign in with a different account</button>
    </GateCard>
  )
}

function ChooseOwnPassword() {
  const { member, changePassword, signOut } = useStaff()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) { setError('Use at least 8 characters.'); return }
    if (pw !== confirm) { setError("The passwords don't match."); return }
    setBusy(true)
    setError(null)
    try {
      await changePassword(pw)
    } catch (err) {
      setError(friendlyAuthError(err))
      setBusy(false)
    }
  }

  return (
    <GateCard title={`Welcome, ${member?.name || 'there'}`} subtitle="You signed in with a temporary password. Choose your own to continue.">
      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="password" autoComplete="new-password" required placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
        </div>
        <div className="relative">
          <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="password" autoComplete="new-password" required placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'Save password'}
        </button>
      </form>
      <button onClick={signOut} className="mt-4 w-full text-xs text-slate-500 hover:text-ink">Sign out</button>
    </GateCard>
  )
}
