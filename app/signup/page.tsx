import dynamic from 'next/dynamic'

const PageContent = dynamic(() => import('@/components/pages/SignupPage'), { ssr: false })
// A wrapper rather than `export default PageContent`: Next passes every page its searchParams, and
// a lazy component forwarding them reads them — which makes Next render the page on the server
// for every request instead of serving a pre-built copy (each click waited ~1s on Vercel).
export default function Page() {
  return <PageContent />
}
