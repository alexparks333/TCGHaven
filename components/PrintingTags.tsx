import type { Card } from '@/lib/types'

// Small tags for what makes a copy a specific printing — a Pokémon edition other than Unlimited,
// a Reverse Holo, a Japanese card. Shown next to a card's name wherever inventory rows appear, so
// two rows of the same card (a 1st Edition and an Unlimited copy are separate rows) can be told
// apart at a glance. Same tag style as the Riftbound "Nexus" tag beside it.
export function PrintingTags({ card, className = '' }: { card: Pick<Card, 'edition' | 'finish' | 'language'>; className?: string }) {
  const tags: { label: string; tone: string }[] = []
  if (card.edition === '1st') tags.push({ label: '1st Ed', tone: 'bg-amber-500/20 text-amber-700 border-amber-500/40' })
  if (card.edition === 'shadowless') tags.push({ label: 'Shadowless', tone: 'bg-amber-500/20 text-amber-700 border-amber-500/40' })
  if (card.finish === 'reverse') tags.push({ label: 'Reverse Holo', tone: 'bg-violet-500/15 text-violet-600 border-violet-500/30' })
  if (card.language === 'ja') tags.push({ label: 'Japanese', tone: 'bg-red-500/15 text-red-600 border-red-500/30' })
  if (!tags.length) return null
  return (
    <>
      {tags.map((t) => (
        <span key={t.label} className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${t.tone} ${className}`}>
          {t.label}
        </span>
      ))}
    </>
  )
}
