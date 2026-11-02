// The right-sized copy of a card image for where it's shown. Card sources serve originals of
// 0.2–0.8MB (Riftbound's are 744×1039 PNGs, ~780KB; Pokémon hi-res ~845KB), and a phone showing a
// Cardex grid of 80 of them downloaded ~60MB. Every source offers smaller copies, so:
//
//   'thumb' — list rows, toasts, small previews (≲ 80px shown)        ~200px wide
//   'grid'  — Cardex / Portfolio / collection tiles (≲ 140px shown)   ~400px wide (sharp at 3×)
//   'full'  — the zoomed card / card detail page: a clear, full-size copy to admire
//
// Measured on Riftbound Origins #1: original 779KB → grid 30KB (WebP), visually identical at tile
// size on a 3× phone screen. Unknown hosts (custom uploads etc.) are returned unchanged.

export type CardImageSize = 'thumb' | 'grid' | 'full'

const WIDTH: Record<Exclude<CardImageSize, 'full'>, number> = { thumb: 200, grid: 400 }

export function cardImage(url: string | undefined, size: CardImageSize): string | undefined {
  if (!url) return url
  let u: URL
  try { u = new URL(url) } catch { return url }

  switch (u.hostname) {
    // Riftbound (Riot's Sanity CDN): resizes and re-encodes on request
    case 'cmsassets.rgpub.io': {
      u.searchParams.set('fm', 'webp')
      if (size === 'full') { u.searchParams.delete('w'); u.searchParams.set('q', '90') }
      else { u.searchParams.set('w', String(WIDTH[size])); u.searchParams.set('q', '80') }
      return u.toString()
    }
    // Pokémon: no resizing on the source, so tiles go through wsrv.nl (a free image proxy on a
    // global CDN). If it ever fails, ClientWrapper's image error handler falls back to the original.
    case 'images.pokemontcg.io': {
      const hires = u.pathname.replace(/(\/[^/]+)\.png$/, (m, base) => (base.endsWith('_hires') ? m : `${base}_hires.png`))
      if (size === 'full') return `${u.origin}${hires}`
      return `https://wsrv.nl/?url=${encodeURIComponent(`images.pokemontcg.io${hires}`)}&w=${WIDTH[size]}&output=webp&q=80`
    }
    // Lorcana: lorcast's own sizes
    case 'cards.lorcast.io':
      return url.replace(/\/digital\/(small|normal|large)\//, `/digital/${size === 'thumb' ? 'small' : size === 'grid' ? 'normal' : 'large'}/`)
    // Magic: Scryfall's own sizes
    case 'cards.scryfall.io':
      return url.replace(/\/(small|normal|large|png)\/front\//, `/${size === 'thumb' ? 'small' : size === 'grid' ? 'normal' : 'large'}/front/`)
        .replace(/\.png(\?|$)/, '.jpg$1')
    // TCGplayer product photos (One Piece, Japanese Pokémon, TCGplayer-only promos)
    case 'tcgplayer-cdn.tcgplayer.com':
      return url.replace(/_(\d+w|in_\d+x\d+)\.jpg/, `_${size === 'thumb' ? '200w' : size === 'grid' ? 'in_400x400' : 'in_1000x1000'}.jpg`)
    default:
      return url
  }
}

/** The original behind a resized copy we built (wsrv.nl), for falling back when the proxy fails. */
export function originalImage(src: string): string | null {
  if (!src.startsWith('https://wsrv.nl/')) return null
  const inner = new URL(src).searchParams.get('url')
  return inner ? `https://${inner}` : null
}

// Shown in place of a card image that's missing or won't load (TCGplayer hasn't photographed a
// new product yet, say) instead of the browser's broken-image icon. Card-shaped, so a grid keeps
// its layout. ClientWrapper's image error handler swaps it in for any card-CDN image that fails.
export const NO_CARD_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350">' +
  '<rect x="3" y="3" width="244" height="344" rx="14" fill="#efe4cc" stroke="#d6c49f" stroke-width="4"/>' +
  '<g fill="none" stroke="#b3a27c" stroke-width="7" stroke-linejoin="round">' +
  '<rect x="85" y="125" width="80" height="62" rx="8"/><path d="M93 179l22-24 16 16 10-10 16 18"/></g>' +
  '<circle cx="146" cy="143" r="7" fill="#b3a27c"/>' +
  '<text x="125" y="226" text-anchor="middle" font-family="system-ui,sans-serif" font-size="24" font-weight="600" fill="#9a8a66">No Image</text>' +
  '</svg>',
)}`

const CARD_IMAGE_HOSTS = new Set([
  'cmsassets.rgpub.io', 'images.pokemontcg.io', 'cards.lorcast.io', 'cards.scryfall.io',
  'tcgplayer-cdn.tcgplayer.com', 'static.dotgg.gg', 'en.onepiece-cardgame.com',
])

/** Whether a failed image is a card picture from one of the card sources (not an avatar etc.). */
export function isCardImageUrl(src: string): boolean {
  try { return CARD_IMAGE_HOSTS.has(new URL(src).hostname) } catch { return false }
}
