'use client'

// The top three's medals on a community's Members panel (CommunityPage MembersColumn) — the owner picks the
// style in the Studio (Members → Content → Medals): flat discs, ribbon medals, laurel wreaths, crowns,
// trophies, or their own three pictures (`page.members.medalArt`). Flat drawings in gold, silver and bronze,
// no fake 3D; "Shine" sweeps a glint across first place now and then (globals.css .medal-shine).

import { useId } from 'react'
import { cn } from '@/lib/utils'

export type MedalStyle = 'disc' | 'ribbon' | 'laurel' | 'crown' | 'trophy' | 'custom'
export const MEDAL_STYLES: Array<{ id: MedalStyle; name: string }> = [
  { id: 'ribbon', name: 'Ribbons' },
  { id: 'laurel', name: 'Laurels' },
  { id: 'crown', name: 'Crowns' },
  { id: 'trophy', name: 'Trophies' },
  { id: 'disc', name: 'Discs' },
  { id: 'custom', name: 'My pictures' },
]

/** Gold, silver, bronze: the metal (light → dark), its ink, and the ribbon colour that goes with it */
export const METALS = [
  { hi: '#fbe6a2', mid: '#d9a838', lo: '#9a6a12', ink: '#4a2f04', ribbon: '#b8402f', ribbon2: '#8a2a1e', row: '#d9a838' },
  { hi: '#f4f6f8', mid: '#b4bcc6', lo: '#6f7884', ink: '#252a31', ribbon: '#3f6e8c', ribbon2: '#2b4f66', row: '#9aa3ad' },
  { hi: '#f2c49c', mid: '#b97a48', lo: '#7a4520', ink: '#331606', ribbon: '#5d7a3a', ribbon2: '#405628', row: '#b97a48' },
]

export function Medal({ place, style, art, shine, size = 30 }: { place: 0 | 1 | 2; style: MedalStyle; art?: string; shine?: boolean; size?: number }) {
  const id = useId().replace(/:/g, '')
  const m = METALS[place]
  const n = String(place + 1)
  const metal = `m${id}`
  const grad = <linearGradient id={metal} x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stopColor={m.hi} /><stop offset="0.55" stopColor={m.mid} /><stop offset="1" stopColor={m.lo} /></linearGradient>
  const num = (x: number, y: number, fs: number) => (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={700} fill={m.ink} style={{ fontFamily: 'var(--font-engraved), Georgia, serif' }}>{n}</text>
  )
  const wrap = (child: React.ReactNode) => (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', shine && place === 0 && 'medal-shine')} style={{ width: size, height: size }}
      role="img" aria-label={['First', 'Second', 'Third'][place] + ' place'}>{child}</span>
  )

  if (style === 'custom' && art) {
    // eslint-disable-next-line @next/next/no-img-element
    return wrap(<img src={art} alt="" className="w-full h-full object-contain drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]" />)
  }
  if (style === 'disc' || style === 'custom') {
    return wrap(
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
        <defs>{grad}</defs>
        <circle cx="16" cy="16" r="13" fill={`url(#${metal})`} stroke={m.lo} strokeWidth="1" />
        <circle cx="16" cy="16" r="10" fill="none" stroke={m.hi} strokeWidth="1" opacity="0.8" />
        {num(16, 16.5, 13)}
      </svg>,
    )
  }
  if (style === 'ribbon') {
    // two ribbon tails in a V, the medal hanging off them
    return wrap(
      <svg viewBox="0 0 32 40" width={size} height={size * 1.25} aria-hidden style={{ marginTop: -size * 0.25 }}>
        <defs>{grad}</defs>
        <path d="M7 1h7l5 15h-7z" fill={m.ribbon} />
        <path d="M25 1h-7l-5 15h7z" fill={m.ribbon2} />
        <path d="M10.5 1h3.5l2 6z" fill="#ffffff" opacity="0.35" />
        <circle cx="16" cy="26.5" r="11" fill={`url(#${metal})`} stroke={m.lo} strokeWidth="1" />
        <path d="m16 18.6 2.1 1.1 2.4-.2.7 2.3 1.9 1.5-1 2.2.3 2.4-2.2 1-1.3 2-2.3-.6-2.3.6-1.3-2-2.2-1 .3-2.4-1-2.2 1.9-1.5.7-2.3 2.4.2z" fill="none" stroke={m.hi} strokeWidth="0.8" opacity="0.7" />
        {num(16, 27, 11)}
      </svg>,
    )
  }
  if (style === 'laurel') {
    // a wreath of leaves round the number
    // six leaves up each side, from the bottom (250°) round to the upper side (135°), each along the curve
    const leaves = (side: 1 | -1) => Array.from({ length: 6 }, (_, i) => {
      const deg = 250 - i * 23, a = deg * (Math.PI / 180)
      const lx = 16 + 12 * Math.cos(a), y = 16.5 - 12 * Math.sin(a)
      const x = side === 1 ? lx : 32 - lx
      const rot = side === 1 ? -deg : deg
      return <ellipse key={i} cx={x} cy={y} rx="1.9" ry="3.9" transform={`rotate(${rot} ${x} ${y})`} fill={`url(#${metal})`} stroke={m.lo} strokeWidth="0.5" />
    })
    return wrap(
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
        <defs>{grad}</defs>
        {leaves(1)}{leaves(-1)}
        <path d="M9 28.5q7 3 14 0" fill="none" stroke={m.ribbon} strokeWidth="2" strokeLinecap="round" />
        {num(16, 15.5, 13)}
      </svg>,
    )
  }
  if (style === 'crown') {
    return wrap(
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
        <defs>{grad}</defs>
        <path d="M4 11l6 5 6-9 6 9 6-5-2.5 14h-19z" fill={`url(#${metal})`} stroke={m.lo} strokeWidth="1" strokeLinejoin="round" />
        <circle cx="4" cy="10.5" r="1.8" fill={m.hi} stroke={m.lo} strokeWidth="0.6" />
        <circle cx="16" cy="6" r="1.8" fill={m.hi} stroke={m.lo} strokeWidth="0.6" />
        <circle cx="28" cy="10.5" r="1.8" fill={m.hi} stroke={m.lo} strokeWidth="0.6" />
        <rect x="6" y="24" width="20" height="3.5" rx="1" fill={m.lo} />
        <circle cx="10" cy="25.75" r="0.9" fill={m.ribbon} /><circle cx="16" cy="25.75" r="0.9" fill={m.ribbon2} /><circle cx="22" cy="25.75" r="0.9" fill={m.ribbon} />
        {num(16, 18.5, 9.5)}
      </svg>,
    )
  }
  // trophy: a cup with handles on a stand
  return wrap(
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <defs>{grad}</defs>
      <path d="M8 6h-3.5q0 7 5 8M24 6h3.5q0 7-5 8" fill="none" stroke={m.lo} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 3.5h16v6q0 8-8 9.5-8-1.5-8-9.5z" fill={`url(#${metal})`} stroke={m.lo} strokeWidth="1" strokeLinejoin="round" />
      <path d="M14 19h4v4.5h-4z" fill={m.mid} stroke={m.lo} strokeWidth="0.8" />
      <rect x="9.5" y="23.5" width="13" height="5" rx="1" fill={m.lo} />
      <rect x="11.5" y="25" width="9" height="2" rx="0.5" fill={m.hi} opacity="0.6" />
      {num(16, 10.5, 10)}
    </svg>,
  )
}
