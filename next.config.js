/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
      // api.pokemontcg.io started serving card images off this host instead — keep both since
      // it's an upstream choice, not something this app controls, and could change back.
      { protocol: 'https', hostname: 'images.scrydex.com' },
      { protocol: 'https', hostname: 'cards.lorcast.io' },
      { protocol: 'https', hostname: 'lorcanaplayer.com' },
      { protocol: 'https', hostname: '**.tcgplayer.com' },
      { protocol: 'https', hostname: 'cmsassets.rgpub.io' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
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
