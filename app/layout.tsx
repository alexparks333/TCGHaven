import type { Metadata, Viewport } from 'next'
import { Inter, Cinzel, Playfair_Display, Cormorant_Garamond, Uncial_Antiqua, Pirata_One, Bebas_Neue, Special_Elite, Caveat } from 'next/font/google'
import dynamic from 'next/dynamic'
import './globals.css'

const ClientWrapper = dynamic(
  () => import('@/components/layout/ClientWrapper'),
  { ssr: false }
)

const inter = Inter({ subsets: ['latin'] })
// Engraved lettering in the Haven Badges pin books (page titles, nameplates — .pinbook-serif)
const cinzel = Cinzel({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-engraved', display: 'swap' })
// Fonts a creator can pick for a community page block (lib/blockStyle.ts BLOCK_FONTS). Not preloaded:
// the browser only downloads one when a page actually uses it.
const playfair = Playfair_Display({ subsets: ['latin'], display: 'swap', preload: false, weight: ['600', '700'], variable: '--font-playfair' })
const cormorant = Cormorant_Garamond({ subsets: ['latin'], display: 'swap', preload: false, weight: ['500', '700'], variable: '--font-cormorant' })
const uncial = Uncial_Antiqua({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--font-uncial' })
const pirata = Pirata_One({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--font-pirata' })
const bebas = Bebas_Neue({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--font-bebas' })
const elite = Special_Elite({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--font-elite' })
// Caveat is a variable font: asked for as one (no weights). Asking for 500 + 700 together makes Google answer with a
// font file address the production build can't read ("An error occurred in `next/font`") — the dev server doesn't mind.
const caveat = Caveat({ subsets: ['latin'], display: 'swap', preload: false, variable: '--font-caveat' })
const blockFonts = [playfair, cormorant, uncial, pirata, bebas, elite, caveat].map((f) => f.variable).join(' ')

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
      </head>
      <body className={`${inter.className} ${cinzel.variable} ${blockFonts}`}>
        <ClientWrapper>{children}</ClientWrapper>
      </body>
    </html>
  )
}
