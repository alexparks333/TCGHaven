'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, SlidersHorizontal } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, cn } from '@/lib/utils'
import { GAME_LABELS, type Game } from '@/lib/types'

const ALL_GAMES: Game[] = ['pokemon', 'lorcana', 'riftbound']

const TIME_OPTIONS = [
  { value: 'entry', label: 'Since Entry' },
  { value: '1d',    label: '1 Day' },
  { value: '7d',    label: '1 Week' },
  { value: '30d',   label: '1 Month' },
] as const

// Pill styles — three states
const pillOn   = 'text-xs px-3 py-1.5 rounded-full border font-medium transition-all bg-violet-600/20 border-violet-500/40 text-violet-300 hover:bg-violet-600/30'
const pillOff  = 'text-xs px-3 py-1.5 rounded-full border font-medium transition-all bg-slate-900 border-slate-700 text-slate-500 line-through decoration-slate-600 hover:text-slate-300 hover:border-slate-600'
const pillIdle = 'text-xs px-3 py-1.5 rounded-full border font-medium transition-all bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'

export function FilterPanel() {
  const {
    calcFloor, setCalcFloor,
    showFilters, setShowFilters,
    activeGames, setActiveGames,
    timeFrame, setTimeFrame,
    cards,
    hiddenGroups, toggleHiddenGroup,
  } = useStore()

  const allGroups = useMemo(
    () => Array.from(new Set(cards.map((c) => c.group).filter(Boolean) as string[])).sort(),
    [cards],
  )
  const [floorInput, setFloorInput] = useState(calcFloor > 0 ? String(calcFloor) : '')

  useEffect(() => {
    if (calcFloor === 0) setFloorInput('')
  }, [calcFloor])

  const totalHidden = useMemo(
    () => (calcFloor > 0
      ? cards.filter((c) => (c.currentPrice ?? c.purchasePrice) < calcFloor).length
      : 0),
    [cards, calcFloor],
  )

  function applyFloor(val: number) {
    setCalcFloor(val)
    setFloorInput(val === 0 ? '' : String(val))
  }

  function toggleGame(game: Game) {
    if (activeGames.includes(game)) {
      if (activeGames.length === 1) return
      setActiveGames(activeGames.filter((g) => g !== game))
    } else {
      setActiveGames([...activeGames, game])
    }
  }

  const allGamesActive = ALL_GAMES.every((g) => activeGames.includes(g))
  const hasActiveFilters = calcFloor > 0 || !allGamesActive || timeFrame !== 'entry' || hiddenGroups.length > 0

  return (
    <>
      {/* Slide-down panel */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          showFilters ? 'max-h-[40rem]' : 'max-h-0',
        )}
      >
        <div className="bg-slate-900 border-b border-slate-700/60 px-4 sm:px-6 lg:px-8 py-5">
          <div className="max-w-7xl mx-auto space-y-5">

            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={14} className="text-violet-400" />
                <span className="text-sm font-bold text-white">Portfolio Filters</span>
                <span className="text-xs text-slate-500">— affects all calculations &amp; top performers</span>
              </div>
              <button onClick={() => setShowFilters(false)} className="text-slate-500 hover:text-white transition-colors p-1">
                <X size={15} />
              </button>
            </div>

            {/* Games */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="w-32 shrink-0">
                <div className="text-xs font-semibold text-slate-400">Games</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {ALL_GAMES.map((game) => {
                  const on = activeGames.includes(game)
                  const isLast = on && activeGames.length === 1
                  return (
                    <button
                      key={game}
                      onClick={() => toggleGame(game)}
                      disabled={isLast}
                      className={cn(on ? pillOn : pillOff, isLast && 'opacity-40 cursor-not-allowed')}
                    >
                      {GAME_LABELS[game]}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* P&L Window */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="w-32 shrink-0">
                <div className="text-xs font-semibold text-slate-400">P&amp;L Window</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {TIME_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setTimeFrame(value)}
                    className={timeFrame === value ? pillOn : pillIdle}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Calculation Floor */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="w-32 shrink-0">
                <div className="text-xs font-semibold text-slate-400">Calc Floor</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[0, 0.5, 1, 2, 5, 10].map((val) => (
                  <button
                    key={val}
                    onClick={() => applyFloor(val)}
                    className={cn(
                      'text-xs px-3 py-1.5 rounded-full border font-medium transition-all',
                      calcFloor === val
                        ? 'bg-violet-600/20 border-violet-500/40 text-violet-300 hover:bg-violet-600/30'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600',
                    )}
                  >
                    {val === 0 ? 'Off' : `$${val}`}
                  </button>
                ))}
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs pointer-events-none">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    placeholder="Custom"
                    value={floorInput}
                    onChange={(e) => {
                      setFloorInput(e.target.value)
                      const n = parseFloat(e.target.value)
                      setCalcFloor(isNaN(n) || n < 0 ? 0 : n)
                    }}
                    className="w-24 bg-slate-800 border border-slate-700 rounded-full pl-6 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            </div>

            {/* Groups */}
            {allGroups.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="w-32 shrink-0">
                  <div className="text-xs font-semibold text-slate-400">Groups</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {allGroups.map((group) => {
                    const hidden = hiddenGroups.includes(group)
                    const count = cards.filter((c) => c.group === group).length
                    return (
                      <button
                        key={group}
                        onClick={() => toggleHiddenGroup(group)}
                        className={hidden ? pillOff : pillOn}
                      >
                        {group} <span className="opacity-60 font-normal">({count})</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Floor indicator */}
            {totalHidden > 0 && (
              <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="text-xs text-amber-400">
                  <span className="font-semibold">{totalHidden} card{totalHidden !== 1 ? 's' : ''}</span> hidden below {formatCurrency(calcFloor)}
                </span>
                <button onClick={() => applyFloor(0)} className="ml-auto text-xs text-slate-500 hover:text-white underline underline-offset-2">
                  Clear floor
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Active-filter banner when panel is closed */}
      {!showFilters && hasActiveFilters && (
        <div className="bg-amber-950/40 border-b border-amber-900/40 px-4 sm:px-6 lg:px-8 py-1.5">
          <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
            <div className="flex items-center gap-2 text-xs text-amber-400 flex-wrap">
              {calcFloor > 0 && <span>Floor: {formatCurrency(calcFloor)}{totalHidden > 0 ? ` (${totalHidden} hidden)` : ''}</span>}
              {!allGamesActive && <span>Games: {activeGames.map((g) => GAME_LABELS[g]).join(', ')}</span>}
              {timeFrame !== 'entry' && <span>Period: {TIME_OPTIONS.find((t) => t.value === timeFrame)?.label}</span>}
              {hiddenGroups.length > 0 && <span>Hidden: {hiddenGroups.join(', ')}</span>}
            </div>
            <button onClick={() => setShowFilters(true)} className="ml-auto text-xs text-amber-500 hover:text-amber-300 underline underline-offset-2">
              Edit
            </button>
          </div>
        </div>
      )}
    </>
  )
}
