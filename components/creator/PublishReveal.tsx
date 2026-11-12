'use client'

// The moment a creator publishes a badge (BadgeMaker → Publish badge, docs/creators.md): the whole
// screen blurs away and the pin presents itself — it turns in out of the dark, gold rays wheel
// behind it, sparks burst, light sweeps across it — and "Published" settles in above its nameplate.
// Then the creator can turn the real 3D pin over, or carry on.

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Box, Check } from 'lucide-react'
import { BadgePin } from '@/components/badges/BadgePin'
import { useTrimmedArt } from '@/components/badges/trimmedArt'
import { Portal } from '@/components/creator/Portal'
import { useScrollLock } from '@/lib/useScrollLock'
import type { BadgeDef } from '@/lib/badges'

const PinInspector = dynamic(() => import('@/components/badges/PinInspector'), { ssr: false })

const SPARKS = Array.from({ length: 28 }, (_, i) => ({
  a: (i / 28) * 360 + (i % 3) * 7,
  d: 180 + ((i * 53) % 140),
  s: 3 + ((i * 7) % 5),
  t: 0.55 + ((i * 13) % 30) / 100,
}))

export function PublishReveal({ def, bookName, onDone }: { def: BadgeDef; bookName: string; onDone: () => void }) {
  useScrollLock(true)
  const [turning, setTurning] = useState(false)
  const art = useTrimmedArt(def.imageUrl)
  const size = 'min(44vh, 360px)'
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onDone])
  const mask = art ? `url("${art.src}") center / contain no-repeat` : undefined

  return (
    <Portal>
      <div className="pub-backdrop fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-hidden px-6" role="dialog" aria-modal="true" aria-label={`${def.name} is published`}>
        {/* Light from behind: a soft glow and slowly wheeling rays */}
        <div className="pub-glow absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 w-[120vmin] h-[120vmin] rounded-full pointer-events-none" />
        <div className="pub-rays absolute left-1/2 top-[44%] w-[150vmin] h-[150vmin] pointer-events-none" />

        {/* "Published" */}
        <p className="pub-title pinbook-serif relative text-center font-bold uppercase text-[clamp(34px,7vw,72px)] leading-none">Published</p>
        <p className="pub-rise relative mt-3 text-center text-sm md:text-base text-[#f3e6c8]/75" style={{ animationDelay: '1.15s' }}>
          Live in <b className="text-[#f3e6c8]">{bookName}</b> — fans can start collecting it now.
        </p>

        {/* The pin */}
        <div className="relative mt-8 flex items-center justify-center" style={{ width: size, height: `calc(${size} * 1.12)` }}>
          {/* sparks bursting out as it lands */}
          {SPARKS.map((p, i) => (
            <span key={i} className="pub-spark absolute left-1/2 top-1/2 rounded-full pointer-events-none"
              style={{ width: p.s, height: p.s, ['--a' as string]: `${p.a}deg`, ['--d' as string]: `${p.d}px`, animationDelay: `${p.t}s` }} />
          ))}
          {turning && def.reliefKit ? (
            <div className="absolute inset-[-20%]">
              <PinInspector def={def} embedded onClose={() => setTurning(false)} />
            </div>
          ) : (
            <div className="pub-pin relative w-full h-full">
              <div className="pub-float relative w-full h-full flex items-center justify-center drop-shadow-[0_30px_40px_rgba(0,0,0,0.65)]">
                <BadgePin art={def.art} imageUrl={def.imageUrl} size={360} />
                {/* a sweep of light across the pin, in its own shape */}
                {mask && <span className="pub-sheen absolute inset-0 pointer-events-none" style={{ WebkitMask: mask, mask }} />}
              </div>
            </div>
          )}
        </div>

        {/* Its nameplate */}
        <span className="pub-rise pinbook-serif relative mt-6 rounded-[4px] px-5 py-1.5 text-sm md:text-base font-bold uppercase tracking-[0.2em] text-[#1c1206] shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
          style={{ background: 'linear-gradient(180deg, #fbe7a6, #d6b168 45%, #a8792c)', animationDelay: '1.35s' }}>
          ✦ {def.name} ✦
        </span>

        <div className="pub-rise relative mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: '1.7s' }}>
          {def.reliefKit && (
            <button type="button" onClick={() => setTurning((t) => !t)}
              className="rounded-full border border-[#f3e6c8]/30 bg-white/5 px-5 py-2.5 text-sm font-semibold text-[#f3e6c8] hover:bg-white/10 inline-flex items-center gap-2 backdrop-blur-sm">
              <Box size={16} />{turning ? 'Back to the pin' : 'Turn it in 3D'}
            </button>
          )}
          <button type="button" onClick={onDone} autoFocus
            className="rounded-full px-6 py-2.5 text-sm font-bold text-[#1c1206] inline-flex items-center gap-2 shadow-[0_8px_20px_rgba(214,177,104,0.35)]"
            style={{ background: 'linear-gradient(180deg, #fbe7a6, #d6b168 55%, #b8862b)' }}>
            <Check size={16} />Done
          </button>
        </div>
      </div>
    </Portal>
  )
}
