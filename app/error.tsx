'use client'

import { useEffect } from 'react'

// Shown instead of a blank screen when a page throws while rendering. Keeps the app shell
// (sidebar / bottom bar) around it, so people can just try again or go elsewhere.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" className="w-20 h-20 object-contain" />
      <h1 className="text-2xl font-bold text-ink">Something went wrong</h1>
      <p className="text-slate-400 text-sm max-w-sm">
        This page hit an unexpected error. Your collection is safe — nothing was lost.
      </p>
      <div className="flex gap-2 mt-2">
        <button onClick={reset} className="btn-primary">Try again</button>
        <a href="/" className="btn-secondary">Go home</a>
      </div>
    </div>
  )
}
