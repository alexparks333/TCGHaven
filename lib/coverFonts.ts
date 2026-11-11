// Fonts a creator can give their book's title (Creator Studio cover designer — docs/creators.md).
// Google Fonts, loaded only when a cover uses one (or the designer shows them all), so the rest of
// the app never downloads them.

export interface CoverFont { id: string; name: string; family: string; css: string; weight?: number; upper?: boolean }

export const COVER_FONTS: CoverFont[] = [
  { id: 'classic', name: 'Classic', family: '', css: 'inherit', weight: 900 },
  { id: 'cinzel', name: 'Cinzel', family: 'Cinzel:wght@700', css: "'Cinzel', serif", weight: 700, upper: true },
  { id: 'cinzel-deco', name: 'Cinzel Decorative', family: 'Cinzel+Decorative:wght@700', css: "'Cinzel Decorative', serif", weight: 700 },
  { id: 'playfair', name: 'Playfair', family: 'Playfair+Display:wght@800', css: "'Playfair Display', serif", weight: 800 },
  { id: 'cormorant', name: 'Cormorant', family: 'Cormorant+Garamond:wght@700', css: "'Cormorant Garamond', serif", weight: 700 },
  { id: 'abril', name: 'Abril Fatface', family: 'Abril+Fatface', css: "'Abril Fatface', serif", weight: 400 },
  { id: 'uncial', name: 'Uncial', family: 'Uncial+Antiqua', css: "'Uncial Antiqua', serif", weight: 400 },
  { id: 'medieval', name: 'Medieval', family: 'MedievalSharp', css: "'MedievalSharp', serif", weight: 400 },
  { id: 'bebas', name: 'Bebas Neue', family: 'Bebas+Neue', css: "'Bebas Neue', sans-serif", weight: 400, upper: true },
  { id: 'anton', name: 'Anton', family: 'Anton', css: "'Anton', sans-serif", weight: 400, upper: true },
  { id: 'oswald', name: 'Oswald', family: 'Oswald:wght@700', css: "'Oswald', sans-serif", weight: 700 },
  { id: 'righteous', name: 'Righteous', family: 'Righteous', css: "'Righteous', sans-serif", weight: 400 },
  { id: 'fredoka', name: 'Fredoka', family: 'Fredoka:wght@700', css: "'Fredoka', sans-serif", weight: 700 },
  { id: 'bungee', name: 'Bungee', family: 'Bungee', css: "'Bungee', sans-serif", weight: 400, upper: true },
  { id: 'bangers', name: 'Bangers', family: 'Bangers', css: "'Bangers', cursive", weight: 400 },
  { id: 'orbitron', name: 'Orbitron', family: 'Orbitron:wght@800', css: "'Orbitron', sans-serif", weight: 800 },
  { id: 'pixel', name: 'Pixel', family: 'Press+Start+2P', css: "'Press Start 2P', monospace", weight: 400 },
  { id: 'lobster', name: 'Lobster', family: 'Lobster', css: "'Lobster', cursive", weight: 400 },
  { id: 'pacifico', name: 'Pacifico', family: 'Pacifico', css: "'Pacifico', cursive", weight: 400 },
  { id: 'marker', name: 'Marker', family: 'Permanent+Marker', css: "'Permanent Marker', cursive", weight: 400 },
  { id: 'creepster', name: 'Creepster', family: 'Creepster', css: "'Creepster', cursive", weight: 400 },
]

export const coverFont = (id: string | undefined): CoverFont => COVER_FONTS.find((f) => f.id === id) ?? COVER_FONTS[0]

const loaded = new Set<string>()

/** Adds the Google Fonts stylesheet for these fonts (each once per page) */
export function loadCoverFonts(ids: Array<string | undefined>) {
  if (typeof document === 'undefined') return
  const families = ids.map((id) => coverFont(id).family).filter((f) => f && !loaded.has(f))
  if (!families.length) return
  families.forEach((f) => loaded.add(f))
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`
  document.head.appendChild(link)
}
