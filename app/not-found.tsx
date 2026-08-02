export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
      <div className="text-6xl">🃏</div>
      <h1 className="text-2xl font-bold text-white">Page not found</h1>
      <p className="text-slate-400 text-sm">This page doesn&apos;t exist.</p>
      <a href="/" className="btn-primary mt-2">Go home</a>
    </div>
  )
}
