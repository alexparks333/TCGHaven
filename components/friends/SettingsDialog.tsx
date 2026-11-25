'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { X, LogOut, Pencil, Check, Loader2, AtSign, Mail, UserRound, Trash2, Coins, Camera, LifeBuoy, ChevronRight, RotateCw } from 'lucide-react'
import { useStore } from '@/lib/store'
import { CURRENCIES, type CurrencyCode } from '@/lib/currency'
import { saveCurrency, saveCardSpin, type CardSpin } from '@/lib/firebase/preferences'
import { useAccountRole } from '@/lib/accountRoles'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from './FriendsProvider'
import { Avatar } from './Avatar'
import { changeUsername, updateNameAndPhoto, uploadProfilePhoto, NAME_MAX } from '@/lib/firebase/friends'
import { RequestDelete } from '@/components/account/DeleteAccount'
import { PushSettings } from '@/components/push/PushSettings'
import { PrivacySettings } from './PrivacySettings'

// Settings — opened from the ⚙️ on your profile banner (it used to be its own page in the
// sidebar). Three tabs (2026-11-24): Account Settings (email, currency, notifications, support,
// Sign out, Delete account), Cardex Settings (the pop-out card's twist) and Profile Settings
// (photo, name, @username, who can see your Cardex / Badges — PrivacySettings).
type Tab = 'account' | 'cardex' | 'profile'
const TABS: { id: Tab; label: string }[] = [
  { id: 'account', label: 'Account Settings' },
  { id: 'cardex', label: 'Cardex Settings' },
  { id: 'profile', label: 'Profile Settings' },
]
const SPIN_OPTIONS: { value: CardSpin; label: string }[] = [
  { value: 'full', label: 'Full twists' },
  { value: 'one', label: '1 twist' },
  { value: 'off', label: 'No twist (fade in)' },
]

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth()
  const { me, setMe } = useFriends()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('account')
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Your name and photo (lib/firebase/friends.ts updateNameAndPhoto)
  const [nameEditing, setNameEditing] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const photoInput = useRef<HTMLInputElement>(null)
  const photoBlocked = !!useAccountRole(user?.uid).record.photoBanned // staff took it down (Accounts)
  const currency = useStore((s) => s.currency)
  const setCurrency = useStore((s) => s.setCurrency)
  const chooseCurrency = (code: CurrencyCode) => {
    setCurrency(code)
    if (user) saveCurrency(user.uid, code).catch((e) => console.error('Failed to save the currency:', e))
  }
  // How a Cardex card twists as it pops open — every device signed in to the account (preferencesSync)
  const cardSpin = useStore((s) => s.cardSpin)
  const setCardSpin = useStore((s) => s.setCardSpin)
  const chooseCardSpin = (spin: CardSpin) => {
    setCardSpin(spin)
    if (user) saveCardSpin(user.uid, spin).catch((e) => console.error('Failed to save the card twist:', e))
  }

  useEffect(() => {
    // Not on the Delete account screen: Escape mustn't hide a deletion that's under way
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, deleting])

  if (!user) return null
  if (deleting) return <RequestDelete onCancel={() => setDeleting(false)} onClose={onClose} />
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

  async function saveName() {
    if (!me || !user) return
    setNameSaving(true); setNameError('')
    try {
      await updateNameAndPhoto(user, { displayName: nameValue })
      setMe({ ...me, displayName: nameValue.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX) })
      setNameEditing(false)
    } catch (e) {
      setNameError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setNameSaving(false)
    }
  }

  async function changePhoto(file: File | undefined) {
    if (!file || !me || !user) return
    setPhotoBusy(true); setPhotoError('')
    try {
      const photoURL = await uploadProfilePhoto(user.uid, file)
      await updateNameAndPhoto(user, { photoURL })
      setMe({ ...me, photoURL })
    } catch (e) {
      setPhotoError('Couldn’t change your photo — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setPhotoBusy(false)
      if (photoInput.current) photoInput.current.value = ''
    }
  }

  async function removePhoto() {
    if (!me || !user || !confirm('Remove your profile photo? Your initials show instead.')) return
    setPhotoBusy(true); setPhotoError('')
    try {
      await updateNameAndPhoto(user, { photoURL: '' })
      setMe({ ...me, photoURL: '' })
    } catch (e) {
      setPhotoError('Couldn’t remove it — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setPhotoBusy(false)
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
        // Never taller than the screen: the title and X stay put, the rest scrolls (a short window
        // used to cut off the top and bottom with no way to reach them — 2026-11-21)
        className="add-card-panel relative w-full md:max-w-[27.5rem] card-glass bg-slate-900 rounded-t-3xl md:rounded-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] md:max-h-[calc(100dvh-2rem)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="md:hidden mx-auto mt-2 mb-1 w-10 h-1 rounded-full bg-slate-700 shrink-0" />
        <div className="flex items-center justify-between px-5 pt-3 md:pt-5 pb-4 shrink-0">
          <h2 className="text-lg font-bold text-ink">Settings</h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div role="tablist" aria-label="Settings sections" className="mx-5 mb-4 grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-950 border border-slate-800 shrink-0">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={'rounded-xl px-1.5 py-2 text-xs font-semibold leading-tight text-center transition-colors ' +
                (tab === t.id ? 'bg-[#6b4a2e] text-[#f6ecd6] shadow-sm' : 'text-slate-500 hover:text-ink hover:bg-slate-800')}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 pb-5 flex flex-col gap-4 overflow-y-auto overscroll-contain min-h-0">
          {tab === 'profile' && <>
          {/* Who you are: your photo — tap to change it */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-950 border border-slate-800">
            {/* Your photo: tap to change it */}
            <button type="button" onClick={() => photoInput.current?.click()} disabled={photoBusy || !me || photoBlocked}
              className="group relative rounded-full shrink-0" aria-label="Change your profile photo" title={photoBlocked ? 'Profile photos are turned off for your account' : 'Change your photo'}>
              <Avatar seed={user.uid} name={me?.displayName ?? user.displayName ?? ''} photoURL={me?.photoURL ?? ''} size={56} />
              <span className={'absolute inset-0 rounded-full bg-black/45 text-white flex items-center justify-center transition-opacity ' + (photoBusy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
                {photoBusy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center ring-2 ring-slate-950"><Camera size={11} /></span>
            </button>
            <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp,image/heic" hidden onChange={(e) => changePhoto(e.target.files?.[0])} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-ink truncate">{me?.displayName ?? user.displayName ?? 'Collector'}</div>
              <div className="text-xs text-slate-500 truncate">{google ? 'Signed in with Google' : 'Signed in with email'}</div>
              {photoBlocked ? (
                <div className="mt-1 text-[0.6875rem] text-amber-700">Your profile photo was removed by TCG Haven staff, and photos are turned off for your account.</div>
              ) : (
                <div className="mt-1 flex items-center gap-3 text-xs font-semibold">
                  <button type="button" onClick={() => photoInput.current?.click()} disabled={photoBusy || !me} className="text-violet-700 hover:underline">Change photo</button>
                  {me?.photoURL && <button type="button" onClick={removePhoto} disabled={photoBusy} className="text-slate-500 hover:text-red-600">Remove</button>}
                </div>
              )}
              {photoError && <div className="text-[0.6875rem] text-red-600 mt-1">{photoError}</div>}
            </div>
          </div>

          {/* Name and @username */}
          <section>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">Profile</div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800">
              <div className={row}>
                <UserRound size={16} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400 w-20 shrink-0">Name</span>
                {nameEditing ? (
                  <form onSubmit={(e) => { e.preventDefault(); saveName() }} className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <input autoFocus value={nameValue} maxLength={NAME_MAX} aria-label="Your name"
                        onChange={(e) => { setNameValue(e.target.value); setNameError('') }}
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 focus:border-violet-600 rounded-lg px-2 py-1 text-sm text-ink outline-none" />
                      <button type="submit" disabled={nameSaving || !nameValue.trim()} aria-label="Save your name" className="w-7 h-7 flex items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50">
                        {nameSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      </button>
                      <button type="button" onClick={() => { setNameEditing(false); setNameError('') }} aria-label="Cancel" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800">
                        <X size={13} />
                      </button>
                    </div>
                    {nameError && <div className="text-[0.6875rem] text-red-600 mt-1">{nameError}</div>}
                  </form>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-ink truncate flex-1">{me?.displayName ?? user.displayName ?? '—'}</span>
                    <button onClick={() => { setNameValue(me?.displayName ?? user.displayName ?? ''); setNameEditing(true) }} disabled={!me}
                      className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-ink px-2 py-1 rounded-lg hover:bg-slate-800">
                      <Pencil size={12} />Change
                    </button>
                  </>
                )}
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
                    {error && <div className="text-[0.6875rem] text-red-600 mt-1">{error}</div>}
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
            <p className="text-[0.6875rem] text-slate-500 mt-1.5 px-1">Your profile link uses your username. Your last 3 old usernames stay yours, so links with them still work; older ones are freed up.</p>
          </section>
          {me && <PrivacySettings profile={me} onSaved={setMe} row={row} />}
          </>}

          {tab === 'cardex' && (
            <section>
              <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">Card pop-out</div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60">
                <label className={row}>
                  <RotateCw size={16} className="text-slate-500 shrink-0" />
                  <span className="text-sm text-slate-400 shrink-0 whitespace-nowrap">Card animation</span>
                  <select value={cardSpin} onChange={(e) => chooseCardSpin(e.target.value as CardSpin)} aria-label="Card animation"
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-700 focus:border-violet-600 rounded-lg px-2 py-1.5 text-sm font-semibold text-ink outline-none">
                    {SPIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
              <p className="text-[0.6875rem] text-slate-500 mt-1.5 px-1">
                {cardSpin === 'off'
                  ? 'Cards fade in as they pop open, without twisting.'
                  : cardSpin === 'one'
                    ? 'Cards turn round once as they pop open.'
                    : 'Cards turn round twice as they pop open.'} On every device you sign in to.
              </p>
            </section>
          )}

          {tab === 'account' && <>
          {/* Who you're signed in as */}
          <section>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">Account</div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800">
              <div className={row}>
                <Mail size={16} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400 w-20 shrink-0">Email</span>
                <span className="text-sm font-semibold text-ink truncate">{user.email}</span>
              </div>
              <div className={row}>
                <UserRound size={16} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400 w-20 shrink-0">Sign-in</span>
                <span className="text-sm font-semibold text-ink truncate">{google ? 'Google' : 'Email and password'}</span>
              </div>
            </div>
          </section>

          {/* Currency: what prices are shown in (lib/currency.ts) — everything is still tracked in USD */}
          <section>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">Prices</div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60">
              <label className={row}>
                <Coins size={16} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400 w-20 shrink-0">Currency</span>
                <select value={currency} onChange={(e) => chooseCurrency(e.target.value as CurrencyCode)} aria-label="Currency"
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-700 focus:border-violet-600 rounded-lg px-2 py-1.5 text-sm font-semibold text-ink outline-none">
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.code} — {c.name}</option>)}
                </select>
              </label>
            </div>
            <p className="text-[0.6875rem] text-slate-500 mt-1.5 px-1">
              {currency === 'USD'
                ? 'Card prices come in US dollars. Pick your own currency to see them converted at today’s rate.'
                : `Prices are tracked in US dollars and shown in ${currency} at today’s exchange rate (updated daily), on every device you sign in to.`}
            </p>
          </section>

          {/* Notifications: in the app and on the website (lib/push.ts) */}
          <PushSettings uid={user.uid} row={row} />

          {/* Help: a missing card, your account, a bug (components/pages/SupportPage.tsx) — the way to
              it on a phone, where there's no sidebar */}
          <button
            onClick={() => { onClose(); router.push('/support') }}
            className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border border-slate-800 bg-slate-900 hover:border-slate-700 transition-colors text-left"
          >
            <span className="flex items-center gap-3 min-w-0">
              <LifeBuoy size={16} className="text-slate-500 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">Support</span>
                <span className="block text-xs text-slate-500">Report a missing card, or get help</span>
              </span>
            </span>
            <ChevronRight size={16} className="text-slate-500 shrink-0" />
          </button>

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
          <a href="/privacy" target="_blank" rel="noopener" className="mx-auto -mt-3 text-[0.6875rem] text-slate-500 hover:text-ink">Privacy Policy</a>
          </>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
