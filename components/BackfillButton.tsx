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
  mode: 'auto' | 'sweep'
}

type Mode = 'auto' | 'sweep'
type Status = 'idle' | 'running' | 'partial' | 'done' | 'error'

export function BackfillButton() {
  const [autoStatus, setAutoStatus] = useState<Status>('idle')
  const [autoMessage, setAutoMessage] = useState<string | null>(null)
  const [sweepStatus, setSweepStatus] = useState<Status>('idle')
  const [sweepMessage, setSweepMessage] = useState<string | null>(null)
  // Cursor for resuming sweep across clicks. Without this, every sweep click
  // restarts from "now" and redoes the same chunks.
  const [sweepCursor, setSweepCursor] = useState<string | null>(null)

  async function runBackfill(mode: Mode) {
    const setStatus = mode === 'sweep' ? setSweepStatus : setAutoStatus
    const setMessage = mode === 'sweep' ? setSweepMessage : setAutoMessage

    setStatus('running')
    setMessage(null)

    const body: Record<string, unknown> = { mode }
    if (mode === 'sweep' && sweepCursor) {
      body.sweepStart = sweepCursor
    }

    try {
      const response = await fetch('/api/backfill/whoop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text()
        setStatus('error')
        setMessage(`HTTP ${response.status}: ${text.slice(0, 200)}`)
        return
      }

      const result = (await response.json()) as BackfillResult
      const oldestDate = result.oldestReachedISO.slice(0, 10)

      if (mode === 'sweep') {
        if (result.isComplete) {
          setSweepCursor(null)
        } else {
          setSweepCursor(result.oldestReachedISO)
        }
      }

      if (result.isComplete) {
        setStatus('done')
        setMessage(
          `Complete — reached ${result.targetStartISO.slice(0, 10)}. ` +
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

  function colourFor(status: Status): string {
    if (status === 'done') return 'text-accent-teal'
    if (status === 'error') return 'text-destructive'
    return 'text-muted-foreground'
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-2">
        <button
          onClick={() => runBackfill('auto')}
          disabled={autoStatus === 'running' || sweepStatus === 'running'}
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {autoStatus === 'running'
            ? 'Backfilling…'
            : 'Backfill Whoop to 2025-01-01 (auto)'}
        </button>
        {autoMessage && (
          <p className={`text-sm ${colourFor(autoStatus)}`}>{autoMessage}</p>
        )}
      </div>

      <div className="space-y-2">
        <button
          onClick={() => runBackfill('sweep')}
          disabled={sweepStatus === 'running' || autoStatus === 'running'}
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {sweepStatus === 'running'
            ? 'Sweeping…'
            : sweepCursor
            ? `Continue sweep (from ${sweepCursor.slice(0, 10)})`
            : 'Full sweep 2025-01-01 → today (catches gaps)'}
        </button>
        {sweepMessage && (
          <p className={`text-sm ${colourFor(sweepStatus)}`}>{sweepMessage}</p>
        )}
        <p className="text-xs text-muted-foreground/70">
          Sweep walks the full window in 30-day chunks regardless of what's already in the DB.
          Dedup keeps it idempotent — anything already there is counted as skipped.
        </p>
      </div>
    </div>
  )
}
