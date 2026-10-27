'use client'

import dynamic from 'next/dynamic'

const ProfilePage = dynamic(() => import('@/components/pages/ProfilePage'), { ssr: false })

// /u/{username} — a profile's shareable address
export default function Page({ params }: { params: { username: string } }) {
  return <ProfilePage username={decodeURIComponent(params.username)} />
}
