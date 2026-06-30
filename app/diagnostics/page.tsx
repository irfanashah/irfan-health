import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DiagnoseButton } from '@/components/DiagnoseButton'
import { fetchFileDropLogs, type FileDropLogRow } from '@/app/lib/diagnostics/file-drops'
import { fetchPipelineHealth, fmtGstTimestamp, type PipelineHealthRow } from '@/app/lib/diagnostics/pipeline-health'

export default async function DiagnosticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [fileDropLogs, pipelineHealth] = await Promise.all([
    fetchFileDropLogs(20),
    fetchPipelineHealth(),
  ])

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Diagnostics</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">Pipeline health</h2>
          <p className="text-sm text-muted-foreground mb-4">
            API-pull crons (Whoop / Withings / Nightscout). Stale = no <code>status=&apos;success&apos;</code> row within the per-source threshold (≈ 2–3× the cron interval).
            The daily <code>/api/cron/health-check</code> job (08:00 GST) emails when ≥1 source is stale; silent when all healthy.
          </p>
          <PipelineHealthTable rows={pipelineHealth} />
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">Source vs DB reconciliation</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Runs Whoop + Withings + Nightscout diagnose routes in parallel and surfaces any per-metric gap.
          </p>
          <DiagnoseButton />
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">File-drop ingestion history</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Cron runs at 10:00 + 21:00 GST: pulls files from <code>inbox/&lt;source&gt;/</code> in Drive,
            routes to the matching parser, moves to <code>processed/</code> or <code>failed/</code>. Last 20 entries.
          </p>
          <FileDropTable rows={fileDropLogs} />
        </section>
      </main>
    </div>
  )
}

function PipelineHealthTable({ rows }: { rows: PipelineHealthRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Last success (GST)</th>
            <th className="px-3 py-2 font-medium text-right">Age</th>
            <th className="px-3 py-2 font-medium text-right">Stale threshold</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ageLabel = r.ageHours === null
              ? '—'
              : r.ageHours >= 24
                ? `${(Math.round(r.ageHours / 24 * 10) / 10).toFixed(1)}d`
                : `${Math.round(r.ageHours)}h`
            const statusColor = r.stale ? 'text-destructive' : 'text-accent-teal'
            const statusLabel = r.stale
              ? (r.lastSuccessAt ? 'stale' : 'no success yet')
              : 'ok'
            return (
              <tr key={r.slug} className="border-t border-border align-top">
                <td className="px-3 py-2 whitespace-nowrap text-foreground">{r.label}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground font-mono">
                  {r.lastSuccessAt ? fmtGstTimestamp(r.lastSuccessAt) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{ageLabel}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.staleHours}h</td>
                <td className={`px-3 py-2 font-medium ${statusColor}`}>{statusLabel}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FileDropTable({ rows }: { rows: FileDropLogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No file-drop ingestion runs yet. Drop a file into <code>inbox/oxylink/</code> and wait for the next cron tick (or trigger one manually).
      </p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">When (GST)</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">File</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium text-right">Written</th>
            <th className="px-3 py-2 font-medium text-right">Skipped</th>
            <th className="px-3 py-2 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <FileDropRow key={r.id} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FileDropRow({ row }: { row: FileDropLogRow }) {
  const statusColor =
    row.status === 'success' ? 'text-accent-teal' :
    row.status === 'partial' ? 'text-accent-amber' :
    row.status === 'error'   ? 'text-destructive'  :
    'text-muted-foreground'
  const when = new Date(row.triggered_at).toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai',
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
  const filename = row.payload.filename ?? '(no file)'
  const skip = row.payload.skip_breakdown
  const skipText = skip
    ? `${skip.sentinel}+${skip.out_of_range}+${skip.parse_errors}`
    : row.records_skipped !== null ? String(row.records_skipped) : '—'

  const detail = row.status === 'error'
    ? (row.payload.reason ?? row.error_detail ?? '')
    : row.payload.note
      ? row.payload.note
      : row.payload.wake_date
        ? `wake ${row.payload.wake_date}` + (row.payload.spo2_avg !== undefined ? ` · spo2 avg ${row.payload.spo2_avg}% / min ${row.payload.spo2_min}%` : '')
        : ''

  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground font-mono">{when}</td>
      <td className="px-3 py-2 whitespace-nowrap text-foreground">{row.source_slug}</td>
      <td className="px-3 py-2 break-all text-foreground">{filename}</td>
      <td className={`px-3 py-2 font-medium ${statusColor}`}>{row.status}</td>
      <td className="px-3 py-2 text-right tabular-nums">{row.records_written ?? '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums" title={skip ? `sentinel + out_of_range + parse_errors = ${skip.sentinel} + ${skip.out_of_range} + ${skip.parse_errors}` : undefined}>
        {skipText}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground max-w-md break-words">{detail}</td>
    </tr>
  )
}
