'use client'

import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'

/** The sign-in / sign-up password box: a lock on the left, an eye on the right to show what's typed */
export function PasswordInput({ value, onChange, placeholder, autoComplete, invalid }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoComplete: 'current-password' | 'new-password'
  invalid?: boolean
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
      <input
        type={shown ? 'text' : 'password'}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={`w-full bg-slate-900 border rounded-xl pl-9 pr-10 py-2.5 text-sm text-ink placeholder-slate-500 focus:outline-none transition-colors ${invalid ? 'border-red-400 focus:border-red-500' : 'border-slate-800 focus:border-violet-600'}`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:text-ink"
      >
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}
