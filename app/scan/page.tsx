import dynamic from 'next/dynamic'

// Where the website's "Scan with your phone" QR code points (ScanFromPhoneDialog): opens the
// TCGHaven app's card scanner. docs/card-scanner.md "Scanning from the website".
const PageContent = dynamic(() => import('@/components/pages/ScanLinkPage'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-64"><div className="text-slate-600 text-sm">Opening the scanner…</div></div>,
})

// A wrapper, not `export default PageContent` (CLAUDE.md rule 30)
export default function Page() {
  return <PageContent />
}
