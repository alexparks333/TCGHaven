import { Suspense } from 'react'
import dynamic from 'next/dynamic'

const AnalyticsPage = dynamic(
  () => import('@/components/portfolio/PortfolioAnalyticsPage'),
  { ssr: false }
)

const fallback = (
  <div className="flex items-center justify-center h-64">
    <div className="text-slate-600 text-sm">Loading…</div>
  </div>
)

export default function Page() {
  return (
    <Suspense fallback={fallback}>
      <AnalyticsPage />
    </Suspense>
  )
}
