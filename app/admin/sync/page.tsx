'use client'

import { SyncPanel } from '@/components/pages/AdminCatalogPage'

export default function Page() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Sync</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Pull fresh card data and prices from each game&apos;s sources. Prices also sync automatically 4 times a day.
        </p>
      </div>
      <SyncPanel />
    </div>
  )
}
