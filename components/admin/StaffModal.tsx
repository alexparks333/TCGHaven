'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useScrollLock } from '@/lib/useScrollLock'
import { cn } from '@/lib/utils'

// A popup over the staff portal page (Admin Catalog's Edit card, Text Key). Esc or a click
// outside closes it.
export function StaffModal({ onClose, children, className }: { onClose: () => void; children: React.ReactNode; className?: string }) {
  useScrollLock()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Centred over the page content, not the whole window — the staff sidebar takes the left side,
  // so window-centred looked off to the left.
  const [contentLeft] = useState(() => (typeof document === 'undefined' ? 0 : document.querySelector('main')?.getBoundingClientRect().left ?? 0))
  const close = (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose() }
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto" onMouseDown={close}>
      <div className="min-h-full flex items-center justify-center p-4" style={{ paddingLeft: contentLeft + 16 }} onMouseDown={close}>
        <div className={cn('w-full max-w-3xl rounded-2xl bg-[#efe4cc] shadow-2xl [&>.card-glass]:mb-0', className)}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

