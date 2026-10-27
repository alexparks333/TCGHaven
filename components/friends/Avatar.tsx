'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

// Warm tones that sit well on the parchment theme; each person always gets the same one.
const TONES = ['#8a5d36', '#7a4a5a', '#66745a', '#a8452a', '#5f7a32', '#9a5a5a', '#b5532f', '#6e4f6a', '#7a8030', '#4f6a7a']

function toneFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return TONES[Math.abs(h) % TONES.length]
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({ name, photoURL, seed, size = 32, ring, className }: {
  name: string
  photoURL?: string
  seed: string
  size?: number
  ring?: boolean
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  return (
    <span
      className={cn('relative inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden font-bold text-white select-none', ring && 'ring-2 ring-slate-900', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)), background: toneFor(seed) }}
      aria-hidden
    >
      {photoURL && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : initialsOf(name)}
    </span>
  )
}
