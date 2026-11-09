'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface GamePickerOption<T extends string> {
  id: T
  label: string
  color: string
  icon?: ReactNode
  count?: number
}

const FADE_PX = 24

// The game bubbles on Inventory and the Cardex: always one line. When they don't fit they swipe
// sideways, with a fade on whichever edge has more, and the selected one is kept in view.
// `trailing` (Inventory's game menu) sits outside the scrolling part, so it stays put and its
// dropdown isn't clipped.
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
  // itself, because scrollIntoView would also move the page.
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
    <div className="flex items-center gap-2 mb-6">
      <div
        ref={rowRef}
        onScroll={measure}
        className="relative flex-1 min-w-0 flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        {options.map(({ id, label, color, icon, count }) => {
          const on = id === active
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-pressed={on}
              className={cn(
                'shrink-0 h-9 px-3.5 flex items-center gap-1.5 rounded-xl border text-sm font-medium whitespace-nowrap transition-colors',
                !on && 'bg-slate-900 border-slate-800 text-slate-400 hover:text-ink hover:bg-slate-800',
              )}
              style={on ? { backgroundColor: color + '33', borderColor: color + '55', color } : undefined}
            >
              {icon}
              {label}
              {count !== undefined && <span className="text-xs opacity-60">{count}</span>}
            </button>
          )
        })}
      </div>
      {trailing}
    </div>
  )
}
