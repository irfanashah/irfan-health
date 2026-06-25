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
  spo2_avg: number | null            // %  (Oxylink overnight average)
  spo2_min: number | null            // %  (Oxylink overnight minimum)
  spo2_odi: number | null            // /h (Oxylink screening-grade ODI, 3% threshold — provisional)
  spo2_time_below_90: number | null  // %  (Oxylink % of valid recording time < 90%)
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
    spo2_avg: n(raw.spo2_avg as number | string | null),
    spo2_min: n(raw.spo2_min as number | string | null),
    spo2_odi: n(raw.spo2_odi as number | string | null),
    spo2_time_below_90: n(raw.spo2_time_below_90 as number | string | null),
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
      'date, sys, dia, pulse, weight, recovery, hrv, rhr, strain, sleep_total, sleep_performance, sleep_deep, sleep_light, sleep_rem, sleep_awake, fasting, glucose_var, tir, cgm_count, spo2_avg, spo2_min, spo2_odi, spo2_time_below_90'
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
  /**
   * Most recent overnight Oxylink night — avg, min, ODI (3% threshold,
   * screening-grade), time-below-90%, and the SpO2 distribution
   * (minutes in ≥95 / 90–94 / <90 bands) read from `extras` on the
   * ODI row. ODI may be null when validRecordingHours < ODI_MIN_HOURS.
   */
  spo2: {
    avg: number
    min: number
    odi: number | null
    timeBelow90Pct: number
    distribution: { ge95: number; b90_94: number; lt90: number }
    at: string
  } | null
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

  // Latest overnight SpO2 — pulls the two rows from the most recent night
  // (avg + min share the same period_end). These rows have NO recorded_at;
  // we use period_end as the timestamp.
  const spo2 = await latestSpo2(supabase)

  return {
    weight: weightRow,
    bp,
    recovery: recoveryRow,
    hrv: hrvRow,
    rhr: rhrRow,
    strain: strainRow,
    sleep,
    cgm,
    spo2,
  }
}

async function latestSpo2(
  supabase: ReturnType<typeof createServiceClient>
): Promise<LatestKpis['spo2']> {
  // Pull the 4 summary metric_types for the latest night in one round-trip.
  // The night's rows share `period_end`; we sort DESC and group on that.
  const { data, error } = await supabase
    .from('health_observations')
    .select('metric_type, canonical_value, period_end, extras')
    .eq('source_slug', 'oxylink_csv')
    .in('metric_type', [
      'spo2_overnight_avg',
      'spo2_overnight_min',
      'spo2_odi',
      'spo2_time_below_90_pct',
    ])
    .not('period_end', 'is', null)
    .order('period_end', { ascending: false })
    .limit(8) // ≤4 rows per night; cap of 8 covers the latest 1–2 nights safely.
  if (error || !data || data.length === 0) return null
  const rows = data as Array<{
    metric_type: string
    canonical_value: number | string | null
    period_end: string
    extras: Record<string, unknown> | null
  }>
  const latestPeriodEnd = rows[0].period_end
  let avg: number | null = null
  let min: number | null = null
  let odi: number | null = null
  let timeBelow90Pct: number | null = null
  let distribution: { ge95: number; b90_94: number; lt90: number } | null = null
  for (const r of rows) {
    if (r.period_end !== latestPeriodEnd) continue
    if (r.metric_type === 'spo2_overnight_avg')      avg = n(r.canonical_value)
    if (r.metric_type === 'spo2_overnight_min')      min = n(r.canonical_value)
    if (r.metric_type === 'spo2_odi')                odi = n(r.canonical_value)
    if (r.metric_type === 'spo2_time_below_90_pct')  timeBelow90Pct = n(r.canonical_value)
    if (r.metric_type === 'spo2_odi' && r.extras) {
      const dist = (r.extras as { spo2_distribution?: { ge95?: number; b90_94?: number; lt90?: number } })
        .spo2_distribution
      if (dist) {
        distribution = {
          ge95: n(dist.ge95 ?? null) ?? 0,
          b90_94: n(dist.b90_94 ?? null) ?? 0,
          lt90: n(dist.lt90 ?? null) ?? 0,
        }
      }
    }
  }
  if (avg === null || min === null) return null
  return {
    avg,
    min,
    odi,
    timeBelow90Pct: timeBelow90Pct ?? 0,
    distribution: distribution ?? { ge95: 0, b90_94: 0, lt90: 0 },
    at: latestPeriodEnd,
  }
}

// ─── Fingerstick readings (last N hours) ──────────────────────────────────

export interface FingerstickPoint {
  time: Date
  mmol: number                  // canonical_value
  mealMarker: string | null     // extras.meal_marker — null for manual entries
  source: string                // source_slug ('contour' | 'manual' | future)
}

/**
 * Recent fingerstick readings — surfaces both the Contour parser and the
 * Slice 3 manual entry path (both write `metric_type='glucose_fingerstick'`),
 * so manual fingersticks start appearing on the panel automatically. Sparse
 * by nature (typically 1–4/day), well under Supabase's 1000-row cap.
 *
 * Default 14d window feeds two callers in one fetch:
 *   - Glucose panel overlay diamonds: caller slices the last 24h.
 *   - Glucose panel fingerstick fallback (no recent CGM): caller takes
 *     the head of the list as "now" + the top ~10 as a recent-readings list.
 * Returned in ascending time order (oldest first).
 */
export async function fetchFingersticks(daysBack: number = 14): Promise<FingerstickPoint[]> {
  const supabase = createServiceClient()
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('health_observations')
    .select('recorded_at, canonical_value, extras, source_slug')
    .eq('metric_type', 'glucose_fingerstick')
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true })
    .limit(1000)
  if (error) throw new Error(`fingerstick fetch failed: ${error.message}`)
  return (data ?? [])
    .map((r) => {
      const row = r as {
        recorded_at: string | null
        canonical_value: number | string | null
        extras: Record<string, unknown> | null
        source_slug: string | null
      }
      const v = n(row.canonical_value)
      if (!row.recorded_at || v === null) return null
      const mm = row.extras && typeof row.extras.meal_marker === 'string'
        ? (row.extras.meal_marker as string)
        : null
      return {
        time: new Date(row.recorded_at),
        mmol: v,
        mealMarker: mm,
        source: row.source_slug ?? 'unknown',
      }
    })
    .filter((p): p is FingerstickPoint => p !== null)
}

// ─── Latest overnight SpO2 curve (display-downsampled) ────────────────────

export interface Spo2CurvePoint {
  time: Date
  value: number | null  // null = sensor-off gap (gotcha #34)
}

/**
 * One detected 3% desaturation event with TRUE nadir time + depth. Captured
 * at full ~4 s resolution during the ODI pass at ingest, so the overnight-
 * trace markers plot exact positions independent of the display curve's
 * 20 s downsampling.
 */
export interface Spo2DesatEvent {
  time: Date
  nadirSpo2: number
  dropPct: number
  also4Pct: boolean
}

export interface Spo2NightPayload {
  curve: Spo2CurvePoint[]
  events: Spo2DesatEvent[]
}

/**
 * Fetch the most recent overnight night's data: the display-downsampled
 * SpO2 curve (one JSONB row in `health_observations`) plus the per-event
 * desaturation array (lives on the `spo2_odi` row's `extras`). Same night
 * by definition — matched on `period_end`. Returns null if no curve has
 * been ingested yet.
 */
export async function fetchLatestSpo2Night(): Promise<Spo2NightPayload | null> {
  const supabase = createServiceClient()

  // Pull the latest curve row first; we'll match the ODI row on the same
  // period_end to get the night's events.
  const { data: curveRow, error: curveErr } = await supabase
    .from('health_observations')
    .select('extras, period_end')
    .eq('source_slug', 'oxylink_csv')
    .eq('metric_type', 'spo2_overnight_curve')
    .not('period_end', 'is', null)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (curveErr || !curveRow) return null
  const curveExtras = (curveRow as { extras: Record<string, unknown> | null }).extras
  const periodEnd = (curveRow as { period_end: string }).period_end
  if (!curveExtras) return null
  const intervalS = Number(curveExtras.interval_s)
  const startIso = curveExtras.start_ts as string | undefined
  const arr = curveExtras.spo2 as (number | null)[] | undefined
  if (!Number.isFinite(intervalS) || !startIso || !Array.isArray(arr) || arr.length === 0) return null
  const start = new Date(startIso).getTime()
  const curve: Spo2CurvePoint[] = new Array(arr.length)
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    const t = new Date(start + i * intervalS * 1000)
    curve[i] = { time: t, value: typeof v === 'number' && Number.isFinite(v) ? v : null }
  }

  // Match the ODI row from the SAME night (same period_end) — its extras
  // carry the true per-event array captured at full resolution.
  let events: Spo2DesatEvent[] = []
  const { data: odiRow } = await supabase
    .from('health_observations')
    .select('extras')
    .eq('source_slug', 'oxylink_csv')
    .eq('metric_type', 'spo2_odi')
    .eq('period_end', periodEnd)
    .maybeSingle()
  if (odiRow) {
    const odiExtras = (odiRow as { extras: Record<string, unknown> | null }).extras
    const raw = odiExtras?.desaturation_events
    if (Array.isArray(raw)) {
      events = (raw as Array<Record<string, unknown>>)
        .map((e) => {
          const t = Number(e.t)
          const nadir = Number(e.nadir_spo2)
          const drop = Number(e.drop_pct)
          if (!Number.isFinite(t) || !Number.isFinite(nadir) || !Number.isFinite(drop)) return null
          return {
            time: new Date(t),
            nadirSpo2: nadir,
            dropPct: drop,
            also4Pct: e.also_4pct === true,
          } as Spo2DesatEvent
        })
        .filter((e): e is Spo2DesatEvent => e !== null)
    }
  }

  return { curve, events }
}
