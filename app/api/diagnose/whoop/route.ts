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
  'spo2_overnight_avg',
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

  const tokens = await getTokens(supabase, 'whoop')
  if (!tokens) {
    return NextResponse.json(
      { error: 'No Whoop tokens in oauth_tokens. Run handshake first.' },
      { status: 400 }
    )
  }

  const fresh = await ensureFreshToken(supabase, tokens)

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

  const fromCycles = cyclesBreakdown.scored
  const fromRecoveries = recoveriesBreakdown.scored * RECOVERY_METRICS.length
  const fromSleeps = sleepsBreakdown.scored * SLEEP_METRICS.length
  const expectedTotal = fromCycles + fromRecoveries + fromSleeps

  // ── Count actual rows in DB for the same window ────────────────────────────

  // Single round-trip: fetch metric_type for all whoop rows whose period_start
  // falls in [windowStart, windowEnd]. Count in memory.
  const { data: dbRows, error: dbError } = await supabase
    .from('health_observations')
    .select('metric_type')
    .eq('source_slug', 'whoop')
    .gte('period_start', fromDate.toISOString())
    .lte('period_start', toDate.toISOString())

  if (dbError) {
    return NextResponse.json(
      { error: `DB count failed: ${dbError.message}` },
      { status: 500 }
    )
  }

  const byMetricType: Record<string, number> = {}
  for (const r of dbRows ?? []) {
    const mt = (r as { metric_type: string }).metric_type
    byMetricType[mt] = (byMetricType[mt] ?? 0) + 1
  }
  const totalForWindow = dbRows?.length ?? 0

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

  pushRow('strain_score', cyclesBreakdown.scored)
  for (const m of RECOVERY_METRICS) pushRow(m, recoveriesBreakdown.scored)
  for (const m of SLEEP_METRICS) pushRow(m, sleepsBreakdown.scored)

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
