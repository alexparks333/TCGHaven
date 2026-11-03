'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Bold, Shapes, Italic, Loader2, Plus, Trash2, Type, X } from 'lucide-react'
import { staffDb } from '@/lib/firebase/staff'
import { saveTextKeys, useTextKeys, type TextKey } from '@/lib/textKeys'
import { cn } from '@/lib/utils'
import { CardName } from '@/components/CardName'
import { StaffModal } from './StaffModal'

const FIELD = 'bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-violet-600'
const newId = () => Math.random().toString(36).slice(2, 10)

// The Show as field's symbol picker. Plain text symbols only (they take the key's colour); ones
// phones draw as colour emoji (⚡, ☀…) are left out.
const SYMBOLS = [
  '·', '•', '◦', '‣', '|', '/', '—', '–', '»', '›', '«', '‹',
  '◆', '◇', '◈', '❖', '⬥', '⬦', '♦', '♢', '⟡', '✧', '✦', '❂',
  '★', '☆', '✪', '✫', '✶', '✷', '✸', '✹', '✺', '✻', '✼', '❋',
  '●', '○', '◉', '◎', '■', '□', '▪', '▫', '▲', '△', '▸', '▹',
  '♠', '♣', '♤', '♧', '♡', '♛', '♚', '♜', '✿', '❀', '❁', '☾',
  '✚', '✜', '✠', '†', '‡', '※', '⁂', '∞', '§', '¤', '⌘', '✕',
]

// "Show as" text box with a symbol picker that inserts at the cursor.
function ShowAsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  function insert(sym: string) {
    const el = input.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + sym + value.slice(end))
    // Keep typing after it
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + sym.length, start + sym.length) })
  }

  return (
    <div ref={box} className="relative flex items-center w-44 min-w-0 shrink-0">
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Show as (optional)"
        title="What the collector app shows instead — leave empty to show the text as it is"
        className={cn(FIELD, 'w-full pr-9')}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn('absolute right-1.5 w-7 h-7 rounded-md flex items-center justify-center', open ? 'bg-slate-700 text-ink' : 'text-slate-500 hover:text-ink hover:bg-slate-800')}
        title="Insert a symbol"
      >
        <Shapes size={14} />
      </button>
      {open && (
        <div className="absolute z-10 top-full right-0 mt-1 w-[19rem] rounded-xl border border-slate-800 bg-[#f5ecd9] shadow-xl p-2">
          <div className="grid grid-cols-12 gap-0.5">
            {SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                onMouseDown={(e) => e.preventDefault() /* keep the cursor in the text box */}
                onClick={() => insert(sym)}
                className="h-7 rounded-md text-base text-ink hover:bg-slate-800"
                title={`Insert ${sym}`}
              >
                {sym}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5 px-0.5">Click to insert at the cursor — add as many as you like.</div>
        </div>
      )}
    </div>
  )
}

// The Catalog page's "Text Key" button: the list of keywords that are styled wherever a card's
// name shows in the collector app (lib/textKeys.ts, components/CardName.tsx).
export function TextKeysButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700"
        title="Keywords in card names that show in their own colour, bold or italic — e.g. (Nexus Promo)"
      >
        <Type size={13} /> Text Key
      </button>
      {open && <TextKeysEditor onClose={() => setOpen(false)} />}
    </>
  )
}

function TextKeysEditor({ onClose }: { onClose: () => void }) {
  const live = useTextKeys()
  const [draft, setDraft] = useState<TextKey[]>(() => live.map((k) => ({ ...k })))
  const [sample, setSample] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = (id: string, patch: Partial<TextKey>) => setDraft((d) => d.map((k) => (k.id === id ? { ...k, ...patch } : k)))
  const dirty = JSON.stringify(draft) !== JSON.stringify(live)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await saveTextKeys(staffDb, draft)
      onClose()
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  function close() {
    if (dirty && !window.confirm('Discard your Text Key changes?')) return
    onClose()
  }

  return (
    <StaffModal onClose={close} className="max-w-4xl">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-ink">Text Key</div>
            <div className="text-xs text-slate-500 mt-1">
              Words in a card&apos;s name that show in their own style everywhere in the collector app — and,
              optionally, as different text (e.g. (Nexus Promo) → · Nexus). Matches the text exactly as
              typed, ignoring capitals. Only the display changes: search still finds the real name.
            </div>
          </div>
          <button onClick={close} className="text-slate-500 hover:text-ink" title="Close"><X size={16} /></button>
        </div>

        <div className="mt-4 space-y-2">
          {draft.map((k) => (
            <div key={k.id} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-2">
              <input
                value={k.text}
                onChange={(e) => change(k.id, { text: e.target.value })}
                placeholder='In the name, e.g. (Nexus Promo)'
                title="The text to find in a card's name"
                className={cn(FIELD, 'w-40 min-w-0')}
              />
              <ArrowRight size={14} className="text-slate-500 shrink-0" />
              <ShowAsField value={k.show ?? ''} onChange={(show) => change(k.id, { show })} />
              <label className="relative shrink-0" title="Colour">
                <input
                  type="color"
                  value={k.color || '#2b2014'}
                  onChange={(e) => change(k.id, { color: e.target.value })}
                  className="w-9 h-9 rounded-lg border border-slate-800 bg-transparent cursor-pointer p-0.5"
                />
              </label>
              {k.color && (
                <button onClick={() => change(k.id, { color: '' })} className="text-[10px] text-slate-500 hover:text-ink shrink-0" title="Use the name's own colour">
                  No colour
                </button>
              )}
              <button
                onClick={() => change(k.id, { bold: !k.bold })}
                className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', k.bold ? 'bg-slate-700 text-ink' : 'bg-slate-800 text-slate-400 hover:text-ink')}
                title="Bold"
              >
                <Bold size={14} />
              </button>
              <button
                onClick={() => change(k.id, { italic: !k.italic })}
                className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', k.italic ? 'bg-slate-700 text-ink' : 'bg-slate-800 text-slate-400 hover:text-ink')}
                title="Slightly italic"
              >
                <Italic size={14} />
              </button>
              {/* How it looks on a card name */}
              <div className="flex-1 min-w-0 truncate text-sm font-semibold text-ink px-1">
                <CardName name={`Card Name ${k.text || '(keyword)'}`} keys={[k]} />
              </div>
              <button
                onClick={() => setDraft((d) => d.filter((x) => x.id !== k.id))}
                className="text-slate-500 hover:text-red-600 shrink-0"
                title="Remove this key (saved when you press Save)"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!draft.length && <div className="text-xs text-slate-500 py-2">No keys yet.</div>}
          <button
            onClick={() => setDraft((d) => [...d, { id: newId(), text: '', show: '', color: '#7a3fc4', bold: false, italic: false }])}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
          >
            <Plus size={12} /> Add key
          </button>
        </div>

        <div className="mt-4">
          <input
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="Try a card name, e.g. Charizard (1st Edition)"
            className={cn(FIELD, 'w-full')}
          />
          {sample && (
            <div className="mt-2 text-base font-semibold text-ink"><CardName name={sample} keys={draft} /></div>
          )}
        </div>

        {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
        <div className="flex items-center gap-2 mt-5">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {saving && <Loader2 size={12} className="animate-spin" />} Save
          </button>
          <button onClick={close} className="text-xs font-medium px-3.5 py-2 rounded-lg text-slate-400 hover:text-ink">Cancel</button>
        </div>
      </div>
    </StaffModal>
  )
}
