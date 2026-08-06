'use client'

import { useState } from 'react'

interface MetricExpectedActual {
  metric_type: string
  expectedFromWhoop: number
  actualInDb: number
  gap: number
}

interface WhoopDiagnoseResult {
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

interface WithingsDiagnoseResult {
  windowStart: string
  windowEnd: string
  withings: {
    totalGroups: number
    validBp: number
    skipped: {
      onlyPulse: number
      wrongAttrib: number
      partialOrNoBp: number
    }
  }
  bpReadingsInDb: number
  gap: number
}

interface NightscoutDiagnoseResult {
  windowStart: string
  windowEnd: string
  nightscout: {
    totalEntries: number
    validSgv: number
    skipped: {
      nonSgv: number
      outOfRange: number
      missingFields: number
    }
  }
  cgmRowsInDb: number
  gap: number
}

type Status = 'idle' | 'running' | 'done' | 'error'

// ─── Reconcile now ─────────────────────────────────────────────────────────
// A gap means the source has rows the DB doesn't. The refill route already
// fixes that — full-history ID-diff, idempotent upsert of only the missing
// rows — it just had no UI (you'd have to curl it). This button POSTs to it
// over the SAME window the diagnose just examined and reports what it wrote.

interface RefillResponse {
  planned?: number
  existingInDb?: number
  missingBeforeInsert?: number
  inserted?: number
  status?: 'success' | 'partial' | 'error'
  error?: string
}

function ReconcileButton({
  source,
  windowStart,
  windowEnd,
  gap,
}: {
  source: 'whoop' | 'withings' | 'nightscout'
  windowStart: string
  windowEnd: string
  gap: number
}) {
  const [state, setState] = useState<{ status: Status; message?: string; ok?: boolean }>({
    status: 'idle',
  })

  async function run() {
    setState({ status: 'running' })
    try {
      const res = await fetch(`/api/refill/${source}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Reconcile exactly the window the diagnose examined.
        body: JSON.stringify({ fromDate: windowStart, toDate: windowEnd }),
      })
      const text = await res.text()
      let json: RefillResponse | null = null
      try {
        json = JSON.parse(text) as RefillResponse
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        setState({
          status: 'error',
          ok: false,
          message: json?.error ?? `HTTP ${res.status}: ${text.slice(0, 200)}`,
        })
        return
      }
      const inserted = json?.inserted ?? 0
      const existing = json?.existingInDb
      setState({
        status: 'done',
        ok: true,
        message:
          `Wrote ${inserted} missing row${inserted === 1 ? '' : 's'}` +
          (existing != null ? ` · ${existing} already present` : '') +
          '. Re-run Diagnose to confirm the gap closed.',
      })
    } catch (err) {
      setState({ status: 'error', ok: false, message: (err as Error).message })
    }
  }

  const running = state.status === 'running'
  return (
    <div className="mt-2">
      <button
        onClick={run}
        disabled={running}
        className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-xs font-medium disabled:opacity-50"
        title={`Fetch the full window from ${source} and upsert only the rows missing from the DB (idempotent).`}
      >
        {running
          ? 'Reconciling…'
          : gap > 0
            ? `Reconcile now — fill ${gap} missing`
            : 'Reconcile now'}
      </button>
      {state.status === 'done' && (
        <div className={`text-xs mt-1 ${state.ok ? 'text-accent-teal' : 'text-destructive'}`}>
          {state.message}
        </div>
      )}
      {state.status === 'error' && (
        <div className="text-xs mt-1 text-destructive">Reconcile failed: {state.message}</div>
      )}
    </div>
  )
}

export function DiagnoseButton() {
  const [status, setStatus] = useState<Status>('idle')
  const [whoopResult, setWhoopResult] = useState<WhoopDiagnoseResult | null>(
    null
  )
  const [withingsResult, setWithingsResult] =
    useState<WithingsDiagnoseResult | null>(null)
  const [nightscoutResult, setNightscoutResult] =
    useState<NightscoutDiagnoseResult | null>(null)
  const [whoopError, setWhoopError] = useState<string | null>(null)
  const [withingsError, setWithingsError] = useState<string | null>(null)
  const [nightscoutError, setNightscoutError] = useState<string | null>(null)

  async function handleDiagnose() {
    setStatus('running')
    setWhoopResult(null)
    setWithingsResult(null)
    setNightscoutResult(null)
    setWhoopError(null)
    setWithingsError(null)
    setNightscoutError(null)

    // Parallel — a single source failing (e.g. Whoop rate limit) doesn't
    // block the other panels from rendering.
    const [whoopResp, withingsResp, nightscoutResp] = await Promise.allSettled([
      fetch('/api/diagnose/whoop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      fetch('/api/diagnose/withings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      fetch('/api/diagnose/nightscout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    ])

    let anyOk = false
    let anyError = false

    if (whoopResp.status === 'fulfilled') {
      if (whoopResp.value.ok) {
        try {
          const parsed = (await whoopResp.value.json()) as WhoopDiagnoseResult
          setWhoopResult(parsed)
          anyOk = true
        } catch (err) {
          setWhoopError(`Whoop parse failed: ${(err as Error).message}`)
          anyError = true
        }
      } else {
        const text = await whoopResp.value.text().catch(() => '')
        setWhoopError(`Whoop HTTP ${whoopResp.value.status}: ${text.slice(0, 200)}`)
        anyError = true
      }
    } else {
      setWhoopError(`Whoop fetch failed: ${whoopResp.reason}`)
      anyError = true
    }

    if (withingsResp.status === 'fulfilled') {
      if (withingsResp.value.ok) {
        try {
          const parsed = (await withingsResp.value.json()) as WithingsDiagnoseResult
          setWithingsResult(parsed)
          anyOk = true
        } catch (err) {
          setWithingsError(`Withings parse failed: ${(err as Error).message}`)
          anyError = true
        }
      } else {
        const text = await withingsResp.value.text().catch(() => '')
        setWithingsError(
          `Withings HTTP ${withingsResp.value.status}: ${text.slice(0, 200)}`
        )
        anyError = true
      }
    } else {
      setWithingsError(`Withings fetch failed: ${withingsResp.reason}`)
      anyError = true
    }

    if (nightscoutResp.status === 'fulfilled') {
      if (nightscoutResp.value.ok) {
        try {
          const parsed = (await nightscoutResp.value.json()) as NightscoutDiagnoseResult
          setNightscoutResult(parsed)
          anyOk = true
        } catch (err) {
          setNightscoutError(`Nightscout parse failed: ${(err as Error).message}`)
          anyError = true
        }
      } else {
        const text = await nightscoutResp.value.text().catch(() => '')
        setNightscoutError(
          `Nightscout HTTP ${nightscoutResp.value.status}: ${text.slice(0, 200)}`
        )
        anyError = true
      }
    } else {
      setNightscoutError(`Nightscout fetch failed: ${nightscoutResp.reason}`)
      anyError = true
    }

    if (anyOk && anyError) setStatus('done') // partial — show what we have
    else if (anyOk) setStatus('done')
    else setStatus('error')
  }

  return (
    <div className="mt-4 space-y-4">
      <button
        onClick={handleDiagnose}
        disabled={status === 'running'}
        className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm font-medium disabled:opacity-50"
      >
        {status === 'running'
          ? 'Diagnosing…'
          : 'Diagnose sources vs DB (Whoop · Withings · Nightscout)'}
      </button>

      {/* Whoop panel */}
      {whoopError && (
        <div className="text-sm">
          <strong className="text-foreground">Whoop:</strong>{' '}
          <span className="text-destructive">{whoopError}</span>
        </div>
      )}
      {whoopResult && <WhoopPanel result={whoopResult} />}

      {/* Withings panel */}
      {withingsError && (
        <div className="text-sm">
          <strong className="text-foreground">Withings:</strong>{' '}
          <span className="text-destructive">{withingsError}</span>
        </div>
      )}
      {withingsResult && <WithingsPanel result={withingsResult} />}

      {/* Nightscout panel */}
      {nightscoutError && (
        <div className="text-sm">
          <strong className="text-foreground">Nightscout:</strong>{' '}
          <span className="text-destructive">{nightscoutError}</span>
        </div>
      )}
      {nightscoutResult && <NightscoutPanel result={nightscoutResult} />}
    </div>
  )
}

function WhoopPanel({ result }: { result: WhoopDiagnoseResult }) {
  return (
    <div className="text-sm text-muted-foreground space-y-3 border-l-2 border-border pl-4">
      <div className="text-foreground font-semibold">Whoop</div>
      <div>
        Window: {result.windowStart.slice(0, 10)} → {result.windowEnd.slice(0, 10)}
      </div>

      <div>
        <strong className="text-foreground">Returned:</strong>
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
        <strong className="text-foreground">Expected rows:</strong>{' '}
        {result.expectedRows.total}
      </div>

      <div>
        <strong className="text-foreground">Actual in DB:</strong>{' '}
        {result.actualRowsInDb.totalForWindow}
      </div>

      <div>
        <strong className="text-foreground">Gap:</strong>{' '}
        <span
          className={
            result.totalGap === 0 ? 'text-accent-teal' : 'text-accent-amber'
          }
        >
          {result.totalGap}
        </span>
      </div>

      <ReconcileButton
        source="whoop"
        windowStart={result.windowStart}
        windowEnd={result.windowEnd}
        gap={result.totalGap}
      />

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
  )
}

function WithingsPanel({ result }: { result: WithingsDiagnoseResult }) {
  const { skipped } = result.withings
  const totalSkipped =
    skipped.onlyPulse + skipped.wrongAttrib + skipped.partialOrNoBp

  return (
    <div className="text-sm text-muted-foreground space-y-3 border-l-2 border-border pl-4">
      <div className="text-foreground font-semibold">Withings BP</div>
      <div>
        Window: {result.windowStart.slice(0, 10)} → {result.windowEnd.slice(0, 10)}
      </div>

      <div>
        <strong className="text-foreground">Returned:</strong>{' '}
        {result.withings.totalGroups} measurement groups
      </div>

      <div>
        <strong className="text-foreground">Valid BP (sys + dia, accepted attrib):</strong>{' '}
        {result.withings.validBp}
      </div>

      <div>
        <strong className="text-foreground">Actual in bp_readings:</strong>{' '}
        {result.bpReadingsInDb}
      </div>

      <div>
        <strong className="text-foreground">Gap:</strong>{' '}
        <span
          className={result.gap === 0 ? 'text-accent-teal' : 'text-accent-amber'}
        >
          {result.gap}
        </span>
      </div>

      <ReconcileButton
        source="withings"
        windowStart={result.windowStart}
        windowEnd={result.windowEnd}
        gap={result.gap}
      />

      {totalSkipped > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-foreground">
            Skipped breakdown ({totalSkipped})
          </summary>
          <ul className="ml-4 list-disc text-xs">
            <li>Only pulse, no BP: {skipped.onlyPulse}</li>
            <li>Wrong attrib (objective / flagged-wrong / other): {skipped.wrongAttrib}</li>
            <li>Partial / no BP measures: {skipped.partialOrNoBp}</li>
          </ul>
        </details>
      )}
    </div>
  )
}

function NightscoutPanel({ result }: { result: NightscoutDiagnoseResult }) {
  const { skipped } = result.nightscout
  const totalSkipped = skipped.nonSgv + skipped.outOfRange + skipped.missingFields

  return (
    <div className="text-sm text-muted-foreground space-y-3 border-l-2 border-border pl-4">
      <div className="text-foreground font-semibold">Nightscout CGM</div>
      <div>
        Window: {result.windowStart.slice(0, 10)} → {result.windowEnd.slice(0, 10)}{' '}
        <span className="text-muted-foreground/70">(default: last 30 days)</span>
      </div>

      <div>
        <strong className="text-foreground">Returned:</strong>{' '}
        {result.nightscout.totalEntries} entries
      </div>

      <div>
        <strong className="text-foreground">Valid sgv (40–500 mg/dL):</strong>{' '}
        {result.nightscout.validSgv}
      </div>

      <div>
        <strong className="text-foreground">Actual in health_observations (glucose_cgm):</strong>{' '}
        {result.cgmRowsInDb}
      </div>

      <div>
        <strong className="text-foreground">Gap:</strong>{' '}
        <span
          className={result.gap === 0 ? 'text-accent-teal' : 'text-accent-amber'}
        >
          {result.gap}
        </span>
      </div>

      <ReconcileButton
        source="nightscout"
        windowStart={result.windowStart}
        windowEnd={result.windowEnd}
        gap={result.gap}
      />

      {totalSkipped > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-foreground">
            Skipped breakdown ({totalSkipped})
          </summary>
          <ul className="ml-4 list-disc text-xs">
            <li>Non-sgv entries: {skipped.nonSgv}</li>
            <li>Out of range (&lt;40 / &gt;500 mg/dL — sentinels): {skipped.outOfRange}</li>
            <li>Missing required fields: {skipped.missingFields}</li>
          </ul>
        </details>
      )}
    </div>
  )
}
