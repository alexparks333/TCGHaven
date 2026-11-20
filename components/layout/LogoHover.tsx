'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LogoFrames } from '@/components/LogoFrames'

// The desktop sidebar's logo: goes home, and while hovered (or focused) plays the doorway
// 20 → 0 → 20 with a 5-frame rest, on loop (components/LogoFrames.tsx)
export function LogoHover() {
  const [on, setOn] = useState(false)
  return (
    <Link
      href="/"
      onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)}
      onFocus={() => setOn(true)} onBlur={() => setOn(false)}
      className="flex items-center gap-1.5 px-1 mb-6 rounded-xl"
      aria-label="TCGHaven — home"
    >
      <LogoFrames playing={on} className="w-[4.5rem] h-[4.5rem] shrink-0" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-text.png" alt="" className="min-w-0 flex-1 h-auto object-contain" />
    </Link>
  )
}
