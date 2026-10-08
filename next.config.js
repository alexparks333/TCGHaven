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
  // Baseline security headers on every response. Deliberately no Cross-Origin-Opener-Policy
  // (it breaks Firebase's Google sign-in popup) and no strict Content-Security-Policy (Firebase
  // Auth loads its own iframe/scripts from the auth domain) — these four are the safe set.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },                      // no embedding in other sites (clickjacking)
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }]
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
