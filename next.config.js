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
  // Firebase's sign-in helper pages served from our own address (lib/firebase/config.ts ownSite):
  // the Google pop-up then shows www.tcghaven.org, not tcghaven-85a34.firebaseapp.com
  async rewrites() {
    return [
      { source: '/__/auth/:path*', destination: 'https://tcghaven-85a34.firebaseapp.com/__/auth/:path*' },
      { source: '/__/firebase/:path*', destination: 'https://tcghaven-85a34.firebaseapp.com/__/firebase/:path*' },
    ]
  },
  async headers() {
    return [{
      // The sign-in helper (/__/auth/iframe) is framed by our own pages, so it gets SAMEORIGIN
      // below instead of DENY
      source: '/((?!__/auth/).*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },                      // no embedding in other sites (clickjacking)
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }, {
      source: '/__/auth/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }]
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // fs/path are Node-only — catalog loading always runs server-side via /api/cards/search
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, 'fs/promises': false }
      // @gltf-transform/core (the staff portal's in-browser pin compression, lib/pinOptimize.ts)
      // references node:fs / node:path for its Node-only file reader; webpack can't resolve the
      // node: scheme, so strip it and let the fallbacks above stub the modules out
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, '')
      }))
    }
    return config
  },
}

module.exports = nextConfig
