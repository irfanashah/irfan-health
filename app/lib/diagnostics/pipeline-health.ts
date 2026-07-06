// Pipeline-health reader — shared by `/diagnostics` (on-demand view)
// and the daily `health-check` cron (email digest when stale).
//
// Monitors ONLY the API-pull crons (whoop / withings / nightscout).
// Excluded by design:
//   - file-drop sources (oxylink_csv, contour) — user-action-dependent;
//     staleness is normal, not a failure.
//   - episodic sources (manual, labs) — no cron, no expected cadence.
//
// Signal: age of the latest COVERED row ('success' or 'partial'), NOT
// error-row scanning. "Covered" matches the frontier's own definition
// (adapters/_lib/ingestion-log.ts's getLastCoveredWindowEnd, gotcha #158)
// — a partial run still fetched and wrote its window, it just had a bad
// row. Before this matched 'success' only: a single recurring bad row
// made this signal say "stale" every day for the full LOOKBACK duration
// even though ingestion was working fine, a false-positive alert storm
// that also risked masking a real staleness underneath it. Last-covered-
// age still catches BOTH "cron didn't run" and "cron ran but failed
// outright (no success or partial)" in one robust number.
//
// Thresholds are provisional (≈ 2–3× the cron interval + buffer):
//   - whoop:     cron every 6h  → 18h  (3 missed runs)
//   - withings:  cron every 12h → 30h  (2.5 missed runs)
//   - nightscout: cron every 12h → 30h (2.5 missed runs)
// Tune after watching real timing.

import { createServiceClient } from '@/lib/supabase/service'

export interface MonitoredSource {
  slug: string
  label: string
  staleHours: number
  cronCadenceHours: number
}

export const MONITORED_SOURCES: readonly MonitoredSource[] = [
  { slug: 'whoop',      label: 'Whoop',      staleHours: 18, cronCadenceHours: 6 },
  { slug: 'withings',   label: 'Withings',   staleHours: 30, cronCadenceHours: 12 },
  { slug: 'nightscout', label: 'Nightscout', staleHours: 30, cronCadenceHours: 12 },
]

export interface PipelineHealthRow {
  slug: string
  label: string
  /** Most recent covered-run ('success'|'partial') timestamp — prefer completed_at, fall back to triggered_at. Null when no covered run exists. */
  lastSuccessAt: string | null
  /** Hours since lastSuccessAt; null when no covered run exists. */
  ageHours: number | null
  /** True when ageHours > staleHours OR no covered run exists at all. */
  stale: boolean
  staleHours: number
}

/** Per monitored source, the latest-covered row + age + stale flag. */
export async function fetchPipelineHealth(): Promise<PipelineHealthRow[]> {
  const supabase = createServiceClient()
  const now = Date.now()
  const rows: PipelineHealthRow[] = []

  for (const src of MONITORED_SOURCES) {
    const { data, error } = await supabase
      .from('ingestion_log')
      .select('triggered_at, completed_at')
      .eq('source_slug', src.slug)
      .in('status', ['success', 'partial'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(1)
    if (error) {
      // Don't throw — surface a sentinel "stale + no last success" so
      // the cron still emails something useful + the page still renders.
      console.warn(`[pipeline-health] ${src.slug} query failed: ${error.message}`)
      rows.push({
        slug: src.slug, label: src.label, staleHours: src.staleHours,
        lastSuccessAt: null, ageHours: null, stale: true,
      })
      continue
    }
    const latest = data?.[0] as { triggered_at: string; completed_at: string | null } | undefined
    const ts = latest?.completed_at ?? latest?.triggered_at ?? null
    if (!ts) {
      rows.push({
        slug: src.slug, label: src.label, staleHours: src.staleHours,
        lastSuccessAt: null, ageHours: null, stale: true,
      })
      continue
    }
    const ageHours = (now - Date.parse(ts)) / 3_600_000
    rows.push({
      slug: src.slug,
      label: src.label,
      staleHours: src.staleHours,
      lastSuccessAt: ts,
      ageHours,
      stale: ageHours > src.staleHours,
    })
  }

  return rows
}

/** Format an ISO timestamp as GST (en-GB) for human display. */
export function fmtGstTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai',
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}
