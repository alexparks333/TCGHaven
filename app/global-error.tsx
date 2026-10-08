'use client'

// Last-resort fallback for an error in the root layout itself (where app/error.tsx can't render,
// since it lives inside that layout). Must provide its own <html>/<body>, and can't rely on the
// app's CSS having loaded, so it's styled inline in the parchment colors.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#d9c6a0', color: '#2b2014', fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 16 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>TCGHaven hit an unexpected error</h1>
        <p style={{ margin: 0, opacity: 0.75 }}>Your collection is safe — nothing was lost.</p>
        <button onClick={reset} style={{ background: '#6b4a2b', color: '#fff', border: 0, borderRadius: 12, padding: '10px 18px', fontSize: 14, cursor: 'pointer' }}>
          Try again
        </button>
      </body>
    </html>
  )
}
