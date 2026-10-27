import dynamic from 'next/dynamic'

const PageContent = dynamic(() => import('@/components/pages/SoldPage'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="text-slate-600 text-sm">Loading…</div>
    </div>
  ),
})

// A wrapper rather than `export default PageContent`: Next passes every page its searchParams, and
// a lazy component forwarding them reads them — which makes Next render the page on the server
// for every request instead of serving a pre-built copy (each click waited ~1s on Vercel).
export default function Page() {
  return <PageContent />
}
