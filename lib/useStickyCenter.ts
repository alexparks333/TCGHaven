'use client'

import { useEffect, useState } from 'react'

/** For a `sticky` box that should sit in the middle of the window while the page scrolls past it
 *  (the Creator Studio's book beside its long edit panels). `below`: px covered at the top (the
 *  Studio's bar). A box taller than the window just sticks under the bar. `ref` is a callback ref,
 *  so a box that appears later (switching tabs) is measured too. */
export function useStickyCenter<T extends HTMLElement = HTMLDivElement>(below = 56) {
  const [el, ref] = useState<T | null>(null)
  const [top, setTop] = useState(below + 12)
  useEffect(() => {
    if (!el) return
    const fit = () => setTop(Math.max(below + 12, Math.round((window.innerHeight + below - el.offsetHeight) / 2)))
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    window.addEventListener('resize', fit)
    fit()
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [el, below])
  return { ref, top }
}
