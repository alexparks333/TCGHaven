'use client'

import { useState } from 'react'
import { BookOpen, Award, TrendingUp, Globe, Users, Lock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { updateProfileDetails, type Profile, type ProfilePrivacy } from '@/lib/firebase/friends'

// Who can see your Cardex and Badges — Settings → Profile Settings (2026-11-24; it used to be a box
// in your profile header). Everyone = any collector; Friends = only the friends you've added and
// accepted. Portfolio is only ever yours.
export function PrivacySettings({ profile, onSaved, row }: { profile: Profile; onSaved: (p: Profile) => void; row: string }) {
  const [saving, setSaving] = useState<keyof ProfilePrivacy | null>(null)
  const [error, setError] = useState('')

  async function choose(key: keyof ProfilePrivacy, everyone: boolean) {
    if (profile.privacy[key] === everyone) return
    const privacy = { ...profile.privacy, [key]: everyone }
    setSaving(key); setError('')
    try {
      await updateProfileDetails(profile.uid, { privacy })
      onSaved({ ...profile, privacy })
    } catch (e) {
      console.error(e); setError('Couldn’t save — please try again.')
    } finally { setSaving(null) }
  }

  const rows: { key: keyof ProfilePrivacy; icon: typeof Award; label: string }[] = [
    { key: 'cardex', icon: BookOpen, label: 'Cardex' },
    { key: 'badges', icon: Award, label: 'Badges' },
    { key: 'friends', icon: Users, label: 'Friends list' },
  ]
  const seg = 'w-[9.5rem] shrink-0'

  return (
    <section>
      <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">Who can see it</div>
      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800">
        {rows.map(({ key, icon: Icon, label }) => {
          const everyone = profile.privacy[key]
          const opt = (value: boolean, I: typeof Globe, name: string) => (
            <button type="button" role="radio" aria-checked={everyone === value} aria-label={`${label}: ${name}`}
              onClick={() => choose(key, value)} disabled={saving === key}
              className={cn('flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-bold leading-none whitespace-nowrap transition-colors',
                everyone === value ? 'bg-[#7a5230] text-[#fbf6ea]' : 'text-slate-500 hover:text-ink')}>
              {saving === key && everyone !== value ? <Loader2 size={12} className="animate-spin" /> : <I size={12} />}{name}
            </button>
          )
          return (
            <div key={key} className={row}>
              <Icon size={16} className="text-slate-500 shrink-0" />
              <span className="text-sm text-slate-400 flex-1 min-w-0">{label}</span>
              <span role="radiogroup" aria-label={`Who can see your ${label}`} className={cn(seg, 'grid grid-cols-2 rounded-lg border border-[#d6c49f] overflow-hidden bg-[#f6eedb] [&>button+button]:border-l [&>button+button]:border-[#d6c49f]')}>
                {opt(true, Globe, 'Everyone')}
                {opt(false, Users, 'Friends')}
              </span>
            </div>
          )
        })}
        <div className={row}>
          <TrendingUp size={16} className="text-slate-500 shrink-0" />
          <span className="text-sm text-slate-400 flex-1 min-w-0">Portfolio</span>
          <span className={cn(seg, 'flex items-center justify-center gap-1 rounded-lg border border-dashed border-[#d6c49f] py-1.5 text-xs font-bold leading-none text-slate-500')}><Lock size={12} />Only you</span>
        </div>
      </div>
      <p className="text-[0.6875rem] text-slate-500 mt-1.5 px-1">
        Everyone = any collector; Friends = only the friends you’ve added and accepted. Your Cardex shows which cards you own and
        what they’re worth — never what you paid. Your friends list lets people find and add your friends. Your values and P&amp;L are only ever for you.
      </p>
      {error && <div className="text-[0.6875rem] text-red-600 mt-1 px-1">{error}</div>}
    </section>
  )
}
