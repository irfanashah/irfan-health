'use client'

// Error boundary for the App Router. Any unhandled throw inside a
// segment (e.g. one of app/page.tsx's parallel readers raising) lands
// here instead of Next's raw error page.
//
// Same calm framing as the rest of the platform — neutral, no alarming
// copy, an actionable retry. Reuses semantic theme tokens so dark/
// light both look right. The matching `app/global-error.tsx` handles
// failures in the root layout itself (where this boundary can't render).

import { useEffect } from 'react'
import Link from 'next/link'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ErrorPage({ error, reset }: Props) {
  useEffect(() => {
    // Best-effort log — the digest correlates with Vercel function logs.
    console.error('[app error]', { message: error.message, digest: error.digest })
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="text-xl font-semibold text-foreground mb-3">Something went wrong loading this page</h1>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          A data source the page reads failed to return. This is usually transient — try again, or head back to the
          dashboard.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground mb-6">
            Reference: <code className="bg-card border border-border px-1.5 py-0.5 rounded font-mono">{error.digest}</code>
          </p>
        )}
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-md bg-card border border-border text-foreground text-sm font-medium hover:bg-muted/50 transition"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
