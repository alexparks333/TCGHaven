'use client'

import { Fragment, useMemo } from 'react'
import { textKeyStyle, useTextKeys, type TextKey } from '@/lib/textKeys'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A card's name with its Text Keys styled (lib/textKeys.ts) — e.g. the "(Nexus Promo)" in
// "Jinx, Rebel (Nexus Promo)". Drop-in for `{card.name}`: inherits everything else (size,
// weight, truncate) from where it's placed. `keys` overrides the live list (the editor's preview).
export function CardName({ name, keys }: { name: string; keys?: TextKey[] }) {
  const live = useTextKeys()
  const list = keys ?? live
  // One pattern for every key, longest first so "(1st Edition Holo)" beats "(1st Edition)"
  const { pattern, byText } = useMemo(() => {
    const usable = list.filter((k) => k.text.trim())
    const byText = new Map(usable.map((k) => [k.text.trim().toLowerCase(), k]))
    const sorted = Array.from(byText.keys()).sort((a, b) => b.length - a.length)
    return { pattern: sorted.length ? new RegExp(sorted.map(escape).join('|'), 'gi') : null, byText }
  }, [list])

  if (!pattern) return <>{name}</>
  const parts: React.ReactNode[] = []
  let last = 0
  for (const m of Array.from(name.matchAll(pattern))) {
    if (m.index! > last) parts.push(<Fragment key={last}>{name.slice(last, m.index)}</Fragment>)
    parts.push(<span key={`k${m.index}`} style={textKeyStyle(byText.get(m[0].toLowerCase())!)}>{m[0]}</span>)
    last = m.index! + m[0].length
  }
  if (!parts.length) return <>{name}</>
  if (last < name.length) parts.push(<Fragment key={last}>{name.slice(last)}</Fragment>)
  return <>{parts}</>
}
