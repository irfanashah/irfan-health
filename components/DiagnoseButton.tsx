'use client'

import { useState } from 'react'

interface MetricExpectedActual {
  metric_type: string
  expectedFromWhoop: number
  actualInDb: number
  gap: number
}

interface DiagnoseResult {
  windowStart: string
  windowEnd: string
  whoop: {
    cycles: { total: number; scored: number }
    recoveries: { total: number; scored: number }
    sleeps: { total: number; scored: number; nonNap: number; naps: number }
  }
  expectedRows: { total: number }
  actualRowsInDb: { totalForWindow: number }
  comparison: MetricExpectedActual[]
  totalGap: number
}

export function DiagnoseButton() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>(
    'idle'
  )
  const [result, setResult] = useState<DiagnoseResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleDiagnose() {
    setStatus('running')
    setResult(null)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/diagnose/whoop', {
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

      const parsed = (await response.json()) as DiagnoseResult
      setResult(parsed)
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setErrorMessage((err as Error).message)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        onClick={handleDiagnose}
        disabled={status === 'running'}
        className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium disabled:opacity-50"
      >
        {status === 'running' ? 'Diagnosing…' : 'Diagnose Whoop vs DB (2025-01-01 → today)'}
      </button>

      {errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}

      {result && (
        <div className="text-sm text-muted-foreground space-y-3 mt-2">
          <div>
            Window: {result.windowStart.slice(0, 10)} → {result.windowEnd.slice(0, 10)}
          </div>

          <div>
            <strong className="text-foreground">Whoop returned:</strong>
            <ul className="ml-4 list-disc">
              <li>
                Cycles: {result.whoop.cycles.total} total, {result.whoop.cycles.scored} scored
              </li>
              <li>
                Recoveries: {result.whoop.recoveries.total} total,{' '}
                {result.whoop.recoveries.scored} scored
              </li>
              <li>
                Sleeps: {result.whoop.sleeps.nonNap} non-nap (
                {result.whoop.sleeps.scored} scored), {result.whoop.sleeps.naps} naps
              </li>
            </ul>
          </div>

          <div>
            <strong className="text-foreground">Expected rows from Whoop:</strong>{' '}
            {result.expectedRows.total}
          </div>

          <div>
            <strong className="text-foreground">Actual rows in DB (this window):</strong>{' '}
            {result.actualRowsInDb.totalForWindow}
          </div>

          <div>
            <strong className="text-foreground">
              Total gap (positive = missing in DB):
            </strong>{' '}
            <span
              className={
                result.totalGap === 0
                  ? 'text-accent-teal'
                  : 'text-accent-amber'
              }
            >
              {result.totalGap}
            </span>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer text-foreground">
              Per-metric breakdown
            </summary>
            <table className="mt-2 text-xs border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pr-4 py-1">metric_type</th>
                  <th className="pr-4 py-1">Whoop</th>
                  <th className="pr-4 py-1">DB</th>
                  <th className="py-1">gap</th>
                </tr>
              </thead>
              <tbody>
                {result.comparison.map((row) => (
                  <tr key={row.metric_type}>
                    <td className="pr-4 py-1 font-mono">{row.metric_type}</td>
                    <td className="pr-4 py-1">{row.expectedFromWhoop}</td>
                    <td className="pr-4 py-1">{row.actualInDb}</td>
                    <td
                      className={`py-1 ${
                        row.gap === 0
                          ? 'text-accent-teal'
                          : row.gap > 0
                          ? 'text-accent-amber'
                          : 'text-destructive'
                      }`}
                    >
                      {row.gap}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  )
}
