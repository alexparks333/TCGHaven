'use client'

// The Creator Studio is for computers only (docs/creators.md): not in the iPhone or Android app —
// even for creators — and not on a phone or small tablet in a browser. Creators make their book and
// badges on a computer; fans see the results everywhere.

import { useEffect, useState } from 'react'
import { inApp } from '@/lib/nativeApp'

/** The narrowest window the Studio opens in (a laptop) */
export const STUDIO_MIN_WIDTH = 1024

export type StudioDevice = 'computer' | 'app' | 'small'

/** Where the Studio is being opened: on a computer, in the app, or on a screen too small. Starts
 *  'computer' (before the first check) and updates as the window resizes. */
export function useStudioDevice(): StudioDevice {
  const [device, setDevice] = useState<StudioDevice>('computer')
  useEffect(() => {
    const check = () => setDevice(inApp() ? 'app' : window.innerWidth < STUDIO_MIN_WIDTH ? 'small' : 'computer')
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return device
}

/** Whether links to the Studio should show here (never in the app; the sidebar is computers-only anyway) */
export function useStudioLinks(): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => setShow(!inApp()), [])
  return show
}
