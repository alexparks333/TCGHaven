'use client'

import { Loader2, Wand2, Users, Award, Megaphone, PauseCircle } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useAccountRole, isCreator } from '@/lib/accountRoles'

// /creator — the Creator Studio, only for accounts staff have made a Creator (lib/accountRoles.ts).
// The tools are being built; for now this is their home and what's coming.
export default function CreatorPage() {
  return (
    <AuthGuard>
      <Body />
    </AuthGuard>
  )
}

const TOOLS = [
  { icon: Users, title: 'Your community', text: 'A page people can follow, with your news and everything you make.' },
  { icon: Award, title: 'Your badge books', text: 'Design your own Haven Badges for your followers to collect and earn.' },
  { icon: Megaphone, title: 'Followers', text: 'See who follows you and how they’re doing on your badges.' },
]

function Body() {
  const { user } = useAuth()
  const { record, loaded } = useAccountRole(user?.uid)

  if (!loaded) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>

  if (!isCreator(record)) {
    return (
      <div className="card-glass max-w-lg mx-auto mt-10 p-6 text-center">
        <PauseCircle size={32} className="mx-auto text-slate-500 mb-3" />
        <h1 className="text-lg font-bold text-ink">{record.suspended ? 'Your Creator Studio is suspended' : record.formerCreator ? 'Your Creator Studio is paused' : 'Creator Studio'}</h1>
        <p className="text-sm text-slate-400 mt-2">
          {record.suspended || record.formerCreator
            ? 'Your Creator status is off for now, so your community and badges are hidden. Nothing has been deleted — it all comes back if your status is restored.'
            : 'The Creator Studio is for TCG Haven creators.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-violet-600/15 text-violet-700 flex items-center justify-center"><Wand2 size={22} /></span>
        <div>
          <h1 className="text-2xl font-bold text-ink">Creator Studio</h1>
          <p className="text-sm text-slate-500">Creator since {record.creatorSince ? new Date(record.creatorSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'today'} · Premium included</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card-glass p-5">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={17} className="text-violet-600" />
              <span className="font-bold text-ink">{title}</span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-500">Coming soon</span>
            </div>
            <p className="text-sm text-slate-400">{text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
