// Exclusions for the Correlations engine.
//
// Pulls every context_period (exclude_from_baseline=true) + med_change row
// that overlaps the engine's window, and converts each into a DateRange the
// engine applies as a per-day mask BEFORE detrending/correlating. Reuses
// the drift engine's tables — no new schema. Spec §1.2.
//
// Why not reuse the existing baselines.ts readers? fetchActiveContextToday
// returns only today's overlap (drift panel's "in suppression" label);
// fetchActiveMedChanges returns all active rows but doesn't shape them as
// date-range exclusions. This module shapes both for engine consumption.

import { createServiceClient } from '@/lib/supabase/service'
import type { DateRange } from '@/components/dashboard/connections/engine'

/**
 * Per-metric reset window after a med change. Matches the drift engine's
 * `med-change → reset` window (`migration_004` `metric_drift` view drops
 * those days from the affected metrics). Default 21 days here mirrors that
 * window so the engine and the drift panel exclude the same surface for
 * the same reason.
 *
 * NOTE: drift uses a 21-day rolling+short reset window in the SQL; if that
 * ever changes, change here too — the two should agree (gotcha #43 family
 * — uniform reset, not partial).
 */
const MED_CHANGE_RESET_DAYS = 21

/** YYYY-MM-DD + N days. Returns YYYY-MM-DD. Pure. */
function addDays(iso: string, n: number): string {
  const ms = Date.parse(iso + 'T00:00:00Z')
  return new Date(ms + n * 86400000).toISOString().slice(0, 10)
}

/**
 * Build the full exclusion set the engine needs. Returns an array of
 * DateRange (global = all metrics) + per-metric (med-change scoped).
 *
 * `windowStart` / `windowEnd` are inclusive YYYY-MM-DD bounds — only rows
 * whose range touches the window are returned (the engine's series IS the
 * window, so far-history rows would just be no-ops, but trimming keeps
 * the mask cheap to build).
 *
 * Med-change `affected_metrics` is a Postgres text[]; the columns refer to
 * `daily_metrics` view column names. We pass them through as-is —
 * connections/metrics.ts uses the SAME daily_metrics column names as its
 * accessor source, so the strings line up. ('rhr', 'sys', etc.)
 *
 * Map med-change metric column names to engine metric IDs:
 *   daily_metrics.* (the columns referenced in affected_metrics) ←→
 *   ENGINE_METRIC_IDS in connections/metrics.ts. Most match by name
 *   (sys, dia, rhr, hrv, recovery, strain, fasting, tir, weight); the
 *   sleep family is the one mismatch (DRIFT_METRICS uses `sleep_total`
 *   for the column while the engine uses the legacy id `sleepHours`).
 *   Translate on the way out so the engine masks the right id.
 */
const METRIC_COL_TO_ENGINE_ID: Record<string, string> = {
  sleep_total: 'sleepHours',
  sleep_performance: 'sleepQuality',
}

function translateMetricColumn(col: string): string {
  return METRIC_COL_TO_ENGINE_ID[col] ?? col
}

export async function fetchEngineExclusions(
  windowStart: string,
  windowEnd: string,
): Promise<DateRange[]> {
  const supabase = createServiceClient()

  // Context periods with exclude_from_baseline=true that overlap the window.
  // Active=true only — deactivated entries are kept as history but not applied.
  const ctxQ = supabase
    .from('context_periods')
    .select('start_date, end_date, exclude_from_baseline, active')
    .eq('active', true)
    .eq('exclude_from_baseline', true)
    .lte('start_date', windowEnd)
    .gte('end_date', windowStart)

  // All active med-changes; the engine only cares about the ones whose
  // [change_date, change_date + reset] window touches the engine's window.
  const medQ = supabase
    .from('med_changes')
    .select('change_date, affected_metrics, active')
    .eq('active', true)

  const [{ data: ctxRows, error: e1 }, { data: medRows, error: e2 }] = await Promise.all([ctxQ, medQ])
  if (e1) throw new Error(`context_periods (exclusions) fetch failed: ${e1.message}`)
  if (e2) throw new Error(`med_changes (exclusions) fetch failed: ${e2.message}`)

  const out: DateRange[] = []

  for (const r of ctxRows ?? []) {
    const row = r as { start_date: string; end_date: string }
    // Global exclusion (no `metrics` field → all metrics dropped).
    out.push({ start: row.start_date, end: row.end_date })
  }

  for (const r of medRows ?? []) {
    const row = r as { change_date: string; affected_metrics: string[] | null }
    const start = row.change_date
    const end = addDays(start, MED_CHANGE_RESET_DAYS)
    if (end < windowStart || start > windowEnd) continue
    const cols = row.affected_metrics ?? []
    const metricIds = cols.map(translateMetricColumn)
    out.push({ start, end, metrics: metricIds })
  }

  return out
}
