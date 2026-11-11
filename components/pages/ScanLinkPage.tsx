'use client'

// /scan — the page the website's "Scan with your phone" QR code opens on the phone.
//   • In the TCGHaven app: straight to the scanner (/inventory?scan=1).
//   • On an iPhone: hands over to the app (tcghaven://scan — the app's URL scheme, ios/App/App/Info.plist),
//     with a button for when iOS asks first, and the App Store for people without the app.
//   • On Android: an intent link — opens the app if it's installed, else Google Play.
//   • On a computer: says to scan the code with a phone instead.
// docs/card-scanner.md "Scanning from the website".

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ScanLine, Smartphone } from 'lucide-react'
import { inApp } from '@/lib/nativeApp'
import { APP_STORE_URL, PLAY_STORE_URL, ANDROID_PACKAGE, phoneKind, type PhoneKind } from '@/lib/appLinks'

const APP_LINK = 'tcghaven://scan'
// Android's own way to open an app from a web page: the app if installed, else the fallback page
const ANDROID_LINK = `intent://scan#Intent;scheme=tcghaven;package=${ANDROID_PACKAGE};${PLAY_STORE_URL ? `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};` : ''}end`

export default function ScanLinkPage() {
  const router = useRouter()
  const [where, setWhere] = useState<'app' | 'phone' | 'computer' | null>(null)
  const [kind, setKind] = useState<PhoneKind>(null)

  useEffect(() => {
    if (inApp()) {
      setWhere('app')
      router.replace('/inventory?scan=1')
      return
    }
    const k = phoneKind()
    setKind(k)
    setWhere(k ? 'phone' : 'computer')
    if (k) window.location.href = k === 'android' ? ANDROID_LINK : APP_LINK
  }, [router])

  return (
    <div className="min-h-[70dvh] flex items-center justify-center px-5">
      <div className="card-glass rounded-2xl w-full max-w-[420px] p-6 text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-violet-600 text-white flex items-center justify-center">
          <ScanLine size={28} />
        </div>
        <h1 className="mt-4 text-xl font-bold text-ink">Scan cards with your phone</h1>
        {where === 'app' && <p className="mt-2 text-sm text-slate-400">Opening the scanner…</p>}
        {where === 'phone' && (
          <>
            <p className="mt-2 text-sm text-slate-400">The card scanner is in the TCGHaven app. If it didn’t open, tap below.</p>
            <a href={kind === 'android' ? ANDROID_LINK : APP_LINK} className="btn-primary w-full justify-center py-3 mt-5 text-base">
              <Smartphone size={18} />
              Open the scanner in the app
            </a>
            {/* No app yet: this phone's own store */}
            {(() => {
              const store = kind === 'android' ? PLAY_STORE_URL : APP_STORE_URL
              const name = kind === 'android' ? 'Google Play' : 'the App Store'
              return store ? (
                <a href={store} className="btn-secondary w-full justify-center py-3 mt-3 !bg-slate-950 border border-slate-700 !text-ink">
                  Don’t have the app? Get it on {name}
                </a>
              ) : (
                <p className="mt-3 text-xs text-slate-500">The TCGHaven {kind === 'android' ? 'Android' : 'iPhone'} app is coming soon to {name}.</p>
              )
            })()}
            <p className="mt-2 text-xs text-slate-500">Sign in to the app with the same account as the website.</p>
          </>
        )}
        {where === 'computer' && (
          <>
            <p className="mt-2 text-sm text-slate-400">
              Scanning uses your phone’s camera. On your computer, go to Inventory → <b>Scan</b> and point your phone’s camera at the code it shows.
            </p>
            <Link href="/inventory" className="btn-primary w-full justify-center py-3 mt-5">Go to Inventory</Link>
          </>
        )}
      </div>
    </div>
  )
}
