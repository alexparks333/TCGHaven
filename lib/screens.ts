// Screen shapes the layout switches on, as media queries — one copy for the code (matchMedia) and
// Tailwind (tailwind.config.ts screens), so the two can't drift apart. globals.css can't import:
// its @media rules for a sideways phone repeat PHONELAND_QUERY by hand — keep them the same.

/** A phone turned sideways: wide but short — never a computer or tablet (Tailwind's `phoneland:`) */
export const PHONELAND_QUERY = '(orientation: landscape) and (max-height: 500px)'
/** md's width and taller than a sideways phone: a tablet or computer (Tailwind's `wide:`) */
export const WIDE_QUERY = '(min-width: 768px) and (min-height: 501px)'
/** A phone held upright */
export const PHONE_UPRIGHT_QUERY = '(max-width: 767px) and (orientation: portrait)'
