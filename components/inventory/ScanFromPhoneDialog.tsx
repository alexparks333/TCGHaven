'use client'

// The website's Scan button: a QR code the person points their iPhone's camera at. It opens
// www.tcghaven.org/scan, which opens the TCGHaven app straight into the card scanner
// (tcghaven://scan — lib/nativeApp.ts onScanLink). Cards added on the phone are saved to the same
// account; this dialog watches for them and shows them arriving, so the website's inventory is up
// to date without a reload. docs/card-scanner.md "Scanning from the website".

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { X, Smartphone, Check, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/components/auth/AuthProvider'
import { loadCardChanges } from '@/lib/firebase/db'
import { useScrollLock } from '@/lib/useScrollLock'
import { cardImage } from '@/lib/cardImage'
import type { Card } from '@/lib/types'

// Always the live site: the app shows www.tcghaven.org, whichever copy of the site shows the code
const SCAN_URL = 'https://www.tcghaven.org/scan'
const POLL_MS = 4000

export function ScanFromPhoneDialog({ onClose }: { onClose: () => void }) {
  useScrollLock(true)
  const { user } = useAuth()
  const [qr, setQr] = useState<string | null>(null)
  const [arrived, setArrived] = useState<Card[]>([])
  const openedAt = useRef(Date.now())

  useEffect(() => {
    QRCode.toDataURL(SCAN_URL, { margin: 1, width: 440, color: { dark: '#2b1d10', light: '#fbf6ea' }, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null))
  }, [])

  // The cards the phone adds: asked for every few seconds while this is open, merged into the
  // inventory here (the same change feed the site uses at load — lib/firebase/db.ts)
  useEffect(() => {
    if (!user) return
    let cursor = openedAt.current - 60_000 // a little slack for the two clocks
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const { changed, cursor: next } = await loadCardChanges(user.uid, cursor)
        cursor = Math.max(cursor, next)
        if (stopped || !changed.length) return
        const { cards, addCard, updateCard } = useStore.getState()
        const have = new Set(cards.map((c) => c.id))
        const fresh: Card[] = []
        for (const c of changed) {
          if (have.has(c.id)) updateCard(c.id, c)
          else addCard(c)
          if (Date.parse(c.createdAt ?? '') >= openedAt.current - 60_000) fresh.push(c)
        }
        if (fresh.length) setArrived((a) => [...fresh.filter((f) => !a.some((x) => x.id === f.id)), ...a])
      } catch { /* try again next round */ } finally {
        if (!stopped) timer = setTimeout(poll, POLL_MS)
      }
    }
    timer = setTimeout(poll, POLL_MS)
    return () => { stopped = true; clearTimeout(timer) }
  }, [user])

  const count = arrived.reduce((n, c) => n + (c.quantity || 1), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="add-card-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm touch-none" onClick={onClose} />
      <div className="add-card-panel relative w-full max-w-[460px] card-glass rounded-t-2xl sm:rounded-2xl max-h-[94dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink leading-tight">Scan with your phone</h2>
            <p className="text-xs text-slate-400 mt-0.5">Cards you add on your phone show up here</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-800" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {/* The code, on parchment, in a walnut double rule */}
          <div className="mx-auto w-fit rounded-2xl p-3 bg-[#fbf6ea] border-[3px] border-double border-[#7a5a3a] shadow-sm">
            {qr
              ? <img src={qr} alt="QR code that opens the TCGHaven card scanner" className="w-[220px] h-[220px] block [image-rendering:pixelated]" />
              : <div className="w-[220px] h-[220px] flex items-center justify-center"><Loader2 className="animate-spin text-slate-500" /></div>}
          </div>

          <ol className="mt-5 space-y-2.5 text-sm text-ink">
            {[
              'Open your phone’s camera and point it at the code',
              'Tap the link that appears — the TCGHaven app opens straight to the scanner',
              'Scan your cards, then tap Add on your phone',
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-none w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-slate-500 flex items-center gap-1.5">
            <Smartphone size={13} className="flex-none" />
            Needs the TCGHaven app (iPhone or Android), signed in to this same account.
          </p>

          {/* What's arrived from the phone */}
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
            {arrived.length === 0 ? (
              <p className="text-sm text-slate-400 flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-500 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-600" />
                </span>
                Waiting for cards from your phone…
              </p>
            ) : (
              <>
                <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                  <Check size={15} className="text-emerald-600" />
                  {count} card{count === 1 ? '' : 's'} added from your phone
                </p>
                <ul className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {arrived.map((c) => (
                    <li key={c.id} className="flex-none w-[64px]" title={c.name}>
                      <img src={cardImage(c.imageUrl, 'thumb') ?? c.imageUrl} alt={c.name} className="w-[64px] h-[89px] object-cover rounded-md border border-slate-800" />
                      <p className="mt-1 text-[10px] leading-tight text-slate-400 truncate">{c.name}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-800">
          <button onClick={onClose} className="btn-primary w-full justify-center py-2.5">Done</button>
        </div>
      </div>
    </div>
  )
}
