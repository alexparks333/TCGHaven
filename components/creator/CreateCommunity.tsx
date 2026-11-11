'use client'

// The Creator Studio's first step: setting up your community (docs/creators.md). One question at a
// time — its name, a tagline and bio, the games it collects, its colour — with the community's card
// filling in live beside you. "Launch community" saves it (communities/{uid}); only then does the
// Studio show its Your Book / Community tabs.

import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, Rocket, Sparkles, Users } from 'lucide-react'
import { saveCommunity, type Community } from '@/lib/creatorBooks'
import { GAME_COLORS, GAME_LABELS, type Game } from '@/lib/types'
import { cn } from '@/lib/utils'

export const BANNERS = ['#6d28d9', '#b91c1c', '#0f766e', '#1d4ed8', '#c2410c', '#be185d', '#3f6212', '#334155', '#a16207', '#0e7490']
const GAMES = Object.keys(GAME_LABELS) as Game[]

/** The community's card — the wizard's live preview, and the Community tab's */
export function CommunityCard({ c, big = false }: { c: Community; big?: boolean }) {
  return (
    <div className="card-glass overflow-hidden">
      <div className={cn('relative', big ? 'h-36 md:h-44' : 'h-28')} style={{ background: `linear-gradient(135deg, ${c.color}, #0b0b12)`, transition: 'background 0.5s' }}>
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.35) 0, transparent 40%), radial-gradient(circle at 85% 70%, rgba(255,255,255,0.18) 0, transparent 35%)' }} />
      </div>
      <div className="px-5 pb-5 -mt-9 relative">
        <div className="w-[72px] h-[72px] rounded-2xl border-4 border-[#f3e9d3] shadow-lg flex items-center justify-center text-3xl font-black text-white" style={{ background: c.color, transition: 'background 0.5s' }}>
          {(c.name.trim()[0] || '★').toUpperCase()}
        </div>
        <h3 className="mt-3 text-xl font-bold text-ink leading-tight">{c.name.trim() || 'Your community'}</h3>
        <p className="text-sm text-slate-500 mt-0.5 min-h-[20px]">{c.tagline || <span className="opacity-50">Your tagline</span>}</p>
        {(c.games?.length ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {c.games!.map((g) => (
              <span key={g} className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: GAME_COLORS[g] }}>{GAME_LABELS[g]}</span>
            ))}
          </div>
        )}
        <p className="text-sm text-slate-400 mt-3 whitespace-pre-line line-clamp-4 min-h-[20px]">{c.about || <span className="opacity-50">Your bio</span>}</p>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Users size={13} />0 members · just launched</div>
      </div>
    </div>
  )
}

export function CreateCommunity({ uid, creatorName, onLaunched }: { uid: string; creatorName: string; onLaunched: () => void }) {
  const [started, setStarted] = useState(false)
  const [step, setStep] = useState(0)
  const [c, setC] = useState<Community>({ name: '', tagline: '', about: '', color: BANNERS[0], games: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (p: Partial<Community>) => setC((x) => ({ ...x, ...p }))
  const steps = ['Name', 'Bio', 'Games', 'Look']
  const canNext = step === 0 ? c.name.trim().length >= 2 : step === 2 ? (c.games?.length ?? 0) > 0 : true

  async function launch() {
    setBusy(true); setError('')
    try {
      await saveCommunity(uid, { ...c, name: c.name.trim(), tagline: c.tagline.trim(), about: c.about.trim() })
      onLaunched()
    } catch (e) {
      setError('Couldn’t launch it — ' + (e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  // The big start
  if (!started) {
    return (
      <div className="card-glass relative overflow-hidden max-w-4xl mx-auto px-6 py-14 md:py-20 text-center">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(109,40,217,0.18), transparent 60%)' }} />
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="creator-spark absolute rounded-full pointer-events-none" style={{ left: `${(i * 41) % 100}%`, bottom: '-8px', width: 4, height: 4, background: '#c9a24a', animationDelay: `${(i * 0.7) % 6}s`, animationDuration: `${6 + (i % 4)}s` }} />
        ))}
        <div className="relative">
          <span className="mx-auto w-16 h-16 rounded-3xl bg-violet-600 text-white flex items-center justify-center shadow-lg shadow-violet-900/30"><Users size={30} /></span>
          <h2 className="mt-5 text-3xl md:text-4xl font-bold text-ink">Start your community</h2>
          <p className="mt-3 text-slate-400 max-w-lg mx-auto leading-relaxed">
            A home on TCG Haven for the people who follow you — where they join, collect the badges in your Creator Book, and show them off.
          </p>
          <button type="button" onClick={() => setStarted(true)}
            className="mt-8 inline-flex items-center gap-2.5 rounded-2xl px-8 py-4 text-lg font-bold text-white bg-violet-600 hover:bg-violet-500 shadow-xl shadow-violet-900/30 transition-all hover:-translate-y-0.5 active:translate-y-0">
            <Sparkles size={20} />Create Community
          </button>
          <p className="mt-4 text-xs text-slate-500">Takes about a minute · you can change everything later</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start max-w-5xl mx-auto">
      <div className="card-glass p-6 md:p-8">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-7">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
              <button type="button" onClick={() => i < step && setStep(i)}
                className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-colors shrink-0',
                  i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-violet-600 text-white ring-4 ring-violet-600/20' : 'bg-slate-800 text-slate-500')}>
                {i < step ? <Check size={15} /> : i + 1}
              </button>
              <span className={cn('text-xs font-semibold hidden sm:block', i === step ? 'text-ink' : 'text-slate-500')}>{label}</span>
              {i < steps.length - 1 && <span className={cn('flex-1 h-0.5 rounded', i < step ? 'bg-emerald-600' : 'bg-slate-800')} />}
            </div>
          ))}
        </div>

        <div key={step} className="add-card-panel">
          {step === 0 && (
            <>
              <h2 className="text-2xl font-bold text-ink">What&rsquo;s your community called?</h2>
              <p className="text-sm text-slate-400 mt-1.5">The name people search for and join.</p>
              <input className="input-field mt-5 text-xl font-bold py-3" autoFocus maxLength={40} value={c.name}
                onChange={(e) => set({ name: e.target.value })} placeholder={`e.g. ${creatorName.split(' ')[0] || 'Our'}'s Collectors Club`}
                onKeyDown={(e) => { if (e.key === 'Enter' && canNext) setStep(1) }} />
              <p className="text-xs text-slate-500 mt-2 text-right tabular-nums">{c.name.length}/40</p>
            </>
          )}
          {step === 1 && (
            <>
              <h2 className="text-2xl font-bold text-ink">Tell people about it</h2>
              <p className="text-sm text-slate-400 mt-1.5">A one-line tagline, and a bio for your community&rsquo;s page.</p>
              <label className="block mt-5"><span className="field-label">Tagline</span>
                <input className="input-field" autoFocus maxLength={80} value={c.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="Chasing every holo since 1999" /></label>
              <label className="block mt-4"><span className="field-label flex justify-between"><span>Bio</span><span className="font-normal tabular-nums">{c.about.length}/600</span></span>
                <textarea className="input-field min-h-[130px]" maxLength={600} value={c.about} onChange={(e) => set({ about: e.target.value })} placeholder="Who you are, what you collect, what members get…" /></label>
            </>
          )}
          {step === 2 && (
            <>
              <h2 className="text-2xl font-bold text-ink">What do you collect?</h2>
              <p className="text-sm text-slate-400 mt-1.5">Pick your community&rsquo;s main games — they show on your page and help people find you.</p>
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {GAMES.map((g) => {
                  const on = c.games?.includes(g)
                  return (
                    <button key={g} type="button" onClick={() => set({ games: on ? c.games!.filter((x) => x !== g) : [...(c.games ?? []), g] })}
                      className={cn('relative rounded-2xl border-2 px-3 py-3.5 text-left font-bold text-sm transition-all', on ? 'text-white border-transparent shadow-md -translate-y-0.5' : 'border-slate-800 bg-slate-950/40 text-ink hover:border-slate-700')}
                      style={on ? { background: `linear-gradient(135deg, ${GAME_COLORS[g]}, ${GAME_COLORS[g]}bb)` } : undefined}>
                      {GAME_LABELS[g]}
                      {on && <Check size={15} className="absolute top-2 right-2" />}
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h2 className="text-2xl font-bold text-ink">Pick your colour</h2>
              <p className="text-sm text-slate-400 mt-1.5">Your banner and badge colour across TCG Haven.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                {BANNERS.map((col) => (
                  <button key={col} type="button" onClick={() => set({ color: col })} aria-label={col}
                    className={cn('w-12 h-12 rounded-2xl transition-transform hover:scale-110 shadow-md', c.color === col && 'ring-4 ring-offset-2 ring-offset-[#efe3c8] ring-[#7a5a3a] scale-110')}
                    style={{ background: `linear-gradient(135deg, ${col}, #0b0b12)` }} />
                ))}
              </div>
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
        <div className="mt-8 flex items-center gap-2">
          {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="btn-secondary !bg-slate-950 border border-slate-700 !text-ink"><ArrowLeft size={15} />Back</button>}
          <div className="flex-1" />
          {step < steps.length - 1 ? (
            <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)} className="btn-primary px-6 disabled:opacity-40">Next<ArrowRight size={15} /></button>
          ) : (
            <button type="button" disabled={busy} onClick={launch} className="btn-primary px-6 py-2.5 text-base">
              {busy ? <Loader2 size={17} className="animate-spin" /> : <Rocket size={17} />}Launch community
            </button>
          )}
        </div>
      </div>

      {/* It filling in, live */}
      <div className="lg:sticky lg:top-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 mb-2">Preview</p>
        <CommunityCard c={c} big />
      </div>
    </div>
  )
}
