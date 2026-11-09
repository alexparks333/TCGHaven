'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface GamePickerOption<T extends string> {
  id: T
  label: string
  /** Phone label, when `label` is long */
  shortLabel?: string
  color: string
  icon?: ReactNode
  count?: number
  /** Desktop only: a × on hover, with this tooltip (on phones, removing lives in the `trailing` menu) */
  remove?: { title: string; onClick: () => void }
}

const FADE_PX = 24

// The game bubbles on Inventory and the Cardex.
// Phone: always one line. When they don't fit they swipe sideways, with a fade on whichever edge
// has more, and the selected one is kept in view. `trailing` stays fixed at the right end.
// Desktop: spread-out bubbles that wrap. The scrolling row is md:contents there, so it has no box
// of its own: the bubbles and `trailing` are all items of the outer flex-wrap row, and the row's
// overflow and fade don't apply.
export function GamePicker<T extends string>({ options, active, onSelect, trailing }: {
  options: GamePickerOption<T>[]
  active: T
  onSelect: (id: T) => void
  trailing?: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  function measure() {
    const row = rowRef.current
    if (!row) return
    const left = row.scrollLeft > 1
    const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
  }

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [])

  useEffect(measure, [options])

  // Center the selected bubble: straight away on arrival, smoothly after that. scrollTo on the row
  // itself, because scrollIntoView would also move the page. Each bubble's wrapper is only
  // `relative` from md up, so on a phone offsetLeft is measured from this row.
  const arrived = useRef(false)
  useLayoutEffect(() => {
    const row = rowRef.current
    const bubble = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !bubble) return
    row.scrollTo({
      left: bubble.offsetLeft - (row.clientWidth - bubble.offsetWidth) / 2,
      behavior: arrived.current ? 'smooth' : 'auto',
    })
    arrived.current = true
  }, [active])

  const mask = more.left || more.right
    ? `linear-gradient(to right, ${more.left ? 'transparent' : 'black'}, black ${FADE_PX}px, black calc(100% - ${FADE_PX}px), ${more.right ? 'transparent' : 'black'})`
    : undefined

  return (
    <div className="flex items-center md:flex-wrap gap-2 mb-6">
      <div
        ref={rowRef}
        onScroll={measure}
        className="relative md:contents flex-1 min-w-0 flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        {options.map(({ id, label, shortLabel, color, icon, count, remove }) => {
          const on = id === active
          return (
            <div key={id} className="shrink-0 md:relative group">
              <button
                onClick={() => onSelect(id)}
                aria-pressed={on}
                className={cn(
                  'h-9 md:h-auto px-3.5 md:px-4 md:py-2 flex items-center gap-1.5 md:gap-2 rounded-xl border text-sm font-medium whitespace-nowrap transition-all',
                  on ? 'md:shadow-lg' : 'bg-slate-900 border-slate-800 md:border-0 text-slate-400 hover:text-ink hover:bg-slate-800',
                )}
                style={on ? { backgroundColor: color + '33', borderColor: color + '55', color } : undefined}
              >
                {icon}
                {shortLabel ? (
                  <>
                    <span className="md:hidden">{shortLabel}</span>
                    <span className="hidden md:inline">{label}</span>
                  </>
                ) : label}
                {count !== undefined && <span className="text-xs opacity-60">{count}</span>}
              </button>
              {remove && (
                <button
                  onClick={remove.onClick}
                  title={remove.title}
                  aria-label={remove.title}
                  className="hidden md:flex absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-700 text-slate-300 hover:bg-red-500 hover:text-white items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {trailing}
    </div>
  )
}
