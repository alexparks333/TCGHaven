import { Fragment } from 'react'

// Keywords in a card's name that the collector app draws in their own colour / font — e.g. the
// "(Nexus Promo)" in "Jinx, Rebel (Nexus Promo)". Add a rule here to style another keyword
// everywhere a card name is shown. Matching ignores case; the parentheses are styled with it.
const NAME_KEYWORDS: Array<{ match: RegExp; style: React.CSSProperties }> = [
  {
    match: /\(?nexus promo\)?/gi,
    // A real purple on purpose — the Tailwind palette maps `purple` to plum (tailwind.config).
    // Slightly italic: a small skew, since the fonts' own italic leans too far.
    style: { color: '#7a3fc4', display: 'inline-block', transform: 'skewX(-7deg)' },
  },
]

// A card's name with its keywords styled. Drop-in for `{card.name}` — inherits everything else
// (size, weight, truncate) from where it's placed.
export function CardName({ name }: { name: string }) {
  const parts: Array<{ text: string; style?: React.CSSProperties }> = [{ text: name }]
  for (const rule of NAME_KEYWORDS) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part.style) continue
      const pieces: typeof parts = []
      let last = 0
      for (const m of Array.from(part.text.matchAll(rule.match))) {
        if (m.index! > last) pieces.push({ text: part.text.slice(last, m.index) })
        pieces.push({ text: m[0], style: rule.style })
        last = m.index! + m[0].length
      }
      if (!pieces.length) continue
      if (last < part.text.length) pieces.push({ text: part.text.slice(last) })
      parts.splice(i, 1, ...pieces)
      i += pieces.length - 1
    }
  }
  if (parts.length === 1 && !parts[0].style) return <>{name}</>
  return (
    <>
      {parts.map((p, i) => (p.style ? <span key={i} style={p.style}>{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  )
}
