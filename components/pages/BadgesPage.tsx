'use client'

import { Loader2 } from 'lucide-react'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { useAuth } from '@/components/auth/AuthProvider'
import { useFriends } from '@/components/friends/FriendsProvider'
import { BadgeLibrary } from '@/components/badges/BadgeLibrary'
import { ExtraBooksProvider } from '@/lib/badgeCatalog'
import { useJoinedCreatorBooks } from '@/lib/creatorShelf'

// /badges — your Haven Badges pin book, filling the page (lib/badges.ts, components/badges/), with the
// books of the communities you've joined on the shelf too (lib/creatorShelf.ts).
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
  // The books of the communities you've joined sit on your shelf too, each its own collection
  const { catalog: joined } = useJoinedCreatorBooks(user?.uid)
  return (
    <ExtraBooksProvider books={joined}>
    <div>
      {/* No page heading — the book gets the room (the sidebar already says where you are) */}
      {myBadges ? (
        <BadgeLibrary full ownerName={me?.displayName ?? user?.displayName ?? 'You'} badges={myBadges} isMe />
      ) : (
        <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-slate-500" /></div>
      )}
    </div>
    </ExtraBooksProvider>
  )
}
