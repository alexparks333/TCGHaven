/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
      { protocol: 'https', hostname: 'cards.lorcast.io' },
      { protocol: 'https', hostname: 'lorcanaplayer.com' },
      { protocol: 'https', hostname: '**.tcgplayer.com' },
      { protocol: 'https', hostname: 'cmsassets.rgpub.io' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // fs/path are Node-only — catalog loading always runs server-side via /api/cards/search
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false }
    }
    return config
  },
}

module.exports = nextConfig
