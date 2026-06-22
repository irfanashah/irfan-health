// Server-side data module for the Slice 7.3 Baselines & Drift panel.
//
// Reads the metric_drift Postgres view (migration_004) bounded to a recent
// window — the view's full-history scan is paid only on the slice the panel
// actually consumes. Also reads the supporting tables for context
// suppression and the active anchor's provenance.

import { createServiceClient } from '@/lib/supabase/service'
import {
  DRIFT_METRICS,
  PERSISTENCE_LOOKBACK_DAYS,
  type DriftMetricId,
} from '@/components/dashboard/drift-config'

// ─── metric_drift row ──────────────────────────────────────────────────────

export interface MetricDriftRow {
  date: string              // YYYY-MM-DD (GST calendar day)
  metric: DriftMetricId
  today_value: number
  rolling_median: number | null
  rolling_mad: number | null
  rolling_n: number
  today_z: number | null
  short_median: number | null
  short_n: number
  prior_median: number | null
  prior_mad: number | null
  prior_n: number
  short_vs_prior_delta: number | null
  short_vs_prior_z: number | null
  anchor_median: number | null
  anchor_mad: number | null
  anchor_n: number | null
  short_vs_anchor_delta: number | null
  short_vs_anchor_z: number | null
}

// Postgres `numeric` round-trips as either number or string via PostgREST
// (gotcha #8). Coerce defensively on every numeric column.
function n(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const x = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(x) ? x : null
}

function mapRow(raw: Record<string, unknown>): MetricDriftRow {
  return {
    date: raw.date as string,
    metric: raw.metric as DriftMetricId,
    today_value: n(raw.today_value as number | string | null) ?? 0,
    rolling_median: n(raw.rolling_median as number | string | null),
    rolling_mad: n(raw.rolling_mad as number | string | null),
    rolling_n: (n(raw.rolling_n as number | string | null) ?? 0) | 0,
    today_z: n(raw.today_z as number | string | null),
    short_median: n(raw.short_median as number | string | null),
    short_n: (n(raw.short_n as number | string | null) ?? 0) | 0,
    prior_median: n(raw.prior_median as number | string | null),
    prior_mad: n(raw.prior_mad as number | string | null),
    prior_n: (n(raw.prior_n as number | string | null) ?? 0) | 0,
    short_vs_prior_delta: n(raw.short_vs_prior_delta as number | string | null),
    short_vs_prior_z: n(raw.short_vs_prior_z as number | string | null),
    anchor_median: n(raw.anchor_median as number | string | null),
    anchor_mad: n(raw.anchor_mad as number | string | null),
    anchor_n: n(raw.anchor_n as number | string | null) === null ? null : ((n(raw.anchor_n as number | string | null) ?? 0) | 0),
    short_vs_anchor_delta: n(raw.short_vs_anchor_delta as number | string | null),
    short_vs_anchor_z: n(raw.short_vs_anchor_z as number | string | null),
  }
}

/**
 * Fetch metric_drift rows bounded to the recent window the panel needs:
 *   [today - PERSISTENCE_LOOKBACK_DAYS, today]
 * Grouped by metric in the returned shape.
 *
 * The view itself scans full history (acknowledged perf caveat); this query
 * narrows down to ~14 calendar days × 8 metrics so the cost is paid only on
 * the slice the dashboard consumes.
 */
export async function fetchMetricDrift(): Promise<Record<DriftMetricId, MetricDriftRow[]>> {
  const supabase = createServiceClient()

  // Anchor on the GST today so the recency window aligns with daily_metrics.
  // (Asia/Dubai is fixed +04:00; using UTC-day for the cutoff is fine here
  // because we want a SUPERSET of the GST window — a row from today GST may
  // still be on yesterday UTC. Pad by one day to be safe.)
  const cutoff = new Date(Date.now() - (PERSISTENCE_LOOKBACK_DAYS + 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supabase
    .from('metric_drift')
    .select('*')
    .gte('date', cutoff)
    .order('date', { ascending: true })

  if (error) throw new Error(`metric_drift fetch failed: ${error.message}`)

  // Build the grouped initialiser from DRIFT_METRICS so adding a new metric to
  // the config auto-propagates here (vs. a hand-written literal we'd have to
  // remember to extend — caught the SpO2 add-on, see gotcha "build maps from
  // DRIFT_METRICS, not literals").
  const grouped = Object.fromEntries(
    DRIFT_METRICS.map((m) => [m, [] as MetricDriftRow[]])
  ) as Record<DriftMetricId, MetricDriftRow[]>
  for (const r of data ?? []) {
    const row = mapRow(r as Record<string, unknown>)
    if (DRIFT_METRICS.includes(row.metric)) {
      grouped[row.metric].push(row)
    }
  }
  return grouped
}

// ─── Context suppression (suppress_alerts half) ────────────────────────────

export interface ActiveContextPeriod {
  id: string
  start_date: string
  end_date: string
  type: 'ramadan' | 'travel' | 'illness' | 'other' | 'anomaly'
  suppress_alerts: boolean
  exclude_from_baseline: boolean
  note: string | null
}

/**
 * Pull active context periods covering TODAY (or the recent window). The
 * panel uses the suppress_alerts half to render "suppressed — <type>" on
 * affected days; the exclude_from_baseline half is already applied by the
 * view, so this is purely UI labelling.
 */
export async function fetchActiveContextToday(): Promise<ActiveContextPeriod[]> {
  const supabase = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('context_periods')
    .select('id, start_date, end_date, type, suppress_alerts, exclude_from_baseline, note')
    .eq('active', true)
    .lte('start_date', today)
    .gte('end_date', today)

  if (error) throw new Error(`context_periods fetch failed: ${error.message}`)
  return (data ?? []) as ActiveContextPeriod[]
}

// ─── Anchor provenance + per-metric stats ──────────────────────────────────

export interface ActiveAnchor {
  setId: string
  source_start: string
  source_end: string
  set_at: string
  note: string | null
  /** Per-metric frozen stats (only metrics with enough data-days at set time). */
  metrics: Record<string, { median: number; mad: number; n: number }>
}

export async function fetchActiveAnchor(): Promise<ActiveAnchor | null> {
  const supabase = createServiceClient()
  const { data: header, error: e1 } = await supabase
    .from('anchor_sets')
    .select('id, source_start, source_end, set_at, note')
    .eq('active', true)
    .maybeSingle()

  if (e1) throw new Error(`anchor_sets fetch failed: ${e1.message}`)
  if (!header) return null

  const { data: rows, error: e2 } = await supabase
    .from('anchor_baseline_stats')
    .select('metric, median, mad, n')
    .eq('anchor_set_id', (header as { id: string }).id)

  if (e2) throw new Error(`anchor_baseline_stats fetch failed: ${e2.message}`)

  const metrics: Record<string, { median: number; mad: number; n: number }> = {}
  for (const r of rows ?? []) {
    const row = r as { metric: string; median: number | string; mad: number | string; n: number }
    const median = n(row.median)
    const mad = n(row.mad)
    if (median === null || mad === null) continue
    metrics[row.metric] = { median, mad, n: row.n }
  }

  return {
    setId: (header as { id: string }).id,
    source_start: (header as { source_start: string }).source_start,
    source_end: (header as { source_end: string }).source_end,
    set_at: (header as { set_at: string }).set_at,
    note: (header as { note: string | null }).note,
    metrics,
  }
}

// ─── Active med-changes (per-metric reset surface) ─────────────────────────

export interface ActiveMedChange {
  id: string
  change_date: string
  label: string
  affected_metrics: string[]
  note: string | null
}

/**
 * Pull all active med_changes. The panel uses these to display
 * "since <label>, <date>" next to affected metrics that have reset to
 * `establishing` (the view has already applied the rolling-window reset
 * — this is purely UI surface).
 */
export async function fetchActiveMedChanges(): Promise<ActiveMedChange[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('med_changes')
    .select('id, change_date, label, affected_metrics, note')
    .eq('active', true)
    .order('change_date', { ascending: false })

  if (error) throw new Error(`med_changes fetch failed: ${error.message}`)
  return (data ?? []) as ActiveMedChange[]
}

// ─── Combined fetch ────────────────────────────────────────────────────────

export interface BaselinesPayload {
  drift: Record<DriftMetricId, MetricDriftRow[]>
  context: ActiveContextPeriod[]
  anchor: ActiveAnchor | null
  medChanges: ActiveMedChange[]
}

export async function fetchBaselinesPayload(): Promise<BaselinesPayload> {
  const [drift, context, anchor, medChanges] = await Promise.all([
    fetchMetricDrift(),
    fetchActiveContextToday(),
    fetchActiveAnchor(),
    fetchActiveMedChanges(),
  ])
  return { drift, context, anchor, medChanges }
}
