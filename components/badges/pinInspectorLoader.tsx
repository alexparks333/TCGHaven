'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { createPortal } from 'react-dom'

// The 3D inspect view (PinInspector.tsx), loaded on demand — three.js is big. Its code starts
// downloading as soon as a pin book or pin display shows (preloadPinInspector), so a click opens it
// right away; and if it isn't there yet, the click still answers at once with the same frosted
// screen and "Polishing badge…" bar while it arrives.

// Downloading the code can fail (a dropped connection, or a new deploy since the page loaded): that
// open closes again at once instead of crashing the book (it works again after a reload).
const load = () => import('./PinInspector').catch((e) => {
  console.error('Couldn’t load the 3D view', e)
  started = false
  return { default: Failed }
})
function Failed({ onClose }: { onClose: () => void }) {
  useEffect(() => { onClose() }, [onClose])
  return null
}
let started = false
export function preloadPinInspector() {
  if (started) return
  started = true
  load()
}

export const PinInspector = dynamic(load, { ssr: false, loading: () => <InspectorShell /> })

function InspectorShell() {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col pin-inspector-in backdrop-blur-xl" aria-busy>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(28,20,12,0.42) 0%, rgba(18,13,8,0.72) 75%)' }} />
      <div className="relative flex-1 min-h-0"><PolishingBar value={0} /></div>
    </div>,
    document.body,
  )
}

// Shown in place of the pin until it's fully built (here, and in PinInspector)
export function PolishingBar({ value }: { value: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-56 text-center">
        <div className="text-sm font-semibold text-[#fbe9c4]/85 mb-2.5 tracking-wide">Polishing badge…</div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(Math.max(0.04, value) * 100)}%`, background: 'linear-gradient(90deg, #a87a2c, #f3d48a, #c9973f)' }}
          />
        </div>
        <div className="text-[11px] text-white/40 mt-1.5 tabular-nums">{Math.round(value * 100)}%</div>
      </div>
    </div>
  )
}
