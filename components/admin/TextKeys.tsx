'use client'

import { useState } from 'react'
import { Bold, Italic, Loader2, Plus, Trash2, Type, X } from 'lucide-react'
import { staffDb } from '@/lib/firebase/staff'
import { saveTextKeys, useTextKeys, type TextKey } from '@/lib/textKeys'
import { cn } from '@/lib/utils'
import { CardName } from '@/components/CardName'
import { StaffModal } from './StaffModal'

const FIELD = 'bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-violet-600'
const newId = () => Math.random().toString(36).slice(2, 10)

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
    <StaffModal onClose={close} className="max-w-2xl">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-ink">Text Key</div>
            <div className="text-xs text-slate-500 mt-1">
              Words in a card&apos;s name that show in their own style everywhere in the collector app.
              Matches the text exactly as typed, ignoring capitals.
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
                placeholder='e.g. (1st Edition)'
                className={cn(FIELD, 'w-44 min-w-0')}
              />
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
            onClick={() => setDraft((d) => [...d, { id: newId(), text: '', color: '#7a3fc4', bold: false, italic: false }])}
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
