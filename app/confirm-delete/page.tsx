import dynamic from 'next/dynamic'

// The emailed link for deleting an account lands here (components/account/DeleteAccount.tsx)
const PageContent = dynamic(() => import('@/components/account/DeleteAccount').then((m) => m.ConfirmDelete), { ssr: false })
// A wrapper rather than `export default PageContent` (CLAUDE.md rule 30)
export default function Page() {
  return <PageContent />
}
