'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, User, KeyRound, AlertCircle, Loader2, AtSign, Check } from 'lucide-react'
import { cleanUsername, usernameFree, wantUsername } from '@/lib/firebase/friends'
import { useAuth } from '@/components/auth/AuthProvider'
import { afterSignIn, nextQuery } from '@/lib/authRedirect'
import { friendlyAuthError } from '@/lib/auth-errors'
import { LogoFrames } from '@/components/LogoFrames'

export default function SignupPage() {
  const { signUp, signInWithGoogle, verifyPasscode } = useAuth()
  const router = useRouter()
  const [passcodeVerified, setPasscodeVerified] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [passcodeError, setPasscodeError] = useState('')
  const [passcodeChecking, setPasscodeChecking] = useState(false)
  const [name, setName] = useState('')
  // The @username: follows the display name ("Alex Parks" → alexparks) until they type their own
  const [username, setUsername] = useState('')
  const [usernameEdited, setUsernameEdited] = useState(false)
  const [free, setFree] = useState<boolean | null>(null)   // null = checking / couldn't check
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const suggested = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20)
  const handle = usernameEdited ? username : suggested
  const validHandle = cleanUsername(handle)
  useEffect(() => {
    setFree(null)
    if (!validHandle) return
    let live = true
    const t = setTimeout(() => { usernameFree(validHandle).then((f) => { if (live) setFree(f) }) }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [validHandle])

  async function handlePasscodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPasscodeError('')
    setPasscodeChecking(true)
    try {
      const ok = await verifyPasscode(passcode)
      if (ok) setPasscodeVerified(true)
      else setPasscodeError('That invite code is not valid.')
    } finally {
      setPasscodeChecking(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (!validHandle) { setError('Usernames are 3–20 letters, numbers, _ or .'); return }
    if (free === false) { setError(`@${validHandle} is taken — try another username.`); return }
    setError('')
    setLoading(true)
    try {
      wantUsername(validHandle)   // the profile made right after sign-up takes it (lib/firebase/friends.ts)
      await signUp(email, password, name)
      router.replace(afterSignIn())
    } catch (err: unknown) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    try {
      // A username typed in the form below is used for a new Google account too
      if (validHandle && free !== false) wantUsername(validHandle)
      await signInWithGoogle()
      router.replace(afterSignIn())
    } catch (err: unknown) {
      setError(friendlyAuthError(err))
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          {/* The doorway, looping (20 → 0 → 20, a 1s rest) — components/LogoFrames.tsx */}
          <LogoFrames playing hold={30} sprite="/logo-sprite.webp" className="w-28 h-28 mb-3 drop-shadow-xl" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <h1><img src="/logo-text.png" alt="TCGHaven" className="w-56 h-auto object-contain" /></h1>
          <p className="text-slate-500 text-sm mt-1">Create your collection account</p>
        </div>

        {!passcodeVerified ? (
          <form onSubmit={handlePasscodeSubmit} className="flex flex-col gap-3">
            <p className="text-slate-400 text-sm text-center -mt-2 mb-1">
              You need an invite code to create an account.
            </p>
            <div className="relative">
              <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                required
                autoFocus
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Invite code"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-violet-600 transition-colors"
              />
            </div>

            {passcodeError && (
              <div className="flex items-center gap-2 text-red-600 bg-red-100/40 border border-red-200 rounded-xl px-3 py-2 text-xs">
                <AlertCircle size={14} className="shrink-0" />
                {passcodeError}
              </div>
            )}

            <button
              type="submit"
              disabled={passcodeChecking}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-medium py-2.5 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
            >
              {passcodeChecking ? <Loader2 size={16} className="animate-spin" /> : null}
              Continue
            </button>
          </form>
        ) : (
          <>
            {/* Google */}
            <button
              onClick={handleGoogle}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-950 text-ink font-medium py-2.5 px-4 rounded-xl transition-colors mb-4 text-sm disabled:opacity-60"
            >
              {googleLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                  <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                </svg>
              )}
              Continue with Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-slate-600 text-xs">or</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="relative">
            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-violet-600 transition-colors"
            />
          </div>
          <div>
            <div className="relative">
              <AtSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                required
                value={handle}
                onChange={(e) => { setUsernameEdited(true); setUsername(e.target.value.replace(/^@/, '').toLowerCase()) }}
                placeholder="Username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={20}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-9 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-violet-600 transition-colors"
              />
              {validHandle && free === true && <Check size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600" />}
            </div>
            <p className={`text-[0.6875rem] mt-1 ml-1 ${handle && (!validHandle || free === false) ? 'text-red-600' : 'text-slate-500'}`}>
              {!handle ? 'Your profile link: tcghaven.org/u/yourname'
                : !validHandle ? '3–20 letters, numbers, _ or .'
                : free === false ? `@${validHandle} is taken`
                : free === true ? `tcghaven.org/u/${validHandle} is yours`
                : `Checking @${validHandle}…`}
            </p>
          </div>
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-violet-600 transition-colors"
            />
          </div>
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 6 characters)"
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-violet-600 transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-100/40 border border-red-200 rounded-xl px-3 py-2 text-xs">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-medium py-2.5 px-4 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Create Account
          </button>
            </form>
          </>
        )}

        <p className="text-center text-slate-500 text-xs mt-6">
          Already have an account?{' '}
          <Link href={`/login${nextQuery()}`} className="text-violet-600 hover:text-violet-700 transition-colors font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

