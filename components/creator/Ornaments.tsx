'use client'

// The Creator Studio's paper ornaments (docs/creators.md): engraved corner flourishes, a fleuron
// divider, a round seal with lettering around it, and a ribbon bookmark — all thin walnut line-work,
// so the Studio feels like a hand-made book rather than an app. Drawn in currentColor.

import { useId } from 'react'
import { cn } from '@/lib/utils'

/** A flourish in each corner of the nearest `relative` box */
export function Corners({ inset = 10, size = 40, top = false, className }: { inset?: number; size?: number; top?: boolean /* only the top two */; className?: string }) {
  const at = [
    { top: inset, left: inset, transform: undefined },
    { top: inset, right: inset, transform: 'scaleX(-1)' },
    { bottom: inset, left: inset, transform: 'scaleY(-1)' },
    { bottom: inset, right: inset, transform: 'scale(-1)' },
  ]
  return (
    <>
      {at.slice(0, top ? 2 : 4).map((pos, i) => (
        // The pin book's engraved corner (BadgeBook FrameOrnament): a bracket, and a curl swept
        // diagonally in from the corner
        <svg key={i} viewBox="0 0 40 40" width={size} height={size} fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden
          className={cn('absolute pointer-events-none text-[#a8875c] opacity-80', className)} style={pos}>
          <path d="M2 2 L16 2 M2 2 L2 16" strokeWidth="1.6" />
          <path d="M6 6 C14 6 16 9 16 14 C16 18 13 19 11 17 C9 15 11 12 13.5 13" strokeWidth="1" />
          <path d="M6 6 C6 14 9 16 14 16" strokeWidth="1" />
          <path d="M22 2 L25 2 M2 22 L2 25" strokeWidth="1.2" />
          <circle cx="6" cy="6" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      ))}
    </>
  )
}

/** A fine rule with a fleuron in the middle */
export function Divider({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn('flex items-center gap-3 text-[#a8875c]', className)} aria-hidden={!children}>
      <span className="flex-1 h-px bg-gradient-to-r from-transparent to-[#c4ae83]" />
      <svg viewBox="0 0 40 12" width="40" height="12" fill="currentColor" className="shrink-0">
        <circle cx="4" cy="6" r="1.2" />
        <path d="M20 1 L25 6 L20 11 L15 6 Z" fill="none" stroke="currentColor" strokeWidth="1" />
        <path d="M20 3.6 L22.4 6 L20 8.4 L17.6 6 Z" />
        <circle cx="36" cy="6" r="1.2" />
        <path d="M8 6 H13 M27 6 H32" stroke="currentColor" strokeWidth="0.8" />
      </svg>
      {children}
      <span className="flex-1 h-px bg-gradient-to-l from-transparent to-[#c4ae83]" />
    </div>
  )
}

/** A round seal: lettering around the rim, the community's initial in the middle */
export function Seal({ letter, ring, size = 88 }: { letter: string; ring: string; size?: number }) {
  const id = 'seal' + useId().replace(/:/g, '')
  return (
    <span className="relative inline-flex items-center justify-center shrink-0 rotate-[-6deg]" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" aria-hidden>
        <defs><path id={id} d="M50,50 m-37,0 a37,37 0 1,1 74,0 a37,37 0 1,1 -74,0" /></defs>
        <circle cx="50" cy="50" r="48" fill="#f3e9d3" stroke="#c4ae83" strokeWidth="1.2" />
        <circle cx="50" cy="50" r="45" fill="none" stroke="#c4ae83" strokeWidth="0.6" strokeDasharray="1.5 2.2" />
        <circle cx="50" cy="50" r="29" fill="#f6eedb" stroke="#a8875c" strokeWidth="0.9" />
        <text fontSize="8.4" fontWeight="700" fill="#7a5230" style={{ fontFamily: 'var(--font-engraved), Georgia, serif' }}>
          <textPath href={`#${id}`} textLength="228" lengthAdjust="spacing">{ring}</textPath>
        </text>
      </svg>
      <span className="relative pinbook-serif font-bold text-ink leading-none" style={{ fontSize: size * 0.36 }}>{letter}</span>
    </span>
  )
}

/** A silk ribbon bookmark hanging from the top edge of the nearest `relative` box */
export function Ribbon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 78" width="26" height="78" aria-hidden className={cn('absolute top-0 pointer-events-none drop-shadow-[0_3px_3px_rgba(60,35,15,0.25)]', className)}>
      <path d="M0 0 H26 V78 L13 66 L0 78 Z" fill="#8a3b26" />
      <path d="M3 0 V70 M23 0 V70" stroke="#b5654a" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.8" />
      <path d="M0 0 H26 V6 H0 Z" fill="#000" opacity="0.18" />
    </svg>
  )
}
