'use client'

import { useId } from 'react'
import { badgeAsset } from '@/lib/badgeAssets'

// Enamel-pin art for each Haven Badge (lib/badges.ts `art`). Temporary designs until real art is
// made: a gold-rimmed hexagon pin with enamel fill, an emblem and a ribbon. `silhouette` is the
// pin's outline — the pin book cuts a hole in that shape where a badge hasn't been earned yet.

export const PIN_VIEWBOX = '0 0 100 112'
// Pointy-top hexagon with softened corners
export const PIN_SILHOUETTE = 'M50 3 C52 3 54 4 55.5 5 L91 25 C94 27 96 30 96 33.5 L96 78.5 C96 82 94 85 91 87 L55.5 107 C52 109 48 109 44.5 107 L9 87 C6 85 4 82 4 78.5 L4 33.5 C4 30 6 27 9 25 L44.5 5 C46 4 48 3 50 3 Z'

// Raised details on the stand-in pin, shared with the 3D model (PinInspector.tsx) so the 2D and
// 3D versions match: the star emblem and the ribbon.
export const PIN_STAR = 'M50 36 L55.2 48.8 L69 50 L58.4 59 L61.8 72.6 L50 65.2 L38.2 72.6 L41.6 59 L31 50 L44.8 48.8 Z'
export const PIN_RIBBON = 'M14 76 L86 76 L82 84 L86 92 L14 92 L18 84 Z'

interface PinTheme { enamel: [string, string]; emblem: 'star' | 'crown'; top: string; ribbon: string }

const THEMES: Record<string, PinTheme> = {
  'origins-overnumbered': { enamel: ['#e0743a', '#7a2414'], emblem: 'star', top: 'ORIGINS', ribbon: 'OVERNUMBERED' },
}
// Built-in pin art a badge can use when it has no uploaded art (the staff portal lists these).
export const BUILT_IN_PIN_ART = Object.keys(THEMES).concat('crest')

const FALLBACK: PinTheme = { enamel: ['#8a5d36', '#3b2614'], emblem: 'crown', top: 'TCG HAVEN', ribbon: 'BADGE' }

// `imageUrl`: the badge's uploaded art (from the staff portal) — drawn instead of the built-in art.
export function BadgePin({ art, imageUrl, size = 72, ghost = false }: { art: string; imageUrl?: string; size?: number; ghost?: boolean }) {
  const uid = useId().replace(/:/g, '')
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={badgeAsset(imageUrl)}
        alt=""
        aria-hidden
        draggable={false}
        crossOrigin="anonymous"
        style={{ width: size, height: size * 1.12, objectFit: 'contain', ...(ghost ? { filter: 'grayscale(1)', opacity: 0.55 } : {}) }}
      />
    )
  }
  const t = THEMES[art] ?? FALLBACK
  const id = (n: string) => `${n}-${uid}`
  return (
    <svg
      viewBox={PIN_VIEWBOX}
      width={size}
      height={size * 1.12}
      aria-hidden
      style={ghost ? { filter: 'grayscale(1)', opacity: 0.55 } : undefined}
    >
      <defs>
        <linearGradient id={id('gold')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe7a1" />
          <stop offset="0.35" stopColor="#d4a640" />
          <stop offset="0.6" stopColor="#fff1bf" />
          <stop offset="1" stopColor="#9c6b1c" />
        </linearGradient>
        <radialGradient id={id('enamel')} cx="0.4" cy="0.3" r="0.85">
          <stop offset="0" stopColor={t.enamel[0]} />
          <stop offset="1" stopColor={t.enamel[1]} />
        </radialGradient>
        <linearGradient id={id('gloss')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Gold rim, then the enamel face inset inside it */}
      <path d={PIN_SILHOUETTE} fill={`url(#${id('gold')})`} />
      <path d={PIN_SILHOUETTE} fill={`url(#${id('enamel')})`} transform="translate(50 56) scale(0.86) translate(-50 -56)" />
      <path d={PIN_SILHOUETTE} fill="none" stroke={`url(#${id('gold')})`} strokeWidth="1.6" transform="translate(50 56) scale(0.74) translate(-50 -56)" opacity="0.9" />
      {/* Top label */}
      <text x="50" y="30" textAnchor="middle" fontSize="8.5" fontWeight="800" letterSpacing="1.4" fill="#fbe7a1" fontFamily="Inter, system-ui, sans-serif">{t.top}</text>
      {/* Emblem */}
      {t.emblem === 'star' ? (
        <path
          d={PIN_STAR}
          fill={`url(#${id('gold')})`}
          stroke="#7a4a12"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
      ) : (
        <path d="M33 66 L35 44 L44 54 L50 40 L56 54 L65 44 L67 66 Z" fill={`url(#${id('gold')})`} stroke="#7a4a12" strokeWidth="0.8" strokeLinejoin="round" />
      )}
      {/* Ribbon */}
      <path d={PIN_RIBBON} fill={`url(#${id('gold')})`} />
      <text x="50" y="87.4" textAnchor="middle" fontSize="7" fontWeight="900" letterSpacing="0.6" fill="#4a2a0c" fontFamily="Inter, system-ui, sans-serif">{t.ribbon}</text>
      {/* Enamel gloss */}
      <path d={PIN_SILHOUETTE} fill={`url(#${id('gloss')})`} transform="translate(50 56) scale(0.84) translate(-50 -56)" opacity="0.7" />
    </svg>
  )
}
