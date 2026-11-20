import { useEffect } from 'react'

// Freezes the page behind a popup (Sell, Edit/Add Card, the Cardex zoom view, ...) so a swipe on
// a phone only ever scrolls the popup itself, never the page underneath it. The app's real
// scroller is <main> (see ClientWrapper.tsx), not the document, so that's what gets locked —
// plus html/body, so iOS can't rubber-band the document behind the popup either.
//
// Counted, so two popups open at once (e.g. Edit Card over a page that's already locked) don't
// unlock the page when only the top one closes.
let lockCount = 0
// What each element's overflow was before the first lock — put back as the last one closes, not
// cleared to '': a popup over something that locked the page its own way (the phone book locks
// html, the 3D badge view body) cleared that lock as it closed, and the page behind scrolled again
// (2026-11-20)
let saved: { html: string; body: string; main: string; mainEl: HTMLElement | null } | null = null

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    if (lockCount++ === 0) {
      const main = document.querySelector('main')
      saved = { html: document.documentElement.style.overflow, body: document.body.style.overflow, main: main?.style.overflow ?? '', mainEl: main }
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      if (main) main.style.overflow = 'hidden'
    }
    return () => {
      if (--lockCount === 0 && saved) {
        document.documentElement.style.overflow = saved.html
        document.body.style.overflow = saved.body
        if (saved.mainEl) saved.mainEl.style.overflow = saved.main
        saved = null
      }
    }
  }, [active])
}
