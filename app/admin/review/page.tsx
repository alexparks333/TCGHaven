'use client'

import { NeedsReviewCard } from '@/components/admin/NeedsReview'

export default function Page() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Needs Review</h1>
        <p className="text-slate-400 text-sm mt-0.5">Sets a sync found on its own, waiting for someone to confirm their details.</p>
      </div>
      <NeedsReviewCard />
    </div>
  )
}
