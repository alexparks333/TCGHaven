'use client'

import dynamic from 'next/dynamic'

const CommunityPage = dynamic(() => import('@/components/pages/CommunityPage'), { ssr: false })

// /c/{creatorUid} — a community's page (docs/creators.md "Communities")
export default function Page({ params }: { params: { uid: string } }) {
  return <CommunityPage uid={decodeURIComponent(params.uid)} />
}
