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
  // Each block type's own options (the first part of its Style panel)
  wall?: WallStyle
  leader?: { headers?: boolean; highlight?: boolean; pin?: number }           // Badge Achievements
  cards?: { columns?: number; names?: boolean; round?: number }              // Highlighted Cards
  layout?: { align?: 'left' | 'center'; size?: number; items?: 'filled' | 'outlined' | 'plain' } // About, Text, Announcements
  picture?: { height?: number }
}

// ── The Creator Wall's board ──
export type WallSurface = 'cork' | 'felt' | 'wood' | 'chalk' | 'linen' | 'plain'
export interface WallStyle {
  surface?: WallSurface; color?: string; texture?: number   // 0–1
  frame?: 'none' | 'thin' | 'thick'; frameColor?: string
  holders?: 'mixed' | 'pins' | 'tape' | 'none'; pinColor?: string // '' = a mix of colours
  tilt?: number          // 0–1.5 × the usual turn
  columns?: 1 | 2 | 3; shown?: number
}
export const WALL_SURFACES: Array<{ id: WallSurface; name: string; color: string }> = [
  { id: 'cork', name: 'Cork', color: '#c49a6c' },
  { id: 'felt', name: 'Felt', color: '#3f5e46' },
  { id: 'wood', name: 'Wood', color: '#9a6a40' },
  { id: 'chalk', name: 'Chalkboard', color: '#2f3a33' },
  { id: 'linen', name: 'Linen', color: '#ddd0b6' },
  { id: 'plain', name: 'Plain', color: '#e9dcc0' },
]
export function wallLook(w: WallStyle = {}) {
  const surface = w.surface ?? 'cork'
  return {
    surface, color: w.color ?? WALL_SURFACES.find((x) => x.id === surface)!.color, texture: w.texture ?? 0.7,
    frame: w.frame ?? 'thick', frameColor: w.frameColor ?? '#7a5230',
    holders: w.holders ?? 'mixed', pinColor: w.pinColor ?? '', tilt: w.tilt ?? 1,
    columns: w.columns ?? 2, shown: w.shown ?? 6,
  }
}
const rgba = (hex: string, a: number) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})` }
/** A board surface as flat CSS — one colour with its pattern (specks, fibres, grain, weave), never shading */
export function surfaceCss(surface: WallSurface, color: string, texture: number): React.CSSProperties {
  const dk = mix(color, '#000000', 0.45), lt = mix(color, '#ffffff', 0.45), t = texture
  switch (surface) {
    case 'cork': return {
      backgroundColor: color,
      backgroundImage: `radial-gradient(circle at 30% 40%, ${rgba(dk, 0.6 * t)} 0 0.9px, transparent 1.3px), radial-gradient(circle at 70% 70%, ${rgba(lt, 0.55 * t)} 0 0.8px, transparent 1.2px), radial-gradient(circle at 50% 20%, ${rgba(dk, 0.45 * t)} 0 1.1px, transparent 1.5px)`,
      backgroundSize: '7px 7px, 9px 9px, 13px 11px',
    }
    case 'felt': return {
      backgroundColor: color,
      backgroundImage: `radial-gradient(circle at 50% 50%, ${rgba(lt, 0.18 * t)} 0 0.6px, transparent 0.9px), radial-gradient(circle at 20% 80%, ${rgba(dk, 0.3 * t)} 0 0.6px, transparent 0.9px)`,
      backgroundSize: '3px 3px, 4px 5px',
    }
    case 'wood': return {
      backgroundColor: color,
      backgroundImage: `repeating-linear-gradient(90deg, transparent 0 138px, ${rgba(dk, 0.55 * t)} 138px 140px), repeating-linear-gradient(0deg, transparent 0 7px, ${rgba(dk, 0.16 * t)} 7px 8px, transparent 8px 19px, ${rgba(lt, 0.12 * t)} 19px 20px)`,
    }
    case 'chalk': return {
      backgroundColor: color,
      backgroundImage: `radial-gradient(circle at 40% 60%, ${rgba('#ffffff', 0.07 * t)} 0 1px, transparent 1.6px), radial-gradient(circle at 80% 20%, ${rgba('#ffffff', 0.05 * t)} 0 1.4px, transparent 2px)`,
      backgroundSize: '9px 9px, 23px 17px',
    }
    case 'linen': return {
      backgroundColor: color,
      backgroundImage: `repeating-linear-gradient(0deg, ${rgba(dk, 0.14 * t)} 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, ${rgba(dk, 0.1 * t)} 0 1px, transparent 1px 4px)`,
    }
    default: return { backgroundColor: color }
  }
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
