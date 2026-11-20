import dynamic from 'next/dynamic'

const PageContent = dynamic(() => import('@/components/pages/SupportPage'), { ssr: false })
// A wrapper rather than `export default PageContent` (CLAUDE.md quirk 30): a lazy component
// forwarding Next's searchParams would make every visit render on the server.
export default function Page() {
  return <PageContent />
}
