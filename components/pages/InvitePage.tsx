'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, UserPlus, Link2Off, PartyPopper } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from '@/components/friends/FriendsProvider'
import { Avatar } from '@/components/friends/Avatar'
import { resolveInviteCode, getProfile, acceptInvite, type Profile } from '@/lib/firebase/friends'

// /invite/{code} — where someone's invite link lands. One tap and you're friends.
export default function InvitePage({ code }: { code: string }) {
  return (
    <AuthGuard>
      <InviteBody code={code} />
    </AuthGuard>
  )
}

function InviteBody({ code }: { code: string }) {
  const { user } = useAuth()
  const { byUid, ready } = useFriends()
  const [inviter, setInviter] = useState<Profile | null | undefined>(undefined)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    resolveInviteCode(code)
      .then((uid) => (uid ? getProfile(uid) : null))
      .then((p) => { if (live) setInviter(p) })
      .catch(() => { if (live) setInviter(null) })
    return () => { live = false }
  }, [code])

  if (inviter === undefined || !ready) {
    return <Shell><Loader2 size={28} className="animate-spin text-slate-500 mx-auto" /></Shell>
  }

  if (inviter === null) {
    return (
      <Shell>
        <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400"><Link2Off size={28} /></div>
        <h1 className="text-xl font-bold text-ink mt-4">This invite link doesn&rsquo;t work anymore</h1>
        <p className="text-sm text-slate-500 mt-1.5">Ask your friend for a fresh one, or find them by name.</p>
        <Link href="/friends?add=1" className="btn-primary w-fit mx-auto mt-6"><UserPlus size={15} />Find friends</Link>
      </Shell>
    )
  }

  const first = inviter.displayName.split(' ')[0]
  const isMe = inviter.uid === user?.uid
  const existing = byUid.get(inviter.uid)
  const friends = existing?.status === 'accepted'

  async function join() {
    if (!user || !inviter) return
    setJoining(true); setError('')
    try {
      await acceptInvite(user.uid, inviter.uid, code, existing)
    } catch (e) {
      console.error(e)
      setError('Couldn’t add them — please try again.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <Shell>
      <div className="relative w-fit mx-auto">
        <Avatar seed={inviter.uid} name={inviter.displayName} photoURL={inviter.photoURL} size={96} className="shadow-lg ring-4 ring-slate-900" />
        {friends && (
          <span className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center ring-4 ring-slate-900">
            <Check size={18} strokeWidth={3} />
          </span>
        )}
      </div>
      <h1 className="text-2xl font-bold text-ink mt-5">{inviter.displayName}</h1>
      <div className="text-sm text-slate-500">@{inviter.username}</div>

      {isMe ? (
        <>
          <p className="text-sm text-slate-400 mt-5">This is your own invite link. Send it to a friend and you&rsquo;ll be friends as soon as they open it.</p>
          <Link href="/friends" className="btn-secondary w-fit mx-auto mt-6">Go to Friends</Link>
        </>
      ) : friends ? (
        <>
          <div className="flex items-center justify-center gap-2 text-emerald-600 font-semibold mt-5"><PartyPopper size={18} />You and {first} are friends!</div>
          <div className="flex items-center justify-center gap-2 mt-6">
            <Link href={`/friends?focus=${inviter.uid}`} className="btn-secondary">See friends</Link>
            <Link href="/" className="btn-primary">Go to my collection</Link>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-400 mt-5">{first} invited you to be friends on TCGHaven.</p>
          <button onClick={join} disabled={joining} className="btn-primary mx-auto mt-6 px-6 py-2.5 text-[15px] disabled:opacity-60">
            {joining ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            Add {first} as a friend
          </button>
          {error && <div className="text-xs text-red-600 mt-3">{error}</div>}
        </>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60dvh] flex items-center justify-center">
      <div className="card-glass w-full max-w-sm px-6 py-10 text-center">{children}</div>
    </div>
  )
}
