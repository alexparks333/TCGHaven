'use client'

// The Creator Studio's own top bar (docs/creators.md). The Studio fills the whole screen — none of
// the app's sidebar or phone nav — so this strip is always there: the Studio's name on the left,
// "Exit Creator Studio" on the right, back to the page you came from (ClientWrapper remembers it).

import { useRouter } from 'next/navigation'
import { LogOut, Wand2 } from 'lucide-react'

export function StudioBar({ unsaved = false }: { unsaved?: boolean }) {
  const router = useRouter()
  function exit() {
    if (unsaved && !window.confirm('You have changes that aren’t saved yet (your cover or the look of your pages). If you leave now, they go back to how they were. Leave the Studio anyway?')) return
    let back = '/'
    try { back = sessionStorage.getItem('haven:beforeStudio') || '/' } catch { /* private mode */ }
    router.push(back)
  }
  return (
    <div className="sticky top-0 z-40 -mx-3 sm:-mx-6 lg:-mx-8 mb-4 md:mb-5 px-3 sm:px-6 lg:px-8 pt-[env(safe-area-inset-top)] bg-slate-900/95 backdrop-blur-sm border-b border-[#d6c49f]">
      <div className="h-14 flex items-center gap-3">
        <span className="haven-medallion w-8 h-8 shrink-0"><Wand2 size={15} /></span>
        <div className="min-w-0 leading-tight">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">TCG Haven</p>
          <p className="pinbook-serif text-[15px] font-bold text-ink truncate">Creator Studio</p>
        </div>
        <button type="button" onClick={exit}
          className="haven-chip ml-auto shrink-0 inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-ink hover:text-[#7a5230]">
          <LogOut size={15} />
          <span className="hidden sm:inline">Exit Creator Studio</span><span className="sm:hidden">Exit</span>
        </button>
      </div>
    </div>
  )
}
