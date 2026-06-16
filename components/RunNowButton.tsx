'use client'

import { useState } from 'react'

export function RunNowButton() {
  const [status, setStatus] = useState<
    'idle' | 'running' | 'success' | 'error'
  >('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handleRunNow() {
    setStatus('running')
    setMessage(null)

    try {
      const response = await fetch('/api/ingest/whoop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const result = (await response.json()) as {
        status: string
        recordsFound: number
        recordsWritten: number
        recordsSkipped: number
        errors?: string[]
      }

      if (!response.ok || result.status === 'error') {
        setStatus('error')
        setMessage(result.errors?.[0] ?? 'Unknown error')
      } else {
        setStatus('success')
        setMessage(
          `Done — found ${result.recordsFound}, wrote ${result.recordsWritten}, skipped ${result.recordsSkipped}`
        )
      }
    } catch (err) {
      setStatus('error')
      setMessage((err as Error).message)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        onClick={handleRunNow}
        disabled={status === 'running'}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
      >
        {status === 'running' ? 'Running…' : 'Run Whoop ingestion now'}
      </button>

      {message && (
        <p
          className={`text-sm ${
            status === 'success' ? 'text-accent-teal' : 'text-destructive'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
