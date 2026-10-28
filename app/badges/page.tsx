import dynamic from 'next/dynamic'

const PageContent = dynamic(() => import('@/components/pages/BadgesPage'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="text-slate-600 text-sm">Loading…</div>
    </div>
  ),
})

// A wrapper, not `export default PageContent` — see CLAUDE.md quirk #30.
export default function Page() {
  return <PageContent />
}
