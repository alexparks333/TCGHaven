import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import dynamic from 'next/dynamic'
import './globals.css'

const ClientWrapper = dynamic(
  () => import('@/components/layout/ClientWrapper'),
  { ssr: false }
)

const inter = Inter({ subsets: ['latin'] })

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
      <body className={inter.className}>
        <ClientWrapper>{children}</ClientWrapper>
      </body>
    </html>
  )
}
