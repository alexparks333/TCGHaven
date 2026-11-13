import type { Metadata, Viewport } from 'next'
import { Inter, Cinzel } from 'next/font/google'
import dynamic from 'next/dynamic'
import './globals.css'

const ClientWrapper = dynamic(
  () => import('@/components/layout/ClientWrapper'),
  { ssr: false }
)

const inter = Inter({ subsets: ['latin'] })
// Engraved lettering in the Haven Badges pin books (page titles, nameplates — .pinbook-serif)
const cinzel = Cinzel({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-engraved', display: 'swap' })
// The fonts a creator can pick for community blocks and wall notes (lib/blockStyle.ts BLOCK_FONTS, WallNote) come from
// Google Fonts as a stylesheet in the page (below; their --font-* names are in globals.css), not next/font: next/font
// downloads every font while building, and Google sometimes answers with a font file address it can't read
// ("An error occurred in `next/font`"), failing the production build at random. The browser only downloads a font
// when a page actually uses it.
const BLOCK_FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Cormorant+Garamond:wght@500;700&family=Uncial+Antiqua&family=Pirata+One&family=Bebas+Neue&family=Special+Elite&family=Caveat:wght@400..700&display=swap'

export const metadata: Metadata = {
  title: 'TCGHaven',
  description: 'Your personal TCG collection manager',
  manifest: '/manifest.json',
  appleWebApp: { statusBarStyle: 'black-translucent', title: 'TCGHaven' },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the page use the full screen behind the iPhone notch/home bar; the mobile header and
  // bottom nav pad themselves with env(safe-area-inset-*) so nothing ends up under them.
  viewportFit: 'cover',
  themeColor: '#d9c6a0',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* LogoLoader (components/LogoLoader.tsx) is the app's loading screen — fetched up front
            so the logo is already there the first time a loader appears, not drawn in late. */}
        <link rel="preload" as="image" href="/logo.png" />
        <link rel="preload" as="image" href="/logo-text.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={BLOCK_FONTS_CSS} />
      </head>
      <body className={`${inter.className} ${cinzel.variable}`}>
        <ClientWrapper>{children}</ClientWrapper>
      </body>
    </html>
  )
}
