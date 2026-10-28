'use client'

import { Loader2 } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from '@/components/friends/FriendsProvider'
import { BadgeLibrary } from '@/components/badges/BadgeLibrary'

// /badges — your Haven Badges pin book, filling the page (lib/badges.ts, components/badges/).
export default function BadgesPage() {
  return (
    <AuthGuard>
      <Body />
    </AuthGuard>
  )
}

function Body() {
  const { user } = useAuth()
  const { me, myBadges } = useFriends()
  return (
    <div>
      {/* No page heading — the book gets the room (the sidebar already says where you are) */}
      {myBadges ? (
        <BadgeLibrary full ownerName={me?.displayName ?? user?.displayName ?? 'You'} badges={myBadges} isMe />
      ) : (
        <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
      )}
    </div>
  )
}
