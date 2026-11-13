// A community page block's look (docs/creators.md "Block styles"): the palette button on each block in the
// Studio opens its Style panel — a theme, or any colours, the title and text fonts, the title size and the
// finish. Stored on the block (`block.style`, communities/{uid}.page), only what the creator changed; the
// rest comes from the block type's default theme (Badge Achievements is Walnut, the others Parchment).

import type { BlockType } from './communityBlocks'

export type FontId = 'engraved' | 'classic' | 'elegant' | 'storybook' | 'gothic' | 'bold' | 'typewriter' | 'handwritten' | 'modern' | 'book'

export interface BlockStyle {
  bg?: string; title?: string; text?: string; accent?: string
  titleFont?: FontId; bodyFont?: FontId
  titleSize?: number   // × the normal size, 0.8–1.6
  grain?: boolean; corners?: boolean; border?: boolean
  radius?: number      // px, 0–28
  frame?: boolean      // a Picture: sit it on a panel (mat) of the background colour
}

export const BLOCK_FONTS: Array<{ id: FontId; name: string; css: string; title: boolean; body: boolean; upper?: boolean }> = [
  { id: 'engraved', name: 'Engraved', css: 'var(--font-engraved), Georgia, serif', title: true, body: false },
  { id: 'classic', name: 'Classic', css: 'var(--font-playfair), Georgia, serif', title: true, body: false },
  { id: 'elegant', name: 'Elegant', css: 'var(--font-cormorant), Georgia, serif', title: true, body: true },
  { id: 'storybook', name: 'Storybook', css: 'var(--font-uncial), Georgia, serif', title: true, body: false },
  { id: 'gothic', name: 'Gothic', css: 'var(--font-pirata), Georgia, serif', title: true, body: false },
  { id: 'bold', name: 'Bold', css: 'var(--font-bebas), Impact, sans-serif', title: true, body: false },
  { id: 'typewriter', name: 'Typewriter', css: 'var(--font-elite), "Courier New", monospace', title: true, body: true },
  { id: 'handwritten', name: 'Handwritten', css: 'var(--font-caveat), cursive', title: true, body: true },
  { id: 'modern', name: 'Modern', css: 'Inter, ui-sans-serif, system-ui, sans-serif', title: true, body: true },
  { id: 'book', name: 'Book', css: 'Georgia, "Times New Roman", serif', title: true, body: true },
]
export const fontCss = (id: FontId) => (BLOCK_FONTS.find((f) => f.id === id) ?? BLOCK_FONTS[0]).css

export interface BlockTheme { id: string; name: string; bg: string; title: string; text: string; accent: string }
export const BLOCK_THEMES: BlockTheme[] = [
  { id: 'parchment', name: 'Parchment', bg: '#efe4cc', title: '#2b2014', text: '#5c4a35', accent: '#8a6420' },
  { id: 'walnut', name: 'Walnut', bg: '#2a2119', title: '#f0dfb8', text: '#d9c9a8', accent: '#e0b866' },
  { id: 'cream', name: 'Cream', bg: '#fbf6ea', title: '#3a2a1a', text: '#5c4a35', accent: '#7a5230' },
  { id: 'ink', name: 'Ink', bg: '#1d1f24', title: '#eceef2', text: '#b9bec8', accent: '#c9d2e0' },
  { id: 'forest', name: 'Forest', bg: '#1f3328', title: '#efe6c8', text: '#c8d2bf', accent: '#d9b25c' },
  { id: 'burgundy', name: 'Burgundy', bg: '#3a1517', title: '#f6e2c8', text: '#e2c7b4', accent: '#e6b45c' },
  { id: 'navy', name: 'Navy', bg: '#16233a', title: '#ecf0f6', text: '#bcc7d8', accent: '#d8b46a' },
  { id: 'stone', name: 'Stone', bg: '#dcd6c8', title: '#26241f', text: '#4c4840', accent: '#6a5a3c' },
]

/** Everything a block is drawn with, the creator's changes laid over its type's default */
export interface BlockLook {
  bg: string; title: string; text: string; accent: string
  titleFont: string; bodyFont: string; titleUpper: boolean; titleSize: number
  grain: boolean; corners: boolean; border: boolean; radius: number; frame: boolean
  muted: string; line: string; tint: string; dark: boolean
}

export const defaultTheme = (t: BlockType) => (t === 'badges' ? BLOCK_THEMES[1] : BLOCK_THEMES[0])

export function blockLook(type: BlockType, s: BlockStyle = {}): BlockLook {
  const th = defaultTheme(type)
  const bg = s.bg ?? th.bg, text = s.text ?? th.text, accent = s.accent ?? th.accent
  return {
    bg, title: s.title ?? th.title, text, accent,
    titleFont: fontCss(s.titleFont ?? 'engraved'), bodyFont: fontCss(s.bodyFont ?? 'modern'),
    titleUpper: false, titleSize: s.titleSize ?? 1,
    grain: s.grain ?? true, corners: s.corners ?? true, border: s.border ?? true, radius: s.radius ?? 14, frame: s.frame ?? false,
    muted: mix(text, bg, 0.3), line: mix(text, bg, 0.78), tint: mix(accent, bg, 0.86), dark: luminance(bg) < 0.35,
  }
}

/** The look as CSS variables, for a block's outer element; everything inside reads them */
export function lookVars(l: BlockLook): React.CSSProperties {
  return {
    '--b-bg': l.bg, '--b-title': l.title, '--b-text': l.text, '--b-accent': l.accent, '--b-muted': l.muted,
    '--b-line': l.line, '--b-tint': l.tint, '--b-title-font': l.titleFont, '--b-body-font': l.bodyFont,
    '--b-hair': mix(l.text, l.bg, 0.86), '--b-hover': mix(l.text, l.bg, 0.94), '--b-corner': mix(l.accent, l.bg, 0.45),
    color: l.text, fontFamily: l.bodyFont,
  } as React.CSSProperties
}

/** The panel behind a block: its colour, paper dots, border and corners */
export function panelStyle(l: BlockLook): React.CSSProperties {
  return {
    ...lookVars(l),
    backgroundColor: l.bg,
    backgroundImage: l.grain ? `radial-gradient(circle at 1px 1px, ${l.dark ? 'rgba(240,220,180,0.06)' : 'rgba(122,101,74,0.08)'} 1px, transparent 0)` : undefined,
    backgroundSize: '16px 16px',
    border: l.border ? `1px solid ${mix(l.text, l.bg, 0.7)}` : '1px solid transparent',
    borderRadius: l.radius,
  }
}

// ── colour helpers ──
function rgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return Number.isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** `a` mixed toward `b` by t (0 = a, 1 = b) */
export function mix(a: string, b: string, t: number) {
  const x = rgb(a), y = rgb(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
