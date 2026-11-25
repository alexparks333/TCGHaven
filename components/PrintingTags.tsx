import type { Card } from '@/lib/types'

// Small tags for what makes a copy a specific printing — a Pokémon edition other than Unlimited,
// a Reverse Holo, a Japanese card. Shown next to a card's name wherever inventory rows appear, so
// two rows of the same card (a 1st Edition and an Unlimited copy are separate rows) can be told
// apart at a glance. Same tag style as the Riftbound "Nexus" tag beside it.
// A copy's language when it isn't English — small, under its picture (LanguageNote), not a tag beside
// the name: the tags are for the printing (Reverse Holo, 1st Ed…), the Owner's call 2026-11-24.
const LANGUAGE_NAMES: Record<string, string> = { ja: 'Japanese' }

export function LanguageNote({ language, className = '' }: { language?: string; className?: string }) {
  const name = language && language !== 'en' ? LANGUAGE_NAMES[language] ?? language.toUpperCase() : ''
  if (!name) return null
  return <div className={`mt-0.5 text-center text-[0.5625rem] font-semibold leading-none text-slate-500 ${className}`}>{name}</div>
}

export function PrintingTags({ card, className = '' }: { card: Pick<Card, 'edition' | 'finish' | 'language'>; className?: string }) {
  const tags: { label: string; tone: string }[] = []
  if (card.edition === '1st') tags.push({ label: '1st Ed', tone: 'bg-amber-500/20 text-amber-700 border-amber-500/40' })
  if (card.edition === 'limited') tags.push({ label: 'Limited Ed', tone: 'bg-amber-500/20 text-amber-700 border-amber-500/40' })
  if (card.edition === 'shadowless') tags.push({ label: 'Shadowless', tone: 'bg-amber-500/20 text-amber-700 border-amber-500/40' })
  if (card.finish === 'reverse') tags.push({ label: 'Reverse Holo', tone: 'bg-violet-500/15 text-violet-600 border-violet-500/30' })
  // Flesh and Blood's foils (its editions use the 1st Ed tag above)
  if (card.finish === 'rainbow') tags.push({ label: 'Rainbow Foil', tone: 'bg-violet-500/15 text-violet-600 border-violet-500/30' })
  if (card.finish === 'cold') tags.push({ label: 'Cold Foil', tone: 'bg-sky-500/15 text-sky-700 border-sky-500/30' })
  if (!tags.length) return null
  return (
    <>
      {tags.map((t) => (
        <span key={t.label} className={`text-[0.625rem] font-bold uppercase px-1.5 py-0.5 rounded border ${t.tone} ${className}`}>
          {t.label}
        </span>
      ))}
    </>
  )
}
