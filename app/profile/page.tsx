'use client'

import dynamic from 'next/dynamic'

const ProfilePage = dynamic(() => import('@/components/pages/ProfilePage'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="text-slate-600 text-sm">Loading…</div>
    </div>
  ),
})

export default function Page() {
  return <ProfilePage />
}
