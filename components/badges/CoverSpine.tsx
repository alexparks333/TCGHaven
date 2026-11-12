'use client'

// A creator book's spine (Creator Studio cover designer, docs/creators.md): a band down the cover's
// left edge in one of a few bound looks. It eats into the cover, not past it: the book stays the
// same size, and the cover picture fills what's left beside it (coverArea()).

import { useId } from 'react'
import type { CoverStyle } from '@/lib/badges'

/** A creator cover with no picture yet: plain tan book board (the old leather colours aren't used) */
export const BLANK_COVER = '#cdb68c'

/** How much of the cover's width a spine takes, in % */
export const SPINE_W = 13

export const SPINES = [
  { id: 'bands', name: 'Raised bands' },
  { id: 'stitched', name: 'Stitched' },
  { id: 'gilded', name: 'Gilded' },
  { id: 'cloth', name: 'Bookcloth' },
] as const

export const SPINE_COLORS = [
  { name: 'Walnut', color: '#4a2c17' },
  { name: 'Oxblood', color: '#5c1a17' },
  { name: 'Navy', color: '#1c2a44' },
  { name: 'Forest', color: '#1f3a2a' },
  { name: 'Ink', color: '#1b1714' },
  { name: 'Saddle', color: '#8a6038' },
]

/** The cover's spine look, if it has one (an unknown id = none) */
export const spineOf = (st?: CoverStyle) => SPINES.find((s) => s.id === st?.spine)

/** Where the cover picture goes: the whole cover, or what's beside the spine (left, width in %) */
export const coverArea = (st?: CoverStyle) => (spineOf(st) ? { left: SPINE_W, width: 100 - SPINE_W } : { left: 0, width: 100 })

const GOLD = '#d6b168'
const THREAD = '#ead9b4'

/** The spine itself, down the left edge of the nearest `relative` box */
export function CoverSpine({ look, color = SPINE_COLORS[0].color, width = SPINE_W }: { look: string; color?: string; width?: number }) {
  const id = 'spine' + useId().replace(/:/g, '')
  // 10 × 108 ≈ the spine's shape on a 0.71-wide cover; stretched to fit (it's all straight lines)
  const bands = [16, 35, 54, 73, 92]
  return (
    <svg viewBox="0 0 10 108" preserveAspectRatio="none" aria-hidden
      className="absolute inset-y-0 left-0 h-full pointer-events-none" style={{ width: `${width}%` }}>
      <defs>
        {/* Rounded like a real spine: dark at both edges, a soft light down the middle */}
        <linearGradient id={`${id}r`} x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="0.7" stopColor="#000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </linearGradient>
        <pattern id={`${id}c`} width="0.8" height="0.8" patternUnits="userSpaceOnUse">
          <path d="M0 0 H0.8 M0 0 V0.8" stroke="#fff" strokeOpacity="0.12" strokeWidth="0.18" />
        </pattern>
      </defs>
      <rect width="10" height="108" fill={color} />
      {look === 'cloth' && <rect width="10" height="108" fill={`url(#${id}c)`} />}

      {look === 'bands' && bands.map((y) => (
        <g key={y}>
          <rect x="0" y={y - 1.3} width="10" height="2.6" fill={color} />
          <rect x="0" y={y - 1.3} width="10" height="2.6" fill={`url(#${id}b)`} />
          <rect x="0" y={y + 1.3} width="10" height="0.5" fill="#000" opacity="0.35" />
        </g>
      ))}
      {look === 'stitched' && (
        <g fill="none" stroke={THREAD} strokeWidth="0.32" strokeDasharray="1.4 1" opacity="0.75">
          <path d="M1.6 3 V105 M8.2 3 V105" />
          <path d="M1.6 3 H8.2 M1.6 105 H8.2" />
        </g>
      )}
      {look === 'gilded' && (
        <g fill="none" stroke={GOLD} strokeWidth="0.3">
          <path d="M1.2 2 V106 M8.8 2 V106" opacity="0.7" />
          {[10, 98].map((y) => <path key={y} d={`M1.2 ${y - 0.8} H8.8 M1.2 ${y + 0.8} H8.8`} />)}
          {[34, 54, 74].map((y) => (
            <g key={y}>
              <path d={`M5 ${y - 3.2} L7.2 ${y} L5 ${y + 3.2} L2.8 ${y} Z`} />
              <path d={`M5 ${y - 1.4} L6 ${y} L5 ${y + 1.4} L4 ${y} Z`} fill={GOLD} stroke="none" />
            </g>
          ))}
        </g>
      )}
      {look === 'cloth' && (
        <g fill="none" stroke={GOLD} strokeWidth="0.35" opacity="0.85">
          <rect x="2.4" y="6" width="5.2" height="9" />
          <rect x="2.4" y="93" width="5.2" height="9" />
        </g>
      )}

      <rect width="10" height="108" fill={`url(#${id}r)`} />
      {/* The hinge: a groove where the spine meets the cover */}
      <rect x="9.3" width="0.35" height="108" fill="#000" opacity="0.55" />
      <rect x="9.65" width="0.35" height="108" fill="#fff" opacity="0.12" />
    </svg>
  )
}
