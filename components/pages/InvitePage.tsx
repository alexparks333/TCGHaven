'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus, Link2Off } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { resolveInviteCode, getProfile, profilePath } from '@/lib/firebase/friends'

// /invite/{code} — an old-style invite link. These used to make you friends the moment you
// opened them; now they just open that person's Haven, where you can add them like anyone else
// (they get a request to accept). New links are the Haven link itself (/u/{username}).
export default function InvitePage({ code }: { code: string }) {
  return (
    <AuthGuard>
      <InviteRedirect code={code} />
    </AuthGuard>
  )
}

function InviteRedirect({ code }: { code: string }) {
  const router = useRouter()
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    resolveInviteCode(code)
      .then((uid) => (uid ? getProfile(uid) : null))
      .then((p) => {
        if (!live) return
        if (p) router.replace(profilePath(p.uid, p.username))
        else setMissing(true)
      })
      .catch(() => { if (live) setMissing(true) })
    return () => { live = false }
  }, [code, router])

  if (!missing) {
    return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
  }
  return (
    <div className="min-h-[60dvh] flex items-center justify-center">
      <div className="card-glass w-full max-w-sm px-6 py-10 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400"><Link2Off size={28} /></div>
        <h1 className="text-xl font-bold text-ink mt-4">This invite link doesn&rsquo;t work anymore</h1>
        <p className="text-sm text-slate-500 mt-1.5">Ask your friend for their Haven link, or find them by name.</p>
        <Link href="/friends?add=1" className="btn-primary w-fit mx-auto mt-6"><UserPlus size={15} />Find friends</Link>
      </div>
    </div>
  )
}
