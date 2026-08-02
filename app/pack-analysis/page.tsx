import dynamic from 'next/dynamic'

const Page = dynamic(() => import('@/components/pages/PackAnalysisPage'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-64"><div className="text-slate-600 text-sm">Loading…</div></div>,
})

export default Page
