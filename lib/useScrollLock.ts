import { useEffect } from 'react'

// Freezes the page behind a popup (Sell, Edit/Add Card, the Cardex zoom view, ...) so a swipe on
// a phone only ever scrolls the popup itself, never the page underneath it. The app's real
// scroller is <main> (see ClientWrapper.tsx), not the document, so that's what gets locked —
// plus html/body, so iOS can't rubber-band the document behind the popup either.
//
// Counted, so two popups open at once (e.g. Edit Card over a page that's already locked) don't
// unlock the page when only the top one closes.
let lockCount = 0

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    const main = document.querySelector('main')
    if (lockCount++ === 0) {
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      if (main) main.style.overflow = 'hidden'
    }
    return () => {
      if (--lockCount === 0) {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
        if (main) main.style.overflow = ''
      }
    }
  }, [active])
}
