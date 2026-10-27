'use client'

import dynamic from 'next/dynamic'

const ProfilePage = dynamic(() => import('@/components/pages/ProfilePage'), { ssr: false })

export default function Page({ params }: { params: { uid: string } }) {
  return <ProfilePage uid={params.uid} />
}
