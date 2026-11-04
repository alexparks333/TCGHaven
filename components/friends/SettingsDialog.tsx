'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { X, LogOut, Pencil, Check, Loader2, AtSign, Mail, UserRound, Trash2 } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from './FriendsProvider'
import { Avatar } from './Avatar'
import { changeUsername } from '@/lib/firebase/friends'
import { useStore } from '@/lib/store'
import { canDeleteAccount, confirmIdentity, deleteAccount, type DeleteStep } from '@/lib/firebase/deleteAccount'

// Settings — opened from the ⚙️ on your profile banner (it used to be its own page in the
// sidebar). Your account, your @username, Sign out, and Delete account.
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth()
  const { me, setMe } = useFriends()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    // Not on the Delete account screen: Escape mustn't hide a deletion that's under way
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, deleting])

  if (!user) return null
  if (deleting) return <DeleteAccount onCancel={() => setDeleting(false)} onClose={onClose} />
  const google = user.providerData.some((p) => p.providerId === 'google.com')

  async function saveUsername() {
    if (!me || !user) return
    setSaving(true); setError('')
    try {
      const username = await changeUsername(user.uid, me.username, value)
      setMe({ ...me, username })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    router.replace('/login')
  }

  const row = 'flex items-center gap-3 px-4 py-3.5'

  // Portaled to <body>: it's opened from inside the profile card, whose backdrop-blur would
  // otherwise trap a position:fixed overlay inside the card instead of covering the screen.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Settings"
        className="add-card-panel relative w-full md:max-w-[440px] card-glass bg-slate-900 rounded-t-3xl md:rounded-2xl overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="md:hidden mx-auto mt-2 mb-1 w-10 h-1 rounded-full bg-slate-700" />
        <div className="flex items-center justify-between px-5 pt-3 md:pt-5 pb-4">
          <h2 className="text-lg font-bold text-ink">Settings</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-5 flex flex-col gap-4">
          {/* Who you're signed in as */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-950 border border-slate-800">
            <Avatar seed={user.uid} name={me?.displayName ?? user.displayName ?? ''} photoURL={user.photoURL ?? ''} size={48} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-ink truncate">{me?.displayName ?? user.displayName ?? 'Collector'}</div>
              <div className="text-xs text-slate-500 truncate">{google ? 'Signed in with Google' : 'Signed in with email'}</div>
            </div>
          </div>

          {/* Account */}
          <section>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">Account</div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800">
              <div className={row}>
                <UserRound size={16} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400 w-20 shrink-0">Name</span>
                <span className="text-sm font-semibold text-ink truncate">{me?.displayName ?? user.displayName ?? '—'}</span>
              </div>
              <div className={row}>
                <Mail size={16} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400 w-20 shrink-0">Email</span>
                <span className="text-sm font-semibold text-ink truncate">{user.email}</span>
              </div>
              <div className={row}>
                <AtSign size={16} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400 w-20 shrink-0">Username</span>
                {editing ? (
                  <form onSubmit={(e) => { e.preventDefault(); saveUsername() }} className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={value}
                        onChange={(e) => { setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '')); setError('') }}
                        maxLength={20}
                        aria-label="Username"
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 focus:border-violet-600 rounded-lg px-2 py-1 text-sm text-ink outline-none"
                      />
                      <button type="submit" disabled={saving} aria-label="Save username" className="w-7 h-7 flex items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50">
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      </button>
                      <button type="button" onClick={() => { setEditing(false); setError('') }} aria-label="Cancel" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800">
                        <X size={13} />
                      </button>
                    </div>
                    {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
                  </form>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-ink truncate flex-1">{me ? `@${me.username}` : '…'}</span>
                    <button
                      onClick={() => { setValue(me?.username ?? ''); setEditing(true) }}
                      disabled={!me}
                      className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-ink px-2 py-1 rounded-lg hover:bg-slate-800"
                    >
                      <Pencil size={12} />Change
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5 px-1">Your profile link uses your username. Your last 3 old usernames stay yours, so links with them still work; older ones are freed up.</p>
          </section>

          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-red-600/30 text-red-600 font-semibold text-sm hover:bg-red-100/20 transition-colors disabled:opacity-60"
          >
            {signingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
            Sign out
          </button>
          <button
            onClick={() => setDeleting(true)}
            className="mx-auto -mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg transition-colors"
          >
            <Trash2 size={12} />Delete account
          </button>
          <a href="/privacy" target="_blank" rel="noopener" className="mx-auto -mt-3 text-[11px] text-slate-500 hover:text-ink">Privacy Policy</a>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const STEP_LABEL: Record<DeleteStep, string> = {
  confirming: 'Checking it’s you…',
  collection: 'Deleting your collection…',
  friends: 'Removing your friends…',
  profile: 'Deleting your profile and username…',
  account: 'Deleting your sign-in…',
}

// Deleting your account: what goes, typing your username to confirm, and signing in again
// (Firebase only deletes a recent sign-in — and it's a last check that it's really you).
// Nothing is deleted until both pass.
function DeleteAccount({ onCancel, onClose }: { onCancel: () => void; onClose: () => void }) {
  const { user } = useAuth()
  const { me } = useFriends()
  const router = useRouter()
  const cards = useStore((s) => s.cards.length)
  const sold = useStore((s) => s.soldCards.length)
  const [typed, setTyped] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<DeleteStep | null>(null)
  const [error, setError] = useState('')
  if (!user) return null
  const word = me?.username ?? 'delete'
  const usesPassword = user.providerData.some((p) => p.providerId === 'password')
  const blocked = canDeleteAccount(user)
  const ready = typed.trim().toLowerCase() === word.toLowerCase() && (!usesPassword || password.length > 0) && !blocked

  async function run() {
    if (!user || !ready || step) return
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

  const busy = !!step
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={busy ? undefined : onClose} />
      <div
        role="dialog"
        aria-label="Delete account"
        className="add-card-panel relative w-full md:max-w-[440px] card-glass bg-slate-900 rounded-t-3xl md:rounded-2xl overflow-hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="md:hidden mx-auto mt-2 mb-1 w-10 h-1 rounded-full bg-slate-700" />
        <div className="px-5 pt-3 md:pt-5 pb-5 flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">Delete your account?</h2>
          <div className="rounded-2xl border border-red-600/30 bg-red-100/10 p-4 text-sm text-slate-300">
            <p className="font-semibold text-red-600 mb-2">This deletes everything, for good. It can’t be undone.</p>
            <ul className="list-disc pl-5 space-y-1 text-[13px]">
              <li>Your collection — {cards.toLocaleString()} card{cards === 1 ? '' : 's'}{sold ? `, ${sold.toLocaleString()} sold` : ''} — and your collections</li>
              <li>Your profile{me ? ` and @${me.username}` : ''}, badges and Pin Display</li>
              <li>Your friends and friend requests</li>
              <li>Your sign-in ({user.email})</li>
            </ul>
          </div>

          {blocked ? (
            <p className="text-sm text-slate-400">{blocked}</p>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); run() }} className="flex flex-col gap-3">
              <label className="text-xs text-slate-400">
                Type <span className="font-bold text-ink">{word}</span> to confirm
                <input
                  value={typed}
                  onChange={(e) => { setTyped(e.target.value); setError('') }}
                  disabled={busy}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="mt-1 w-full bg-slate-950 border border-slate-700 focus:border-red-600 rounded-xl px-3 py-2.5 text-sm text-ink outline-none"
                />
              </label>
              {usesPassword ? (
                <label className="text-xs text-slate-400">
                  Your password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    disabled={busy}
                    className="mt-1 w-full bg-slate-950 border border-slate-700 focus:border-red-600 rounded-xl px-3 py-2.5 text-sm text-ink outline-none"
                  />
                </label>
              ) : (
                <p className="text-xs text-slate-500">You’ll be asked to sign in with Google once more.</p>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={!ready || busy}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-red-600 text-white font-semibold text-sm hover:bg-red-500 transition-colors disabled:opacity-40"
              >
                {busy ? <><Loader2 size={16} className="animate-spin" />{STEP_LABEL[step!]}</> : <><Trash2 size={16} />Delete my account</>}
              </button>
            </form>
          )}
          <button
            onClick={onCancel}
            disabled={busy}
            className="w-full py-2.5 rounded-2xl border border-slate-700 text-slate-300 font-semibold text-sm hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            Keep my account
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
