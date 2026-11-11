'use client'

// /scan — the page the website's "Scan with your phone" QR code opens on the phone.
//   • In the TCGHaven app: straight to the scanner (/inventory?scan=1).
//   • In Safari: hands over to the app (tcghaven://scan — the app's URL scheme, ios/App/App/Info.plist),
//     with a button for when iOS asks first.
//   • On a computer: says to scan the code with a phone instead.
// docs/card-scanner.md "Scanning from the website".

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ScanLine, Smartphone } from 'lucide-react'
import { inApp } from '@/lib/nativeApp'

const APP_LINK = 'tcghaven://scan'

export default function ScanLinkPage() {
  const router = useRouter()
  const [where, setWhere] = useState<'app' | 'phone' | 'computer' | null>(null)

  useEffect(() => {
    if (inApp()) {
      setWhere('app')
      router.replace('/inventory?scan=1')
      return
    }
    const phone = /iPhone|iPod|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    setWhere(phone ? 'phone' : 'computer')
    if (phone) window.location.href = APP_LINK
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
            <a href={APP_LINK} className="btn-primary w-full justify-center py-3 mt-5 text-base">
              <Smartphone size={18} />
              Open the scanner in the app
            </a>
            <p className="mt-3 text-xs text-slate-500">Needs the TCGHaven iPhone app, signed in to your account.</p>
          </>
        )}
        {where === 'computer' && (
          <>
            <p className="mt-2 text-sm text-slate-400">
              Scanning uses your iPhone’s camera. On your computer, go to Inventory → <b>Scan</b> and point your phone’s camera at the code it shows.
            </p>
            <Link href="/inventory" className="btn-primary w-full justify-center py-3 mt-5">Go to Inventory</Link>
          </>
        )}
      </div>
    </div>
  )
}
