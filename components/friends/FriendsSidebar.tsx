'use client'

import { usePathname, useRouter } from 'next/navigation'
import { UserPlus, Users, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFriends, type FriendsTab } from './FriendsProvider'
import { Avatar } from './Avatar'

const SHOWN = 4

// The Friends card at the bottom of the desktop sidebar, just above the account box. Two ways in:
// anything inside it (invite, ➕, requests, a friend) opens the quick Friends popup
// (FriendsDialog); the card itself — its header or the space around those — goes to the full
// /friends page.
export function FriendsSidebarSection() {
  const { friends, incoming, ready, openFriends } = useFriends()
  const router = useRouter()
  const onPage = usePathname() === '/friends'
  const shown = friends.slice(0, SHOWN)

  // Inner controls open the popup without also triggering the card's own navigation.
  const popup = (tab: FriendsTab, focus?: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    openFriends(tab, focus)
  }

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label="Open the Friends page"
      onClick={() => router.push('/friends')}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) router.push('/friends') }}
      className={cn(
        'mb-2.5 rounded-xl bg-slate-900/50 border overflow-hidden transition-colors cursor-pointer group/card',
        onPage ? 'border-slate-600' : 'border-slate-800 hover:border-slate-700',
      )}
    >
      <div className="flex items-center gap-2 pl-3 pr-1.5 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Users size={14} className="text-slate-400 group-hover/card:text-ink transition-colors" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 group-hover/card:text-ink transition-colors">Friends</span>
          {friends.length > 0 && (
            <span className="text-[10px] font-bold text-slate-500 bg-slate-800/80 px-1.5 py-0.5 rounded-full leading-none">{friends.length}</span>
          )}
          <ChevronRight size={12} className="text-slate-500 opacity-0 -translate-x-1 group-hover/card:opacity-100 group-hover/card:translate-x-0 transition-all" />
        </div>
        <button
          onClick={popup('add')}
          title="Add a friend"
          aria-label="Add a friend"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800 transition-colors"
        >
          <UserPlus size={15} />
        </button>
      </div>

      {incoming.length > 0 && (
        <button
          onClick={popup('requests')}
          className="mx-2 mb-1.5 w-[calc(100%-16px)] flex items-center gap-2 px-2 py-1.5 rounded-lg bg-violet-600/10 border border-violet-600/30 hover:bg-violet-600/15 transition-colors text-left"
        >
          <div className="flex -space-x-2">
            {incoming.slice(0, 3).map((e) => (
              <Avatar key={e.uid} seed={e.uid} name={e.profile?.displayName ?? ''} photoURL={e.profile?.photoURL} size={20} ring />
            ))}
          </div>
          <span className="text-xs font-semibold text-violet-700 flex-1 min-w-0 truncate">
            {incoming.length === 1 ? '1 friend request' : `${incoming.length} friend requests`}
          </span>
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
        </button>
      )}

      {!ready ? (
        <div className="px-3 pb-3 flex gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="w-7 h-7 rounded-full bg-slate-800 animate-pulse" />)}
        </div>
      ) : friends.length === 0 ? (
        <button
          onClick={popup('add')}
          className="mx-2 mb-2 w-[calc(100%-16px)] flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-dashed border-slate-700 hover:border-violet-600 hover:bg-slate-800/40 transition-colors text-left group"
        >
          <span className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 group-hover:text-violet-600 transition-colors shrink-0">
            <UserPlus size={14} />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-ink">Invite your friends</span>
            <span className="block text-[10px] text-slate-500">Collecting is better together</span>
          </span>
        </button>
      ) : (
        <div className="px-1.5 pb-1.5">
          {shown.map((e) => (
            <button
              key={e.uid}
              onClick={popup('friends', e.uid)}
              className="w-full flex items-center gap-2.5 px-1.5 py-1 rounded-lg hover:bg-slate-800/60 transition-colors text-left"
            >
              <Avatar seed={e.uid} name={e.profile?.displayName ?? ''} photoURL={e.profile?.photoURL} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-ink truncate">{e.profile?.displayName ?? '…'}</span>
                {e.profile?.username && <span className="block text-[10px] text-slate-500 truncate leading-tight">@{e.profile.username}</span>}
              </span>
            </button>
          ))}
          {friends.length > SHOWN && (
            <div className="w-full flex items-center justify-center gap-1 mt-0.5 py-1 rounded-lg text-[11px] font-semibold text-slate-500 group-hover/card:text-ink transition-colors">
              See all {friends.length}
              <ChevronRight size={12} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
