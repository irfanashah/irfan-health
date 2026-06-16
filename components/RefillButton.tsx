'use client'

import { useState } from 'react'

interface RefillResult {
  whoopReturned: { cycles: number; recoveries: number; sleeps: number }
  planned: number
  existingInDb: number
  missingBeforeInsert: number
  inserted: number
  buildErrors: string[]
  insertErrors: string[]
  elapsedMs: number
  status: 'success' | 'partial' | 'error'
}

export function RefillButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>(
    'idle'
  )
  const [result, setResult] = useState<RefillResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleRefill() {
    setStatus('running')
    setResult(null)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/refill/whoop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!response.ok) {
        const text = await response.text()
        setStatus('error')
        setErrorMessage(`HTTP ${response.status}: ${text.slice(0, 300)}`)
        return
      }

      const parsed = (await response.json()) as RefillResult
      setResult(parsed)
      setStatus(parsed.status === 'error' ? 'error' : 'done')
    } catch (err) {
      setStatus('error')
      setErrorMessage((err as Error).message)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        onClick={handleRefill}
        disabled={status === 'running'}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
      >
        {status === 'running'
          ? 'Refilling… (fetch + diff + batch insert)'
          : 'Refill missing Whoop rows (2025-01-01 → today)'}
      </button>

      <p className="text-xs text-muted-foreground/70">
        Pulls every Whoop record once, diffs against existing source_record_ids in DB,
        batch-inserts only the missing ones. No chunks, no per-row dedup queries.
      </p>

      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}

      {result && (
        <div className="text-sm text-muted-foreground space-y-1 mt-2">
          <div>
            <strong className="text-foreground">Whoop returned:</strong>{' '}
            {result.whoopReturned.cycles} cycles, {result.whoopReturned.recoveries} recoveries, {result.whoopReturned.sleeps} sleeps
          </div>
          <div>
            <strong className="text-foreground">Planned rows:</strong> {result.planned}
          </div>
          <div>
            <strong className="text-foreground">Already in DB:</strong> {result.existingInDb}
          </div>
          <div>
            <strong className="text-foreground">Missing → inserted:</strong>{' '}
            <span className="text-accent-teal">{result.inserted}</span>
            {result.missingBeforeInsert !== result.inserted && (
              <span className="text-destructive">
                {' '}
                ({result.missingBeforeInsert - result.inserted} failed)
              </span>
            )}
          </div>
          <div>
            <strong className="text-foreground">Elapsed:</strong>{' '}
            {(result.elapsedMs / 1000).toFixed(1)}s
          </div>
          {(result.buildErrors.length > 0 || result.insertErrors.length > 0) && (
            <details className="mt-2">
              <summary className="cursor-pointer text-destructive">
                Errors ({result.buildErrors.length + result.insertErrors.length})
              </summary>
              <ul className="ml-4 list-disc text-xs">
                {[...result.buildErrors, ...result.insertErrors].map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
