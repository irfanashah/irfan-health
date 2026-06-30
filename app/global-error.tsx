'use client'

// Global error boundary — catches throws in the root layout itself,
// where app/error.tsx can't render (its layout might be the thing that
// failed). Must render its own <html>/<body>.
//
// Plain inline styles only — the global stylesheet may not have loaded
// (layout error => layout's CSS import failed). Stay self-contained.

import { useEffect } from 'react'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error('[global error]', { message: error.message, digest: error.digest })
  }, [error])

  return (
    <html>
      <body
        style={{
          minHeight: '100vh',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#0a0a0a',
          color: '#e5e5e5',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>Something went wrong loading the app</h1>
          <p style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.5, margin: '0 0 16px' }}>
            The root layout failed. Try reloading; if it persists, check the deploy and Supabase status.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, opacity: 0.55, margin: '0 0 16px' }}>
              Reference: <code style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</code>
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              background: '#00C896',
              color: '#000',
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
