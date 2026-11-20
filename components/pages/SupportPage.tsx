'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Check, LifeBuoy, Loader2, Mail, SearchX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase/config'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from '@/components/friends/FriendsProvider'
import { inApp } from '@/lib/nativeApp'
import { GAME_LABELS, type Game } from '@/lib/types'
import { sendSupportRequest, SUPPORT_EMAIL, SUPPORT_LIMITS, SUPPORT_TOPICS, type SupportKind, type SupportTopic } from '@/lib/support'

// /support — the public help page (the App Store's support URL too). Two kinds of report: a card
// missing from the catalog, or help (account, a bug, billing, anything else). Saved for staff
// (lib/support.ts → the staff portal's Support tab). Signed out: sign in to send one, or email us.
// Links in can prefill it: ?type=missing&game=riftbound&q=Teemo (a Cardex / Add Card search that
// found nothing), ?type=help&topic=bug.

const GAMES = Object.keys(GAME_LABELS) as Game[]

export default function SupportPage() {
  const params = useSearchParams()
  const { user, loading } = useAuth()
  const { me } = useFriends()

  const [kind, setKind] = useState<SupportKind>(params.get('type') === 'help' ? 'general' : params.get('type') === 'missing' ? 'missing-card' : 'missing-card')
  const startGame = params.get('game') as Game | null
  const [game, setGame] = useState<Game>(startGame && GAMES.includes(startGame) ? startGame : 'pokemon')
  const [setName, setSetName] = useState('')
  const [cardName, setCardName] = useState(params.get('q') ?? '')
  const [number, setNumber] = useState('')
  const startTopic = params.get('topic') as SupportTopic | null
  const [topic, setTopic] = useState<SupportTopic>(startTopic && SUPPORT_TOPICS.some((t) => t.id === startTopic) ? startTopic : 'bug')
  const [message, setMessage] = useState('')
  const [emailEdit, setEmailEdit] = useState<string | null>(null)
  const email = emailEdit ?? user?.email ?? ''

  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = useMemo(() => {
    if (!user || !email.includes('@')) return false
    return kind === 'missing-card' ? cardName.trim().length > 0 : message.trim().length > 0
  }, [user, email, kind, cardName, message])

  async function send() {
    if (!user || !ready || sending) return
    setSending(true)
    setError(null)
    try {
      await sendSupportRequest(db, {
        kind, uid: user.uid, email, name: me?.displayName ?? user.displayName ?? '',
        message, platform: inApp() ? 'app' : 'web',
        ...(kind === 'missing-card' ? { game, setName, cardName, number } : { topic }),
        ...(params.get('from') ? { page: params.get('from')! } : {}),
      })
      setSent(true)
    } catch (e) {
      console.error(e)
      setError(`That didn’t send — try again, or email ${SUPPORT_EMAIL}.`)
    } finally {
      setSending(false)
    }
  }

  function another() {
    setSent(false); setSetName(''); setCardName(''); setNumber(''); setMessage('')
  }

  const field = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-slate-600'
  const label = 'block text-xs font-semibold text-slate-400 mb-1.5'

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><LifeBuoy size={22} className="text-slate-500" />Support</h1>
        <p className="text-slate-400 text-sm mt-1">Tell us about a card that’s missing, or get help with anything else. We read every message.</p>
      </div>

      {/* The two kinds of report */}
      <div className="grid grid-cols-2 gap-3 mb-5" role="radiogroup" aria-label="What's this about?">
        {([
          ['missing-card', SearchX, 'A card is missing', 'It’s not in the Cardex or Add Card search'],
          ['general', LifeBuoy, 'Help & bug reports', 'Your account, a bug, billing, anything else'],
        ] as const).map(([k, Icon, title, sub]) => (
          <button
            key={k}
            role="radio"
            aria-checked={kind === k}
            onClick={() => { setKind(k); setSent(false) }}
            className={cn('text-left rounded-2xl border p-4 transition-colors', kind === k ? 'bg-slate-800 border-slate-600' : 'bg-slate-900 border-slate-800 hover:border-slate-700')}
          >
            <Icon size={18} className={kind === k ? 'text-ink' : 'text-slate-500'} />
            <div className="mt-2 text-sm font-bold text-ink">{title}</div>
            <div className="text-xs text-slate-500 mt-0.5 leading-snug">{sub}</div>
          </button>
        ))}
      </div>

      <div className="card-glass p-5">
        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 size={20} className="animate-spin text-slate-500" /></div>
        ) : !user ? (
          // Signed out: reports come from an account (so staff can answer and spam stays out) — or email
          <div className="text-center py-6">
            <p className="text-sm text-ink font-semibold">Sign in to send us a report</p>
            <p className="text-xs text-slate-500 mt-1">So we know who to reply to and can look at your account if needed.</p>
            <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
              <Link href="/login?next=/support" className="btn-primary">Sign in</Link>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="btn-secondary"><Mail size={15} />{SUPPORT_EMAIL}</a>
            </div>
          </div>
        ) : sent ? (
          <div className="text-center py-6">
            <div className="mx-auto w-11 h-11 rounded-full bg-emerald-600 text-white flex items-center justify-center"><Check size={22} strokeWidth={3} /></div>
            <p className="text-sm text-ink font-semibold mt-3">Thanks — we’ve got it</p>
            <p className="text-xs text-slate-500 mt-1">{kind === 'missing-card' ? 'We’ll add the card to the catalog as soon as we can.' : <>We’ll reply to <span className="text-ink">{email}</span>.</>}</p>
            <button onClick={another} className="btn-secondary mt-4">Send another</button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void send() }} className="space-y-4">
            {kind === 'missing-card' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={label} htmlFor="s-game">Game</label>
                    <select id="s-game" value={game} onChange={(e) => setGame(e.target.value as Game)} className={field}>
                      {GAMES.map((g) => <option key={g} value={g}>{GAME_LABELS[g]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={label} htmlFor="s-set">Set</label>
                    <input id="s-set" value={setName} onChange={(e) => setSetName(e.target.value)} maxLength={SUPPORT_LIMITS.short} placeholder="e.g. Spiritforged" className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor="s-card">Card name <span className="text-red-500">*</span></label>
                    <input id="s-card" value={cardName} onChange={(e) => setCardName(e.target.value)} maxLength={SUPPORT_LIMITS.short} placeholder="e.g. Teemo, Swift Scout" className={field} required />
                  </div>
                  <div>
                    <label className={label} htmlFor="s-num">Card number</label>
                    <input id="s-num" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={SUPPORT_LIMITS.short} placeholder="e.g. 263a/298" className={field} />
                  </div>
                </div>
                <div>
                  <label className={label} htmlFor="s-note">Anything else? <span className="font-normal text-slate-500">(optional — a version, a promo, where it came from)</span></label>
                  <textarea id="s-note" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={SUPPORT_LIMITS.message} rows={3} className={field} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <span className={label}>Topic</span>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Topic">
                    {SUPPORT_TOPICS.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        role="radio"
                        aria-checked={topic === t.id}
                        onClick={() => setTopic(t.id)}
                        className={cn('text-left rounded-xl border px-3 py-2 transition-colors', topic === t.id ? 'bg-slate-800 border-slate-600' : 'bg-slate-950 border-slate-800 hover:border-slate-700')}
                      >
                        <div className="text-xs font-bold text-ink">{t.label}</div>
                        <div className="text-[0.6875rem] text-slate-500 leading-snug">{t.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={label} htmlFor="s-msg">What’s going on? <span className="text-red-500">*</span></label>
                  <textarea
                    id="s-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={SUPPORT_LIMITS.message} rows={6} required
                    placeholder={topic === 'bug' ? 'What you did, what you expected, and what happened instead. Which page, and phone or computer.' : 'Tell us as much as you can.'}
                    className={field}
                  />
                </div>
              </>
            )}
            <div>
              <label className={label} htmlFor="s-email">Reply to</label>
              <input id="s-email" type="email" value={email} onChange={(e) => setEmailEdit(e.target.value)} maxLength={SUPPORT_LIMITS.short} className={field} required />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-xs text-slate-500 hover:text-ink underline underline-offset-2">Prefer email? {SUPPORT_EMAIL}</a>
              <button type="submit" disabled={!ready || sending} className="btn-primary disabled:opacity-50">
                {sending && <Loader2 size={15} className="animate-spin" />}Send
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
