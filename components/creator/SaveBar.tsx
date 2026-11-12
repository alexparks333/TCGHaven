'use client'

// The Creator Studio's slim save pill (the cover; the look of the pages): a quiet "Saved" when
// there's nothing to keep, and while there are changes, a dot, an undo and a small Save button —
// one line that never wraps, however narrow its column.

import { Check, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SaveBar({ dirty, onSave, onUndo, saveLabel = 'Save', savedLabel = 'Saved', blocked, className }: {
  dirty: boolean
  onSave: () => void
  onUndo: () => void
  saveLabel?: string
  savedLabel?: string
  blocked?: string // why it can't be saved yet (shown instead of the Save button)
  className?: string
}) {
  return (
    <div className={cn('sticky bottom-3 z-10 flex items-center gap-2 h-10 pl-3.5 pr-1.5 rounded-full border transition-shadow',
      dirty ? 'bg-[#f6eedb]/95 border-[#c4ae83] shadow-[0_8px_18px_-10px_rgba(60,35,15,0.55)] backdrop-blur-sm' : 'bg-[#f3e9d3]/80 border-[#d6c49f]', className)}>
      {dirty ? (
        <>
          <span className="w-2 h-2 shrink-0 rounded-full bg-[#a8452a] shadow-[0_0_0_3px_rgba(168,69,42,0.15)]" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">Unsaved changes</span>
          <button type="button" onClick={onUndo} title="Undo all changes" aria-label="Undo all changes"
            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-ink hover:bg-[#ebdfc3] transition-colors">
            <RotateCcw size={14} />
          </button>
          {blocked ? (
            <span className="shrink-0 whitespace-nowrap pr-2 text-[11px] font-semibold text-[#a8452a]">{blocked}</span>
          ) : (
            <button type="button" onClick={onSave}
              className="shrink-0 h-7 px-3.5 rounded-full bg-[#7a5230] hover:bg-[#6a4628] text-[#fbf6ea] text-[12px] font-semibold whitespace-nowrap inline-flex items-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] transition-colors">
              <Check size={13} strokeWidth={2.6} />{saveLabel}
            </button>
          )}
        </>
      ) : (
        <span className="flex-1 text-[12px] font-semibold text-slate-500 inline-flex items-center gap-1.5"><Check size={13} className="text-emerald-600" />{savedLabel}</span>
      )}
    </div>
  )
}
