// Fonts a creator can give their book's title (Creator Studio cover designer — docs/creators.md).
// Google Fonts, loaded only when a cover uses one (or the designer shows them all), so the rest of
// the app never downloads them.

export type FontGroup = 'Elegant' | 'Classic' | 'Clean' | 'Bold' | 'Fun' | 'Script' | 'Retro' | 'Spooky'
export interface CoverFont { id: string; name: string; family: string; css: string; weight?: number; upper?: boolean; group: FontGroup }
export const FONT_GROUPS: FontGroup[] = ['Elegant', 'Classic', 'Clean', 'Bold', 'Fun', 'Script', 'Retro', 'Spooky']

const f = (id: string, name: string, family: string, css: string, group: FontGroup, weight = 400, upper = false): CoverFont => ({ id, name, family, css, group, weight, upper })

export const COVER_FONTS: CoverFont[] = [
  // Elegant — TCG Haven's own book lettering (Cinzel, already on every page as --font-engraved)
  // and other fine engraved / high-contrast serifs; best with a foil finish
  f('haven', 'Haven', '', 'var(--font-engraved), Georgia, serif', 'Elegant', 700, true),
  f('cinzel-deco', 'Cinzel Decorative', 'Cinzel+Decorative:wght@700', "'Cinzel Decorative', serif", 'Elegant', 700),
  f('playfair-sc', 'Playfair SC', 'Playfair+Display+SC:wght@700', "'Playfair Display SC', serif", 'Elegant', 700),
  f('marcellus', 'Marcellus', 'Marcellus+SC', "'Marcellus SC', serif", 'Elegant'),
  f('forum', 'Forum', 'Forum', "'Forum', serif", 'Elegant', 400, true),
  f('italiana', 'Italiana', 'Italiana', "'Italiana', serif", 'Elegant', 400, true),
  f('bodoni', 'Bodoni', 'Bodoni+Moda:wght@700', "'Bodoni Moda', serif", 'Elegant', 700),
  f('cormorant', 'Cormorant', 'Cormorant+Garamond:wght@700', "'Cormorant Garamond', serif", 'Elegant', 700),
  // Classic — engraved, bookish
  f('classic', 'Classic', '', 'inherit', 'Classic', 900),
  f('cinzel', 'Cinzel', 'Cinzel:wght@700', "'Cinzel', serif", 'Classic', 700, true),
  f('playfair', 'Playfair', 'Playfair+Display:wght@800', "'Playfair Display', serif", 'Classic', 800),
  f('abril', 'Abril Fatface', 'Abril+Fatface', "'Abril Fatface', serif", 'Classic'),
  f('dm-serif', 'DM Serif', 'DM+Serif+Display', "'DM Serif Display', serif", 'Classic'),
  f('lora', 'Lora', 'Lora:wght@700', "'Lora', serif", 'Classic', 700),
  f('merriweather', 'Merriweather', 'Merriweather:wght@900', "'Merriweather', serif", 'Classic', 900),
  f('uncial', 'Uncial', 'Uncial+Antiqua', "'Uncial Antiqua', serif", 'Classic'),
  f('medieval', 'Medieval', 'MedievalSharp', "'MedievalSharp', serif", 'Classic'),
  f('pirata', 'Pirata', 'Pirata+One', "'Pirata One', serif", 'Classic'),
  // Clean — normal, modern
  f('montserrat', 'Montserrat', 'Montserrat:wght@800', "'Montserrat', sans-serif", 'Clean', 800),
  f('poppins', 'Poppins', 'Poppins:wght@800', "'Poppins', sans-serif", 'Clean', 800),
  f('raleway', 'Raleway', 'Raleway:wght@800', "'Raleway', sans-serif", 'Clean', 800),
  f('oswald', 'Oswald', 'Oswald:wght@700', "'Oswald', sans-serif", 'Clean', 700),
  f('roboto-slab', 'Roboto Slab', 'Roboto+Slab:wght@800', "'Roboto Slab', serif", 'Clean', 800),
  f('archivo', 'Archivo Black', 'Archivo+Black', "'Archivo Black', sans-serif", 'Clean'),
  f('fredoka', 'Fredoka', 'Fredoka:wght@700', "'Fredoka', sans-serif", 'Clean', 700),
  // Bold — big display
  f('bebas', 'Bebas Neue', 'Bebas+Neue', "'Bebas Neue', sans-serif", 'Bold', 400, true),
  f('anton', 'Anton', 'Anton', "'Anton', sans-serif", 'Bold', 400, true),
  f('bungee', 'Bungee', 'Bungee', "'Bungee', sans-serif", 'Bold', 400, true),
  f('black-ops', 'Black Ops', 'Black+Ops+One', "'Black Ops One', sans-serif", 'Bold'),
  f('russo', 'Russo One', 'Russo+One', "'Russo One', sans-serif", 'Bold'),
  f('titan', 'Titan One', 'Titan+One', "'Titan One', sans-serif", 'Bold'),
  f('rubik-mono', 'Rubik Mono', 'Rubik+Mono+One', "'Rubik Mono One', sans-serif", 'Bold'),
  f('orbitron', 'Orbitron', 'Orbitron:wght@800', "'Orbitron', sans-serif", 'Bold', 800),
  f('zen-dots', 'Zen Dots', 'Zen+Dots', "'Zen Dots', sans-serif", 'Bold'),
  f('audiowide', 'Audiowide', 'Audiowide', "'Audiowide', sans-serif", 'Bold'),
  // Fun
  f('bangers', 'Bangers', 'Bangers', "'Bangers', cursive", 'Fun'),
  f('luckiest', 'Luckiest Guy', 'Luckiest+Guy', "'Luckiest Guy', cursive", 'Fun'),
  f('lilita', 'Lilita One', 'Lilita+One', "'Lilita One', cursive", 'Fun'),
  f('chewy', 'Chewy', 'Chewy', "'Chewy', cursive", 'Fun'),
  f('righteous', 'Righteous', 'Righteous', "'Righteous', sans-serif", 'Fun'),
  f('shrikhand', 'Shrikhand', 'Shrikhand', "'Shrikhand', cursive", 'Fun'),
  f('marker', 'Marker', 'Permanent+Marker', "'Permanent Marker', cursive", 'Fun'),
  f('amatic', 'Amatic', 'Amatic+SC:wght@700', "'Amatic SC', cursive", 'Fun', 700),
  f('rye', 'Rye', 'Rye', "'Rye', serif", 'Fun'),
  // Script
  f('lobster', 'Lobster', 'Lobster', "'Lobster', cursive", 'Script'),
  f('pacifico', 'Pacifico', 'Pacifico', "'Pacifico', cursive", 'Script'),
  f('dancing', 'Dancing Script', 'Dancing+Script:wght@700', "'Dancing Script', cursive", 'Script', 700),
  f('great-vibes', 'Great Vibes', 'Great+Vibes', "'Great Vibes', cursive", 'Script'),
  f('kaushan', 'Kaushan', 'Kaushan+Script', "'Kaushan Script', cursive", 'Script'),
  // Retro
  f('pixel', 'Pixel', 'Press+Start+2P', "'Press Start 2P', monospace", 'Retro'),
  f('silkscreen', 'Silkscreen', 'Silkscreen', "'Silkscreen', monospace", 'Retro'),
  f('monoton', 'Monoton', 'Monoton', "'Monoton', cursive", 'Retro'),
  f('faster', 'Faster One', 'Faster+One', "'Faster One', cursive", 'Retro'),
  f('bungee-shade', 'Bungee Shade', 'Bungee+Shade', "'Bungee Shade', cursive", 'Retro', 400, true),
  f('typewriter', 'Typewriter', 'Special+Elite', "'Special Elite', cursive", 'Retro'),
  // Spooky
  f('creepster', 'Creepster', 'Creepster', "'Creepster', cursive", 'Spooky'),
  f('nosifer', 'Nosifer', 'Nosifer', "'Nosifer', cursive", 'Spooky'),
  f('metal', 'Metal Mania', 'Metal+Mania', "'Metal Mania', cursive", 'Spooky'),
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

// The title's finish (CoverStyle.titleFinish): a flat colour, or metal foil like TCG Haven's own
// covers (a gradient inside the letters — globals.css .cover-title is the gold one)
export const TITLE_FINISHES: Array<{ id: string; name: string; gradient: string }> = [
  { id: 'gold', name: 'Gold', gradient: '#fff6d6 0%, #f6d98c 40%, #d9a948 75%, #f8e2a2 100%' },
  { id: 'silver', name: 'Silver', gradient: '#ffffff 0%, #e3e7ec 40%, #9aa3ad 75%, #eef1f4 100%' },
  { id: 'rose', name: 'Rose gold', gradient: '#fff1ec 0%, #f2b6a2 40%, #c97a63 75%, #f6cfc2 100%' },
  { id: 'copper', name: 'Copper', gradient: '#ffe4cc 0%, #e8a066 40%, #a85a2a 75%, #f0b98a 100%' },
  { id: 'emerald', name: 'Emerald', gradient: '#eafff4 0%, #8fe3b9 40%, #2f9e6a 75%, #b6f0d2 100%' },
  { id: 'sapphire', name: 'Sapphire', gradient: '#eef4ff 0%, #9fc0ff 40%, #3d6fd1 75%, #c4d8ff 100%' },
  { id: 'amethyst', name: 'Amethyst', gradient: '#f6eeff 0%, #cfa8ff 40%, #8a4fd6 75%, #e2ccff 100%' },
]
export const titleFinish = (id: string | undefined) => TITLE_FINISHES.find((x) => x.id === id)
