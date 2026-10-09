'use client'

import { CatalogBrowser } from '@/components/pages/AdminCatalogPage'

export default function Page() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Catalog</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          The shared card catalog every collector&apos;s app reads from — edits here apply immediately for everyone.
        </p>
      </div>
      <CatalogBrowser />
    </div>
  )
}
