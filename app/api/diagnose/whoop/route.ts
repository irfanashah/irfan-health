import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getTokens } from '@/adapters/_lib/token-store'
import {
  ensureFreshToken,
  fetchCycles,
  fetchRecoveries,
  fetchSleepSessions,
  type WhoopCycleRecord,
  type WhoopRecoveryRecord,
  type WhoopSleepRecord,
} from '@/adapters/whoop/api'

export const runtime = 'nodejs'
export const maxDuration = 800

const DEFAULT_FROM = '2025-01-01T00:00:00.000Z'

interface DiagnoseBody {
  fromDate?: string
  toDate?: string
}

interface TypeBreakdown {
  total: number
  scored: number
  byState: Record<string, number>
}

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
    cycles: TypeBreakdown
    recoveries: TypeBreakdown
    sleeps: TypeBreakdown & { nonNap: number; naps: number }
  }
  expectedRows: {
    fromCycles: number
    fromRecoveries: number
    fromSleeps: number
    total: number
  }
  actualRowsInDb: {
    totalForWindow: number
    byMetricType: Record<string, number>
  }
  comparison: MetricExpectedActual[]
  totalGap: number
}

function summarise(
  records: { score_state: string }[]
): TypeBreakdown {
  const byState: Record<string, number> = {}
  let scored = 0
  for (const r of records) {
    byState[r.score_state] = (byState[r.score_state] ?? 0) + 1
    if (r.score_state === 'SCORED') scored++
  }
  return { total: records.length, scored, byState }
}

const RECOVERY_METRICS = [
  'recovery_score',
  'hrv_rmssd',
  'heart_rate_resting',
  // The Whoop adapter writes SpO2 as 'spo2_whoop' (renamed from
  // 'spo2_overnight_avg' in migration_007 to disambiguate from Oxylink's
  // overnight measurement; gotcha #77). Without this rename Diagnose
  // reports a permanent false gap.
  'spo2_whoop',
  // skin_temp landed in the same Whoop slice — adapter writes it; needs
  // to be in expected-vs-actual for the gap calculation to match reality.
  'skin_temp',
] as const

const SLEEP_METRICS = [
  'sleep_score',
  'sleep_duration_total',
  'sleep_duration_deep',
  'sleep_duration_rem',
  'sleep_duration_light',
  'sleep_duration_awake',
  'respiratory_rate',
] as const

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseUser = await createServerSupabase()
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = ((await request.json().catch(() => ({}))) as DiagnoseBody) ?? {}
  const fromDate = new Date(body.fromDate ?? DEFAULT_FROM)
  const toDate = body.toDate ? new Date(body.toDate) : new Date()

  const supabase = createServiceClient()

  // ── Fetch from Whoop (no writes) ───────────────────────────────────────────

  let tokens
  try {
    tokens = await getTokens(supabase, 'whoop')
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read Whoop tokens: ${(err as Error).message}` },
      { status: 502 }
    )
  }
  if (!tokens) {
    return NextResponse.json(
      { error: 'Whoop not connected — open /api/auth/whoop while signed in to authorise.' },
      { status: 400 }
    )
  }

  // Token refresh can fail (expired/revoked/invalid refresh token). Catch it
  // here so it returns a clean, actionable 502 instead of an uncaught 500
  // with a raw stack — the refresh happens BEFORE the fetch try/catch below.
  let fresh
  try {
    fresh = await ensureFreshToken(supabase, tokens)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }

  let cycles: WhoopCycleRecord[]
  let recoveries: WhoopRecoveryRecord[]
  let sleeps: WhoopSleepRecord[]
  try {
    ;[cycles, recoveries, sleeps] = await Promise.all([
      fetchCycles(fresh.accessToken, fromDate, toDate),
      fetchRecoveries(fresh.accessToken, fromDate, toDate),
      fetchSleepSessions(fresh.accessToken, fromDate, toDate),
    ])
  } catch (err) {
    return NextResponse.json(
      { error: `Whoop fetch failed: ${(err as Error).message}` },
      { status: 502 }
    )
  }

  // Sleep needs nap split before scored counting
  const nonNapSleeps = sleeps.filter((s) => !s.nap)
  const naps = sleeps.length - nonNapSleeps.length

  const cyclesBreakdown = summarise(cycles)
  const recoveriesBreakdown = summarise(recoveries)
  const sleepsBreakdownRaw = summarise(nonNapSleeps)
  const sleepsBreakdown = { ...sleepsBreakdownRaw, nonNap: nonNapSleeps.length, naps }

  // ── Expected rows — mirror the ADAPTER's write rules so the gap reflects
  //    reality, not an idealised scored×N (L5). Two corrections:
  //    (a) Boundary alignment: attribute each record to its period_start
  //        (cycle.start; recovery → its linked cycle's start; sleep.start)
  //        and count only records whose period_start ∈ [fromDate,toDate] —
  //        the SAME predicate the DB count uses — so a cycle that started
  //        just before fromDate isn't counted as expected on one side and
  //        clipped on the other (phantom gap).
  //    (b) Nullable fields: spo2_whoop / skin_temp are 4.0+ fields the
  //        adapter null-skips (gotcha #34) — it writes no row when they're
  //        absent — so expected must count only non-null values, not every
  //        scored recovery. (The core three are non-null when scored, so
  //        their expected is unchanged.)
  const cycleById = new Map<number, WhoopCycleRecord>()
  for (const c of cycles) cycleById.set(c.id, c)

  const inWindow = (iso: string | null | undefined): boolean => {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return t >= fromDate.getTime() && t <= toDate.getTime()
  }

  const scoredCyclesInWindow = cycles.filter(
    (c) => c.score_state === 'SCORED' && c.score && c.start && c.end && inWindow(c.start)
  )
  const scoredRecInWindow = recoveries.filter((r) => {
    if (r.score_state !== 'SCORED' || !r.score) return false
    const c = cycleById.get(r.cycle_id)
    return !!c && !!c.start && !!c.end && inWindow(c.start)
  })
  const scoredSleepsInWindow = nonNapSleeps.filter(
    (s) => s.score_state === 'SCORED' && s.score && s.start && s.end && inWindow(s.start)
  )

  const recoveryFieldValue: Record<(typeof RECOVERY_METRICS)[number], (r: WhoopRecoveryRecord) => number | null | undefined> = {
    recovery_score: (r) => r.score?.recovery_score,
    hrv_rmssd: (r) => r.score?.hrv_rmssd_milli,
    heart_rate_resting: (r) => r.score?.resting_heart_rate,
    spo2_whoop: (r) => r.score?.spo2_percentage,
    skin_temp: (r) => r.score?.skin_temp_celsius,
  }
  const expectedRecoveryMetric = (mt: (typeof RECOVERY_METRICS)[number]): number =>
    scoredRecInWindow.filter((r) => {
      const v = recoveryFieldValue[mt](r)
      return v !== null && v !== undefined
    }).length

  const fromCycles = scoredCyclesInWindow.length
  const fromRecoveries = RECOVERY_METRICS.reduce((acc, mt) => acc + expectedRecoveryMetric(mt), 0)
  const fromSleeps = scoredSleepsInWindow.length * SLEEP_METRICS.length
  const expectedTotal = fromCycles + fromRecoveries + fromSleeps

  // ── Count actual rows in DB for the same window ────────────────────────────
  //
  // One exact-count query per metric_type, in parallel. Cheaper and more
  // accurate than a single .select() (Supabase JS silently caps that at 1000
  // rows by default, which gave us truncated counts in v1 of this route).
  const allMetrics: string[] = [
    'strain_score',
    ...RECOVERY_METRICS,
    ...SLEEP_METRICS,
  ]

  const counts = await Promise.all(
    allMetrics.map(async (mt) => {
      const { count, error } = await supabase
        .from('health_observations')
        .select('*', { count: 'exact', head: true })
        .eq('source_slug', 'whoop')
        .eq('metric_type', mt)
        .gte('period_start', fromDate.toISOString())
        .lte('period_start', toDate.toISOString())

      if (error) {
        throw new Error(`Count for ${mt} failed: ${error.message}`)
      }
      return { metric_type: mt, count: count ?? 0 }
    })
  )

  const byMetricType: Record<string, number> = {}
  let totalForWindow = 0
  for (const { metric_type, count } of counts) {
    byMetricType[metric_type] = count
    totalForWindow += count
  }

  // ── Build comparison ──────────────────────────────────────────────────────

  const comparison: MetricExpectedActual[] = []
  const pushRow = (metric_type: string, expectedFromWhoop: number) => {
    const actualInDb = byMetricType[metric_type] ?? 0
    comparison.push({
      metric_type,
      expectedFromWhoop,
      actualInDb,
      gap: expectedFromWhoop - actualInDb,
    })
  }

  pushRow('strain_score', fromCycles)
  for (const m of RECOVERY_METRICS) pushRow(m, expectedRecoveryMetric(m))
  for (const m of SLEEP_METRICS) pushRow(m, scoredSleepsInWindow.length)

  const totalGap = comparison.reduce((acc, c) => acc + c.gap, 0)

  const payload: DiagnoseResult = {
    windowStart: fromDate.toISOString(),
    windowEnd: toDate.toISOString(),
    whoop: {
      cycles: cyclesBreakdown,
      recoveries: recoveriesBreakdown,
      sleeps: sleepsBreakdown,
    },
    expectedRows: {
      fromCycles,
      fromRecoveries,
      fromSleeps,
      total: expectedTotal,
    },
    actualRowsInDb: {
      totalForWindow,
      byMetricType,
    },
    comparison,
    totalGap,
  }

  return NextResponse.json(payload, { status: 200 })
}
