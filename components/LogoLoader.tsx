// The one loading state used everywhere in the app — the TCGHaven logo + wordmark with a short
// label underneath. Deliberately the same everywhere (full-page data load, Cardex sets, a set's
// cards, Pack Analysis prices, ...) so a user never sees a blank/$0/"0 cards" screen and
// wonders whether their collection was lost. Still images for now; this is the single place to
// swap in an animated logo later.
//
// `progress` is optional and must be REAL — a count of things that have actually finished
// (Firestore reads, images), never a timer. Loads with nothing honest to count (a single fast
// request) just omit it rather than faking a bar.
export interface LoaderProgress {
  done: number
  total: number
  unit?: string // e.g. "images" → "120 of 347 images"
}

export function LogoLoader({
  label = 'Loading your collection…',
  fullScreen = false,
  progress,
}: {
  label?: string
  fullScreen?: boolean
  progress?: LoaderProgress
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        fullScreen
          ? 'flex flex-col items-center justify-center min-h-screen gap-4'
          : 'flex flex-col items-center justify-center py-24 gap-4'
      }
    >
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="w-20 h-20 object-contain" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-text.png" alt="TCGHaven" className="w-48 h-auto object-contain" />
      </div>
      <p className="text-slate-500 text-sm">{label}</p>
      {progress && <LoadingBar progress={progress} className="w-64" />}
    </div>
  )
}

// The bar on its own — also used inline (e.g. above the Cardex grid while card art loads).
// The width transition only smooths the jump between two real values; it never moves on its own.
export function LoadingBar({ progress, className = '' }: { progress: LoaderProgress; className?: string }) {
  const pct = progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0
  return (
    <div className={className}>
      <div
        className="h-1.5 rounded-full bg-slate-800 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
      >
        <div className="h-full rounded-full bg-violet-700 transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 text-center text-[11px] text-slate-500 tabular-nums">
        {progress.done} of {progress.total}{progress.unit ? ` ${progress.unit}` : ''}
      </div>
    </div>
  )
}
