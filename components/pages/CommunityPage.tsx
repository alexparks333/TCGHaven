'use client'

// /c/{uid} — a community: the creator's banner, name, tagline and about; Join / Leave and the member
// count; the creator; and their Creator Book — its cover, opened into the real pin book. Shown only
// while its creator can still run one (lib/communities.ts getCommunity). docs/creators.md.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Users, Check, LogOut, BookOpen, X, Sparkles, Wand2 } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { Avatar } from '@/components/friends/Avatar'
import { getProfile, profilePath, type Profile } from '@/lib/firebase/friends'
import { getCommunity, joinCommunity, leaveCommunity, memberCount, useMyCommunities, type CommunityEntry } from '@/lib/communities'
import { useCreatorBook } from '@/lib/creatorBooks'
import { BookCover, BookThickness } from '@/components/badges/BadgeLibrary'
import { BadgeBook } from '@/components/badges/BadgeBook'
import { useScrollLock } from '@/lib/useScrollLock'
import { GAME_COLORS, GAME_LABELS } from '@/lib/types'

export default function CommunityPage({ uid }: { uid: string }) {
  return (
    <AuthGuard>
      <Body uid={uid} />
    </AuthGuard>
  )
}

function Body({ uid }: { uid: string }) {
  const { user } = useAuth()
  const [community, setCommunity] = useState<CommunityEntry | null | undefined>(undefined)
  const [creator, setCreator] = useState<Profile | null>(null)
  const [members, setMembers] = useState<number | null>(null)
  const { joined } = useMyCommunities(user?.uid)
  const isMember = joined.has(uid)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { book } = useCreatorBook(community ? uid : null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getCommunity(uid).then(setCommunity).catch(() => setCommunity(null))
    getProfile(uid).then(setCreator).catch(() => {})
  }, [uid])
  useEffect(() => { memberCount(uid).then(setMembers).catch(() => {}) }, [uid, isMember])

  if (community === undefined) return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
  if (!community) {
    return (
      <div className="card-glass max-w-md mx-auto mt-10 p-6 text-center">
        <Users size={30} className="mx-auto text-slate-500 mb-3" />
        <h1 className="text-lg font-bold text-ink">Community not found</h1>
        <p className="text-sm text-slate-400 mt-1">It may have been renamed or isn&rsquo;t available right now.</p>
        <Link href="/friends" className="btn-secondary w-fit mx-auto mt-5">Find communities</Link>
      </div>
    )
  }

  const mine = user?.uid === uid
  async function toggle() {
    if (!user) return
    setBusy(true); setError('')
    try {
      if (isMember) await leaveCommunity(user.uid, uid)
      else await joinCommunity(user.uid, uid)
    } catch (e) {
      setError('Couldn’t ' + (isMember ? 'leave' : 'join') + ' — ' + (e instanceof Error ? e.message : String(e)))
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Banner + who it is */}
      <div className="card-glass overflow-hidden">
        <div className="h-40 md:h-52 relative" style={{ background: `linear-gradient(135deg, ${community.color}, #0b0b12)` }}>
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.35) 0, transparent 40%), radial-gradient(circle at 85% 70%, rgba(255,255,255,0.18) 0, transparent 35%)' }} />
        </div>
        <div className="px-5 md:px-8 pb-6 -mt-12 relative flex flex-col md:flex-row md:items-end gap-4">
          <div className="w-24 h-24 rounded-3xl border-4 border-[#f3e9d3] shadow-lg flex items-center justify-center text-4xl font-black text-white shrink-0" style={{ background: community.color }}>
            {(community.name.trim()[0] || '★').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl md:text-3xl font-bold text-ink leading-tight">{community.name}</h1>
            {community.tagline && <p className="text-sm text-slate-500 mt-1">{community.tagline}</p>}
            {(community.games?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {community.games!.map((g) => <span key={g} className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: GAME_COLORS[g] }}>{GAME_LABELS[g]}</span>)}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              <span className="flex items-center gap-1.5"><Users size={14} /><b className="text-ink">{members ?? '–'}</b> {members === 1 ? 'member' : 'members'}</span>
              {creator && (
                <Link href={profilePath(uid, creator.username)} className="flex items-center gap-1.5 hover:text-ink">
                  <Avatar seed={uid} name={creator.displayName} photoURL={creator.photoURL} size={20} />by {creator.displayName}
                </Link>
              )}
            </div>
          </div>
          <div className="shrink-0">
            {mine ? (
              <Link href="/creator" className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink"><Wand2 size={15} />Edit in Creator Studio</Link>
            ) : (
              <button type="button" onClick={toggle} disabled={busy}
                className={isMember ? 'group btn-secondary !bg-slate-950 border border-slate-700 !text-ink' : 'btn-primary px-6'}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : isMember ? <><Check size={16} className="group-hover:hidden" /><LogOut size={16} className="hidden group-hover:block" /></> : <Sparkles size={16} />}
                {isMember ? <><span className="group-hover:hidden">Joined</span><span className="hidden group-hover:inline">Leave</span></> : 'Join community'}
              </button>
            )}
          </div>
        </div>
        {error && <p className="px-8 pb-4 text-xs text-red-600">{error}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        {/* Their Creator Book */}
        <section className="card-glass p-5 md:p-6">
          <h2 className="text-base font-bold text-ink flex items-center gap-2"><BookOpen size={16} className="text-slate-400" />Creator Book</h2>
          {book ? (
            <div className="mt-4 flex flex-col sm:flex-row items-center gap-6">
              <button type="button" onClick={() => setOpen(true)} className="relative w-[200px] aspect-[0.71] shrink-0 transition-transform hover:-translate-y-1" style={{ containerType: 'inline-size' }} aria-label={`Open ${book.book.name}`}>
                <BookThickness look={book.book.coverStyle} />
                <span className="absolute inset-0"><BookCover set={book.book} badges={null} defs={book.badges} /></span>
              </button>
              <div className="text-center sm:text-left">
                <p className="text-xl font-bold text-ink">{book.book.name}</p>
                <p className="text-sm text-slate-500 mt-1">{book.badges.length} badge{book.badges.length === 1 ? '' : 's'} to collect</p>
                <p className="text-sm text-slate-400 mt-3 max-w-sm">
                  {isMember || mine ? 'Collect the cards to earn these pins — your progress shows in your pin book.' : 'Join to collect these pins — they’ll show up in your own pin book as you earn them.'}
                </p>
                <button type="button" onClick={() => setOpen(true)} className="btn-primary mt-4"><BookOpen size={15} />Open the book</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 mt-3">{community.name} hasn&rsquo;t made their book yet.</p>
          )}
        </section>

        <aside className="card-glass p-5">
          <h2 className="text-base font-bold text-ink mb-2">About</h2>
          <p className="text-sm text-slate-400 whitespace-pre-line">{community.about || 'No description yet.'}</p>
        </aside>
      </div>

      {open && book && <BookViewer book={book.book} defs={book.badges} onClose={() => setOpen(false)} />}
    </div>
  )
}

function BookViewer({ book, defs, onClose }: { book: Parameters<typeof BadgeBook>[0]['set']; defs: Parameters<typeof BookCover>[0]['defs']; onClose: () => void }) {
  useScrollLock(true)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-5 py-3 text-white">
        <BookOpen size={18} />
        <p className="font-bold truncate">{book.name}</p>
        <button type="button" onClick={onClose} className="ml-auto p-2 rounded-full bg-white/10 hover:bg-white/20" aria-label="Close"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-6 flex items-start justify-center">
        <div className="w-full max-w-[1100px]"><BadgeBook set={book} defs={defs} badges={null} isMe={false} /></div>
      </div>
    </div>
  )
}
