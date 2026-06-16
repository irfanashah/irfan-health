'use client'

import { useState } from 'react'

interface BackfillResult {
  chunksRun: number
  oldestReachedISO: string
  targetStartISO: string
  isComplete: boolean
  recordsWrittenTotal: number
  recordsSkippedTotal: number
  errors?: string[]
}

export function BackfillButton() {
  const [status, setStatus] = useState<
    'idle' | 'running' | 'partial' | 'done' | 'error'
  >('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handleBackfill() {
    setStatus('running')
    setMessage(null)

    try {
      const response = await fetch('/api/backfill/whoop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const text = await response.text()
        setStatus('error')
        setMessage(`HTTP ${response.status}: ${text.slice(0, 200)}`)
        return
      }

      const result = (await response.json()) as BackfillResult
      const oldestDate = result.oldestReachedISO.slice(0, 10)

      if (result.isComplete) {
        setStatus('done')
        setMessage(
          `Backfill complete — reached ${result.targetStartISO.slice(0, 10)}. ` +
            `${result.chunksRun} chunks, wrote ${result.recordsWrittenTotal}, ` +
            `skipped ${result.recordsSkippedTotal}.`
        )
      } else {
        setStatus('partial')
        setMessage(
          `${result.chunksRun} chunks done; oldest reached ${oldestDate}. ` +
            `Wrote ${result.recordsWrittenTotal}, skipped ${result.recordsSkippedTotal}. ` +
            `Click again to continue.`
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
        onClick={handleBackfill}
        disabled={status === 'running'}
        className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium disabled:opacity-50"
      >
        {status === 'running'
          ? 'Backfilling…'
          : 'Backfill Whoop to 2025-01-01'}
      </button>

      {message && (
        <p
          className={`text-sm ${
            status === 'done'
              ? 'text-accent-teal'
              : status === 'error'
              ? 'text-destructive'
              : 'text-muted-foreground'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
