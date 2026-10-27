'use client'

import dynamic from 'next/dynamic'

const InvitePage = dynamic(() => import('@/components/pages/InvitePage'), { ssr: false })

export default function Page({ params }: { params: { code: string } }) {
  return <InvitePage code={params.code} />
}
