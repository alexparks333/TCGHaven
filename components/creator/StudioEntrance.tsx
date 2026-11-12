'use client'

// The Creator Studio's loading screen (docs/creators.md). Two paper doors meet in the middle; the
// Studio's seal stamps down on them, its rim lettering slowly turning, while "Entering Creator
// Studio" settles in. Once the Studio is loaded (and at least ~1.7 s have passed, so it's seen),
// the doors swing apart and the seal rushes past you — you've walked into the workspace.
// onOpen fires as the doors start to part (the Studio fades up behind them); onDone once they're gone.

import { useEffect, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { Corners } from '@/components/creator/Ornaments'
import { cn } from '@/lib/utils'

const MIN_MS = 1700
const OPEN_MS = 1100

export function StudioEntrance({ ready, onOpen, onDone }: { ready: boolean; onOpen: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<'in' | 'out'>('in')
  const [minDone, setMinDone] = useState(false)
  useEffect(() => { const t = setTimeout(() => setMinDone(true), MIN_MS); return () => clearTimeout(t) }, [])
  useEffect(() => { if (ready && minDone && phase === 'in') { setPhase('out'); onOpen() } }, [ready, minDone, phase, onOpen])
  useEffect(() => {
    if (phase !== 'out') return
    const t = setTimeout(onDone, OPEN_MS)
    return () => clearTimeout(t)
  }, [phase, onDone])

  return (
    <div className={cn('studio-entrance fixed inset-0 z-[80] overflow-hidden', phase === 'out' && 'studio-entrance-out')} role="status" aria-label="Entering Creator Studio">
      {/* The doors */}
      <div className="studio-door studio-door-l haven-grain absolute inset-y-0 left-0 w-1/2">
        <div className="absolute inset-y-6 left-6 right-3 rounded-l-[14px] border border-r-0 border-[#d6c49f]" />
      </div>
      <div className="studio-door studio-door-r haven-grain absolute inset-y-0 right-0 w-1/2">
        <div className="absolute inset-y-6 right-6 left-3 rounded-r-[14px] border border-l-0 border-[#d6c49f]" />
      </div>

      {/* The seal and its words, over the seam */}
      <div className="studio-center absolute inset-0 flex flex-col items-center justify-center px-6">
        <Corners inset={34} size={64} />
        <div className="studio-stamp relative w-[min(200px,48vw)] aspect-square">
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full drop-shadow-[0_8px_14px_rgba(60,35,15,0.25)]" aria-hidden>
            <defs><path id="studio-entrance-ring" d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" /></defs>
            <circle cx="50" cy="50" r="48" fill="#f3e9d3" />
            <circle cx="50" cy="50" r="48" fill="none" stroke="#a8875c" strokeWidth="1.2" className="studio-draw" style={{ ['--len' as string]: 302 }} />
            <circle cx="50" cy="50" r="45" fill="none" stroke="#c4ae83" strokeWidth="0.6" strokeDasharray="1.5 2.2" />
            <circle cx="50" cy="50" r="29" fill="#f6eedb" />
            <circle cx="50" cy="50" r="29" fill="none" stroke="#a8875c" strokeWidth="0.9" className="studio-draw" style={{ ['--len' as string]: 183, animationDelay: '0.25s' }} />
            <g className="studio-spin">
              <text fontSize="8.4" fontWeight="700" fill="#7a5230" style={{ fontFamily: 'var(--font-engraved), Georgia, serif' }}>
                <textPath href="#studio-entrance-ring" textLength="228" lengthAdjust="spacing">✦ CREATOR STUDIO ✦ TCG HAVEN </textPath>
              </text>
            </g>
          </svg>
          <Wand2 className="absolute inset-0 m-auto w-[22%] h-[22%] text-[#7a5230]" strokeWidth={1.6} />
        </div>

        <p className="studio-title pinbook-serif mt-9 text-center text-[17px] md:text-[22px] font-bold uppercase text-ink">Entering Creator Studio</p>
        <div className="studio-rule mt-4 h-px w-[min(280px,60vw)] bg-gradient-to-r from-transparent via-[#a8875c] to-transparent" />
        <p className="studio-fade mt-4 text-sm italic text-slate-500" style={{ fontFamily: 'Georgia, serif' }}>Laying out your pages and polishing the pins…</p>
      </div>
    </div>
  )
}
