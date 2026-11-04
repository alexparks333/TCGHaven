'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, Trash2, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from '@/components/friends/FriendsProvider'
import { useStore } from '@/lib/store'
import {
  canDeleteAccount, cancelDeleteRequest, checkDeleteLink, confirmIdentity, deleteAccount, sendDeleteEmail,
  type DeleteStep,
} from '@/lib/firebase/deleteAccount'

// Deleting an account takes two factors (lib/firebase/deleteAccount.ts):
//   RequestDelete (Settings)      — what goes, type your username, and we email a confirmation link
//   ConfirmDelete (/confirm-delete) — the link checked (your inbox, this device, within the hour),
//                                     then your password / Google sign-in, then it's deleted
// Nothing is deleted before the very last button.

const STEP_LABEL: Record<DeleteStep, string> = {
  confirming: 'Checking it’s you…',
  profile: 'Deleting your profile and username…',
  friends: 'Removing your friends…',
  collection: 'Deleting your collection…',
  account: 'Deleting your sign-in…',
}

const input = 'mt-1 w-full bg-slate-950 border border-slate-700 focus:border-red-600 rounded-xl px-3 py-2.5 text-sm text-ink outline-none'
const dangerButton = 'w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-600 text-white font-semibold text-sm hover:bg-red-500 transition-colors disabled:opacity-40'
const keepButton = 'w-full py-2.5 rounded-2xl border border-slate-700 text-slate-300 font-semibold text-sm hover:bg-slate-800 transition-colors disabled:opacity-40'

// What goes, with the collector's own numbers
function WhatGoes() {
  const { user, dataLoading } = useAuth()
  const { me } = useFriends()
  const cards = useStore((s) => s.cards.length)
  const sold = useStore((s) => s.soldCards.length)
  return (
    <div className="rounded-2xl border border-red-600/30 bg-red-100/10 p-4 text-sm text-slate-300">
      <p className="font-semibold text-red-600 mb-2">This deletes everything, for good. It can’t be undone.</p>
      <ul className="list-disc pl-5 space-y-1 text-[13px]">
        <li>Your collection{dataLoading ? '' : ` — ${cards.toLocaleString()} card${cards === 1 ? '' : 's'}${sold ? `, ${sold.toLocaleString()} sold` : ''} —`} and your collections</li>
        <li>Your profile{me ? ` and @${me.username}` : ''}, badges and Pin Display</li>
        <li>Your friends and friend requests</li>
        <li>Your sign-in ({user?.email})</li>
      </ul>
    </div>
  )
}

// e.g. al•••••@gmail.com — enough to know which inbox to look in
function maskEmail(email: string) {
  const [name, domain] = email.split('@')
  return domain ? `${name.slice(0, 2)}${'•'.repeat(Math.max(3, name.length - 2))}@${domain}` : email
}

// Step 1, from Settings: nothing is deleted here — it only emails the confirmation link
export function RequestDelete({ onCancel, onClose }: { onCancel: () => void; onClose: () => void }) {
  const { user } = useAuth()
  const { me } = useFriends()
  const [typed, setTyped] = useState('')
  const [sending, setSending] = useState(false)
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  useEffect(() => {
    if (!sentAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [sentAt])
  if (!user) return null
  const word = me?.username ?? 'delete'
  const blocked = canDeleteAccount(user)
  const wait = sentAt ? Math.max(0, 60 - Math.floor((now - sentAt) / 1000)) : 0 // before sending again

  async function send() {
    if (!user || sending || wait) return
    setSending(true); setError('')
    try {
      await sendDeleteEmail(user)
      setSentAt(Date.now()); setNow(Date.now())
    } catch (e) {
      const code = (e as { code?: string })?.code ?? ''
      setError(code === 'auth/too-many-requests' ? 'Too many emails — wait a few minutes and try again.' : 'Couldn’t send the email. Try again in a moment.')
    } finally {
      setSending(false)
    }
  }

  function keep() {
    cancelDeleteRequest() // a link already sent stops working
    onCancel()
  }

  return (
    <Sheet label="Delete account" onBackdrop={onClose}>
      <h2 className="text-lg font-bold text-ink">Delete your account?</h2>
      <WhatGoes />
      {blocked ? (
        <p className="text-sm text-slate-400">{blocked}</p>
      ) : sentAt ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <Mail size={20} className="shrink-0 text-slate-400 mt-0.5" />
            <div className="text-sm text-slate-300">
              <p className="font-semibold text-ink">Check your email</p>
              <p className="mt-1 text-[13px]">
                We sent a confirmation link to <b className="text-ink">{maskEmail(user.email ?? '')}</b>. Open it
                on <b className="text-ink">this device</b> within an hour — you’ll confirm with your
                {user.providerData.some((p) => p.providerId === 'password') ? ' password' : ' Google sign-in'} there.
                Nothing has been deleted.
              </p>
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button onClick={send} disabled={sending || wait > 0} className="text-xs font-semibold text-slate-500 hover:text-ink disabled:opacity-50">
            {wait > 0 ? `Send again in ${wait}s` : sending ? 'Sending…' : 'Send the email again'}
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex flex-col gap-3">
          <label className="text-xs text-slate-400">
            Type <span className="font-bold text-ink">{word}</span> to continue
            <input
              value={typed}
              onChange={(e) => { setTyped(e.target.value); setError('') }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={input}
            />
          </label>
          <p className="flex gap-2 text-xs text-slate-500">
            <ShieldCheck size={14} className="shrink-0" />
            To keep your account safe, we’ll email you a link to confirm — then you’ll sign in once more.
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={typed.trim().toLowerCase() !== word.toLowerCase() || sending} className={dangerButton}>
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            Email me a confirmation link
          </button>
        </form>
      )}
      <button onClick={keep} className={keepButton}>Keep my account</button>
    </Sheet>
  )
}

// Step 2, the emailed link's page: the link checked, then the password / Google sign-in, then gone
export function ConfirmDelete() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [problem, setProblem] = useState<string | null | undefined>(undefined) // undefined = checking
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<DeleteStep | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) { setProblem('Sign in to TCGHaven on this device first, then open the link from your email again.'); return }
    const blocked = canDeleteAccount(user)
    if (blocked) { setProblem(blocked); return }
    let cancelled = false
    checkDeleteLink(user, window.location.href).then((p) => { if (!cancelled) setProblem(p) })
    return () => { cancelled = true }
  }, [user, loading])

  const usesPassword = !!user?.providerData.some((p) => p.providerId === 'password')

  async function run() {
    if (!user || step || (usesPassword && !password)) return
    setError('')
    setStep('confirming')
    let reached = 'confirming' as DeleteStep
    try {
      await confirmIdentity(user, usesPassword ? password : undefined)
      await deleteAccount(user, (s) => { reached = s; setStep(s) })
      router.replace('/login')
    } catch (e) {
      setStep(null)
      const code = (e as { code?: string })?.code ?? ''
      setError(
        code === 'auth/wrong-password' || code === 'auth/invalid-credential' ? 'That password isn’t right.'
        : code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' ? 'Google sign-in was closed — nothing was deleted.'
        : code === 'auth/too-many-requests' ? 'Too many tries — wait a few minutes and try again.'
        // the profile step is all-or-nothing and goes first: a failure there deleted nothing
        : reached === 'profile' ? 'Couldn’t delete your account — nothing was deleted. Try again in a moment.'
        : reached !== 'confirming' ? 'Something went wrong part way. Some of your data is already gone — try again to finish deleting.'
        : e instanceof Error ? e.message : 'Couldn’t delete your account.',
      )
    }
  }

  function keep() {
    cancelDeleteRequest()
    router.replace('/profile')
  }

  const busy = !!step
  return (
    <div className="mx-auto w-full max-w-[440px] pt-4 md:pt-10 flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">Delete your account</h1>
      {problem === undefined ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" />Checking your link…</div>
      ) : problem ? (
        <>
          <p className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">{problem}</p>
          <p className="text-xs text-slate-500">Nothing has been deleted.</p>
          <button onClick={() => router.replace(user ? '/profile' : '/login')} className={keepButton}>{user ? 'Back to my profile' : 'Sign in'}</button>
        </>
      ) : (
        <>
          <p className="flex gap-2 text-sm text-slate-300"><ShieldCheck size={16} className="shrink-0 text-emerald-600 mt-0.5" />Email confirmed. One last check that it’s you.</p>
          <WhatGoes />
          <form onSubmit={(e) => { e.preventDefault(); run() }} className="flex flex-col gap-3">
            {usesPassword ? (
              <label className="text-xs text-slate-400">
                Your password
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} disabled={busy} className={input} />
              </label>
            ) : (
              <p className="text-xs text-slate-500">You’ll sign in with Google once more.</p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button type="submit" disabled={busy || (usesPassword && !password)} className={dangerButton}>
              {busy ? <><Loader2 size={16} className="animate-spin" />{STEP_LABEL[step!]}</> : <><Trash2 size={16} />Delete my account forever</>}
            </button>
          </form>
          <button onClick={keep} disabled={busy} className={keepButton}>Keep my account</button>
        </>
      )}
    </div>
  )
}

// The bottom sheet (phones) / dialog (desktop) the Settings screens use
function Sheet({ label, onBackdrop, children }: { label: string; onBackdrop: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={onBackdrop} />
      <div
        role="dialog"
        aria-label={label}
        className="add-card-panel relative w-full md:max-w-[440px] card-glass bg-slate-900 rounded-t-3xl md:rounded-2xl overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="md:hidden mx-auto mt-2 mb-1 w-10 h-1 rounded-full bg-slate-700" />
        <div className="px-5 pt-3 md:pt-5 pb-5 flex flex-col gap-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
