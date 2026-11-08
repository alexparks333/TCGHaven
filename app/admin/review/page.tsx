'use client'

import { NeedsReviewCard } from '@/components/admin/NeedsReview'
import { PlacementsReview } from '@/components/admin/PlacementsReview'

export default function Page() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Needs Review</h1>
        <p className="text-slate-400 text-sm mt-0.5">Sets and cards a sync found on its own, waiting for someone to confirm them.</p>
      </div>
      <div className="space-y-6">
        <PlacementsReview game="riftbound" />
        <PlacementsReview game="lorcana" />
        <PlacementsReview game="pokemon" />
        <PlacementsReview game="onepiece" />
        <div className="max-w-3xl">
          <NeedsReviewCard />
        </div>
      </div>
    </div>
  )
}
