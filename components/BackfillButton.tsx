'use client'

import { useEffect, useState } from 'react'

const SWEEP_CURSOR_KEY = 'whoop-sweep-cursor'

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
  // Cursor for resuming sweep across clicks AND across page refreshes/tab closes.
  // Persisted in localStorage so the sweep can pick up where it left off — without
  // this, every refresh restarts from "now" and re-does the recent dense window.
  const [sweepCursor, setSweepCursorRaw] = useState<string | null>(null)

  useEffect(() => {
    // Deferred into a callback (not a bare synchronous call as the effect's
    // first statement) — reads localStorage a tick after mount rather than
    // as the effect body's direct first action; same practical timing
    // (imperceptible), avoids the direct-setState-in-effect pattern while
    // staying hydration-safe (SSR/first-paint always sees `null`).
    const t = setTimeout(() => {
      const stored = window.localStorage.getItem(SWEEP_CURSOR_KEY)
      if (stored) setSweepCursorRaw(stored)
    }, 0)
    return () => clearTimeout(t)
  }, [])

  function setSweepCursor(next: string | null) {
    setSweepCursorRaw(next)
    if (next === null) {
      window.localStorage.removeItem(SWEEP_CURSOR_KEY)
    } else {
      window.localStorage.setItem(SWEEP_CURSOR_KEY, next)
    }
  }

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
        <div className="flex items-center gap-2">
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
          {sweepCursor && sweepStatus !== 'running' && (
            <button
              onClick={() => setSweepCursor(null)}
              className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Discard saved cursor and start sweep from today again"
            >
              Reset cursor
            </button>
          )}
        </div>
        {sweepMessage && (
          <p className={`text-sm ${colourFor(sweepStatus)}`}>{sweepMessage}</p>
        )}
        <p className="text-xs text-muted-foreground/70">
          Sweep walks the full window in 30-day chunks regardless of what&apos;s already in the DB.
          Cursor is saved across refreshes — each click picks up where the last one stopped.
        </p>
      </div>
    </div>
  )
}
