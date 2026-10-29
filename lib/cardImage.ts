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
