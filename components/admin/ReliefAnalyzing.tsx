'use client'

// The Relief Studio's loading screen while the AI analyses the art (HavenRelief — on the PC or the
// cloud GPU, docs/creators.md). Beginner-friendly: the pin art with a scanning glow, the steps in
// plain words ticking off, a progress bar and a timer. The server doesn't report progress mid-run,
// so the steps follow the times a real run takes (the first cloud run, 2026-11-11: pieces ~45 s,
// layers ~25 s, detail ~60 s, ~2¼ min in all); the last step keeps going until the pin is really
// back, and the bar stops short of full until then.

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AnalyzingKind = 'analyze' | 'normals'

const STEPS: Record<AnalyzingKind, Array<{ title: string; detail: string; until: number }>> = {
  analyze: [
    { title: 'Waking up the 3D maker', detail: 'Starting a graphics card just for your pin', until: 8 },
    { title: 'Finding every piece of your pin', detail: 'Each letter, gem and outline becomes its own piece', until: 50 },
    { title: 'Building your layers', detail: 'Working out what sits in front and what sits behind', until: 78 },
    { title: 'Sculpting the fine detail', detail: 'The little ridges and curves that catch the light', until: 135 },
    { title: 'Putting your pin together', detail: 'Almost there…', until: Infinity },
  ],
  normals: [
    { title: 'Waking up the 3D maker', detail: 'Starting a graphics card just for your pin', until: 8 },
    { title: 'Sculpting the fine detail again', detail: 'The little ridges and curves that catch the light', until: 60 },
    { title: 'Putting it back on your pin', detail: 'Almost there…', until: Infinity },
  ],
}
const TYPICAL: Record<AnalyzingKind, number> = { analyze: 150, normals: 70 } // seconds, for the bar

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function ReliefAnalyzing({ kind, startedAt, artUrl, saving }: { kind: AnalyzingKind; startedAt: number; artUrl?: string; saving: boolean }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [])
  const secs = (now - startedAt) / 1000
  const steps = STEPS[kind]
  const at = saving ? steps.length : steps.findIndex((s) => secs < s.until)
  // eases toward 95% over the typical time, then creeps; full only when it's really done
  const pct = saving ? 100 : Math.min(95, 95 * (1 - Math.exp(-2.2 * secs / TYPICAL[kind])) / (1 - Math.exp(-2.2)))

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0c0a09]/90 backdrop-blur-sm p-6">
      <div className="w-full max-w-md flex flex-col items-center text-center">
        {/* The art, being scanned */}
        <div className="relative w-40 h-40 rounded-2xl overflow-hidden" style={{ background: 'radial-gradient(ellipse at 50% 40%, #2c2240 0%, #1a1427 60%, #0f0b18 100%)' }}>
          {artUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artUrl} alt="" className="absolute inset-0 m-auto max-w-[80%] max-h-[80%] object-contain relief-scan-art" />
          )}
          <span className="absolute inset-x-0 h-12 relief-scan-line pointer-events-none" />
        </div>

        <h3 className="mt-5 text-xl font-bold text-[#f3e9d3]">{saving ? 'Saving your pin…' : kind === 'normals' ? 'Re-sculpting the detail' : 'Sculpting your pin'}</h3>
        <p className="text-xs text-[#c9b994]/70 mt-1 tabular-nums">
          {clock(secs)} · usually about {kind === 'normals' ? 'a minute' : '2–3 minutes'}{secs > 200 && !saving ? ' — the first one of the day takes a little longer' : ''}
        </p>

        <div className="mt-4 w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #8a5f1f, #e8b35a, #fff1c4)' }} />
        </div>

        <ol className="mt-5 w-full space-y-2.5 text-left">
          {steps.map((s, i) => {
            const done = i < at, now_ = i === at
            return (
              <li key={s.title} className={cn('flex gap-3 items-start transition-opacity duration-500', !done && !now_ && 'opacity-35')}>
                <span className={cn('mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center',
                  done ? 'bg-emerald-600 text-white' : now_ ? 'text-[#e8b35a]' : 'border border-white/25')}>
                  {done ? <Check size={12} strokeWidth={3} /> : now_ ? <Loader2 size={16} className="animate-spin" /> : null}
                </span>
                <span>
                  <span className={cn('block text-sm font-semibold', now_ ? 'text-[#f3e9d3]' : 'text-[#d9ccb0]')}>{s.title}</span>
                  {now_ && <span className="block text-xs text-[#c9b994]/70 mt-0.5">{s.detail}</span>}
                </span>
              </li>
            )
          })}
        </ol>
        <p className="mt-6 text-[11px] text-[#c9b994]/50">Keep this open — your pin appears here as soon as it&rsquo;s ready.</p>
      </div>
    </div>
  )
}
