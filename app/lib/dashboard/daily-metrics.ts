// Server-side data module for the Slice 7.1 dashboard.
//
// Provides the typed query surface the dashboard server component consumes:
//   - fetchDailyMetrics(days)   one record per GST day (from daily_metrics view)
//   - fetchCgm24h()             raw last-24h CGM points (~288 rows)
//   - fetchLatestKpis()         most recent value of each KPI metric
//   - carryForwardWeight()      fills nulls in the weight column for the trend
//
// The recent-manual-entries query is reused from Slice 3 (fetchRecentManual).

import { createServiceClient } from '@/lib/supabase/service'

// ─── daily_metrics view row ────────────────────────────────────────────────

export interface DailyMetricRow {
  date: string          // GST calendar date as 'YYYY-MM-DD'
  sys: number | null
  dia: number | null
  pulse: number | null
  weight: number | null
  recovery: number | null
  hrv: number | null
  rhr: number | null
  strain: number | null
  sleep_total: number | null         // hours
  sleep_performance: number | null   // 0–100 score
  sleep_deep: number | null          // hours
  sleep_light: number | null         // hours
  sleep_rem: number | null           // hours
  sleep_awake: number | null         // hours
  fasting: number | null             // mmol/L
  glucose_var: number | null         // mmol/L stddev
  tir: number | null                 // %
  cgm_count: number | null           // readings that day
}

// Postgres `numeric` round-trips as string through PostgREST — coerce
// every numeric column safely (gotcha #8).
function n(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const x = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(x) ? x : null
}

function mapDailyRow(raw: Record<string, unknown>): DailyMetricRow {
  return {
    date: raw.date as string,
    sys: n(raw.sys as number | string | null),
    dia: n(raw.dia as number | string | null),
    pulse: n(raw.pulse as number | string | null),
    weight: n(raw.weight as number | string | null),
    recovery: n(raw.recovery as number | string | null),
    hrv: n(raw.hrv as number | string | null),
    rhr: n(raw.rhr as number | string | null),
    strain: n(raw.strain as number | string | null),
    sleep_total: n(raw.sleep_total as number | string | null),
    sleep_performance: n(raw.sleep_performance as number | string | null),
    sleep_deep: n(raw.sleep_deep as number | string | null),
    sleep_light: n(raw.sleep_light as number | string | null),
    sleep_rem: n(raw.sleep_rem as number | string | null),
    sleep_awake: n(raw.sleep_awake as number | string | null),
    fasting: n(raw.fasting as number | string | null),
    glucose_var: n(raw.glucose_var as number | string | null),
    tir: n(raw.tir as number | string | null),
    cgm_count: n(raw.cgm_count as number | string | null),
  }
}

/**
 * Fetch the last `days` days of the daily_metrics view, oldest first.
 * Backed by the SQL view (`migration_003_daily_metrics_view.sql`); all
 * heavy aggregation (CGM stats, BP morning preference, Whoop attribution)
 * runs in Postgres, not in JS.
 */
export async function fetchDailyMetrics(days: number): Promise<DailyMetricRow[]> {
  const supabase = createServiceClient()

  // Anchor the lower bound on the GST calendar day window. The view is
  // anchored on Asia/Dubai already, so we can compare via UTC ISO with a
  // small slop without crossing day boundaries the dashboard cares about.
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const { data, error } = await supabase
    .from('daily_metrics')
    .select(
      'date, sys, dia, pulse, weight, recovery, hrv, rhr, strain, sleep_total, sleep_performance, sleep_deep, sleep_light, sleep_rem, sleep_awake, fasting, glucose_var, tir, cgm_count'
    )
    .gte('date', cutoff)
    .order('date', { ascending: true })

  if (error) throw new Error(`daily_metrics fetch failed: ${error.message}`)
  return (data ?? []).map((r) => mapDailyRow(r as Record<string, unknown>))
}

/**
 * Carry forward the most recent non-null weight across days so the trend line
 * doesn't gap on no-reading days. Pure — does not mutate input.
 *
 * IMPORTANT: this is for the trend chart only. The KPI "latest weight" must
 * come from fetchLatestKpis (the actual most recent reading, never a carried
 * value).
 */
export function carryForwardWeight(rows: DailyMetricRow[]): DailyMetricRow[] {
  let last: number | null = null
  return rows.map((r) => {
    if (r.weight !== null) {
      last = r.weight
      return r
    }
    return { ...r, weight: last }
  })
}

// ─── 24h CGM curve ─────────────────────────────────────────────────────────

export interface CgmPoint {
  time: string              // ISO timestamp
  mmol: number              // canonical mmol/L
}

/**
 * Last 24 hours of CGM readings, oldest first. ~288 rows at 5-min cadence —
 * comfortably under Supabase's 1000-row .select() cap (gotcha #10), so we
 * pull raw rather than aggregating.
 */
export async function fetchCgm24h(): Promise<CgmPoint[]> {
  const supabase = createServiceClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('health_observations')
    .select('recorded_at, canonical_value')
    .eq('metric_type', 'glucose_cgm')
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true })
    .limit(1000)

  if (error) throw new Error(`cgm 24h fetch failed: ${error.message}`)
  return (data ?? [])
    .map((r) => {
      const row = r as { recorded_at: string | null; canonical_value: number | string | null }
      const v = n(row.canonical_value)
      if (!row.recorded_at || v === null) return null
      return { time: row.recorded_at, mmol: v }
    })
    .filter((p): p is CgmPoint => p !== null)
}

// ─── Latest KPI values ─────────────────────────────────────────────────────

export interface LatestKpis {
  weight: { value: number; at: string } | null
  bp: { sys: number; dia: number; pulse: number | null; at: string } | null
  recovery: { value: number; at: string } | null
  hrv: { value: number; at: string } | null
  rhr: { value: number; at: string } | null
  strain: { value: number; at: string } | null
  sleep: { total: number; performance: number | null; at: string } | null
  cgm: { value: number; at: string; trendDir: 'rising' | 'falling' | 'flat'; slope: number } | null
}

async function latestObs(
  supabase: ReturnType<typeof createServiceClient>,
  metricType: string,
  filterValue: 'numeric' | 'canonical' = 'canonical'
): Promise<{ value: number; at: string } | null> {
  const { data, error } = await supabase
    .from('health_observations')
    .select('recorded_at, period_end, numeric_value, canonical_value')
    .eq('metric_type', metricType)
    .order('recorded_at', { ascending: false, nullsFirst: false })
    .order('period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  const row = data as {
    recorded_at: string | null
    period_end: string | null
    numeric_value: number | string | null
    canonical_value: number | string | null
  }
  const at = row.recorded_at ?? row.period_end
  const v = n(filterValue === 'canonical' ? row.canonical_value : row.numeric_value)
  if (!at || v === null) return null
  return { value: v, at }
}

export async function fetchLatestKpis(cgm24h?: CgmPoint[]): Promise<LatestKpis> {
  const supabase = createServiceClient()

  const [
    weightRow,
    recoveryRow,
    hrvRow,
    rhrRow,
    strainRow,
    sleepTotalRow,
    sleepPerfRow,
    bpRow,
  ] = await Promise.all([
    latestObs(supabase, 'weight'),
    latestObs(supabase, 'recovery_score'),
    latestObs(supabase, 'hrv_rmssd'),
    latestObs(supabase, 'heart_rate_resting'),
    latestObs(supabase, 'strain_score'),
    latestObs(supabase, 'sleep_duration_total'),  // canonical='min'
    latestObs(supabase, 'sleep_score'),
    supabase
      .from('bp_readings')
      .select('measured_at, systolic_mmhg, diastolic_mmhg, pulse_bpm')
      .order('measured_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const bp = bpRow.data
    ? {
        sys: Number((bpRow.data as { systolic_mmhg: number }).systolic_mmhg),
        dia: Number((bpRow.data as { diastolic_mmhg: number }).diastolic_mmhg),
        pulse: bpRow.data && (bpRow.data as { pulse_bpm: number | null }).pulse_bpm !== null
          ? Number((bpRow.data as { pulse_bpm: number }).pulse_bpm)
          : null,
        at: (bpRow.data as { measured_at: string }).measured_at,
      }
    : null

  const sleep =
    sleepTotalRow && sleepTotalRow.value !== null
      ? {
          total: sleepTotalRow.value / 60,  // 'min' → hours
          performance: sleepPerfRow?.value ?? null,
          at: sleepTotalRow.at,
        }
      : null

  // CGM trend: slope from the last ~3 points (≈15 min). Falls back gracefully
  // if too few readings.
  let cgm: LatestKpis['cgm'] = null
  if (cgm24h && cgm24h.length > 0) {
    const last = cgm24h[cgm24h.length - 1]
    const prev = cgm24h[cgm24h.length - 4] ?? cgm24h[cgm24h.length - 2] ?? last
    const slope = (last.mmol - prev.mmol) / 3
    let trendDir: 'rising' | 'falling' | 'flat' = 'flat'
    if (slope > 0.18) trendDir = 'rising'
    else if (slope < -0.18) trendDir = 'falling'
    cgm = { value: last.mmol, at: last.time, trendDir, slope }
  }

  return {
    weight: weightRow,
    bp,
    recovery: recoveryRow,
    hrv: hrvRow,
    rhr: rhrRow,
    strain: strainRow,
    sleep,
    cgm,
  }
}
