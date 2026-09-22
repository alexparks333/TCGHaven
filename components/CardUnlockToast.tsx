'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PartyPopper, X, ArrowUpRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import { GAME_COLORS, type Card } from '@/lib/types'
import { cn } from '@/lib/utils'

// Auto-dismiss timing — long enough to actually notice the reveal animation (which alone takes
// ~1.4s, see globals.css's card-unlock-* keyframes) before it starts fading.
const VISIBLE_MS = 5000
const EXIT_MS = 250

// Mounted once, globally (see ClientWrapper) — renders only the front of the cardUnlocks queue,
// so a burst of "first copy" adds during a big unboxing session shows one celebration at a time
// instead of stacking or clobbering.
export function CardUnlockToast() {
  const { cardUnlocks, dismissCardUnlock } = useStore()
  const current = cardUnlocks[0] ?? null

  if (!current) return null
  return <UnlockCard key={current.id} id={current.id} card={current.card} onDismiss={() => dismissCardUnlock(current.id)} />
}

function UnlockCard({ id, card, onDismiss }: { id: string; card: Card; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false)
  const color = GAME_COLORS[card.game] ?? '#8b5cf6'
  const router = useRouter()

  function startExit() {
    setExiting(true)
    setTimeout(onDismiss, EXIT_MS)
  }

  function goToCardex() {
    // card.set is always the catalog's human-readable setName (every game's search-select path
    // stores it that way — see AddCardDialog's selectCard()), the same string the Cardex's own
    // set picker matches sets by. A set the catalog doesn't recognize (not yet synced, or a
    // manually-typed custom card) falls back to that game's inventory-only Special bucket —
    // handled on the receiving end, in CardexPage's deep-link effect.
    router.push(`/cardex?game=${card.game}&set=${encodeURIComponent(card.set)}`)
    startExit()
  }

  useEffect(() => {
    const t = setTimeout(startExit, VISIBLE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div
      className={cn('fixed z-[60] bottom-20 md:bottom-4 right-4 w-[264px] card-unlock-toast', exiting && 'exiting')}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={goToCardex}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') goToCardex() }}
        title="View in Cardex"
        className="group relative overflow-hidden rounded-2xl border bg-slate-900/95 backdrop-blur-sm shadow-2xl p-3 flex gap-3 w-full text-left cursor-pointer transition-transform hover:-translate-y-0.5"
        style={{ borderColor: color + '55', boxShadow: `0 0 24px ${color}30` }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); startExit() }}
          className="absolute top-1.5 right-1.5 p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 z-10"
        >
          <X size={13} />
        </button>

        {/* Card image with glow ring + shine sweep behind/over the grayscale->color reveal */}
        <div className="relative shrink-0 w-[76px]" style={{ aspectRatio: '5/7' }}>
          <div
            className="absolute inset-0 rounded-lg card-unlock-glow-ring"
            style={{ background: `radial-gradient(circle, ${color}90 0%, transparent 70%)` }}
          />
          <div className="relative w-full h-full rounded-lg overflow-hidden" style={{ outline: `2px solid ${color}80` }}>
            {card.imageUrl ? (
              <img src={card.imageUrl} alt={card.name} className="w-full h-full object-cover card-unlock-image" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-slate-400 bg-slate-800 card-unlock-image">
                #{card.number}
              </div>
            )}
            <div
              className="absolute inset-0 w-1/3 card-unlock-shine"
              style={{ background: 'linear-gradient(120deg, transparent, rgba(255,255,255,0.75), transparent)' }}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1 flex flex-col justify-center card-unlock-label">
          <div className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide mb-1" style={{ color }}>
            <PartyPopper size={12} />
            Card Unlocked!
          </div>
          <div className="text-sm font-semibold text-white leading-tight truncate">{card.name}</div>
          <div className="text-xs text-slate-500 truncate">
            {card.set}{card.number && card.number !== 'N/A' ? ` · #${card.number}` : ''}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-slate-600 group-hover:text-slate-400 mt-1 transition-colors">
            View in Cardex <ArrowUpRight size={10} />
          </div>
        </div>
      </div>
    </div>
  )
}
