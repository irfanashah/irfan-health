import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getTokens } from '@/adapters/_lib/token-store'
import {
  createIngestionLog,
  updateIngestionLog,
} from '@/adapters/_lib/ingestion-log'
import { normaliseUnit } from '@/adapters/_lib/normalise'
import {
  ensureFreshToken,
  fetchCycles,
  fetchRecoveries,
  fetchSleepSessions,
} from '@/adapters/whoop/api'

export const runtime = 'nodejs'
export const maxDuration = 800

const DEFAULT_FROM = '2025-01-01T00:00:00.000Z'
const INSERT_BATCH_SIZE = 200

interface RefillBody {
  fromDate?: string
  toDate?: string
}

interface PlannedRow {
  source_record_id: string
  data_shape: 'daily_summary'
  metric_type: string
  period_start: string
  period_end: string
  numeric_value: number
  unit: string
  canonical_value: number
  canonical_unit: string
}

const RECOVERY_METRICS = [
  'recovery_score',
  'hrv_rmssd',
  'heart_rate_resting',
  // Whoop SpO2 — renamed from 'spo2_overnight_avg' (collided with Oxylink's
  // type); migration_007 re-stamps history in place. Stays here as
  // corroborating only — NOT a drift metric (Oxylink is authoritative).
  'spo2_whoop',
  // Whoop skin temperature — recovery-payload field (4.0+).
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

  const body = ((await request.json().catch(() => ({}))) as RefillBody) ?? {}
  const fromDate = new Date(body.fromDate ?? DEFAULT_FROM)
  const toDate = body.toDate ? new Date(body.toDate) : new Date()

  const supabase = createServiceClient()
  const startedAt = Date.now()

  // ── 1. Auth + fetch from Whoop ─────────────────────────────────────────────
  const tokens = await getTokens(supabase, 'whoop')
  if (!tokens) {
    return NextResponse.json(
      { error: 'No Whoop tokens. Run handshake first.' },
      { status: 400 }
    )
  }
  const fresh = await ensureFreshToken(supabase, tokens)

  // Widen the cycles fetch backwards by 14 days. Some recoveries inside our
  // requested window link to cycles whose start fell just before `fromDate`
  // (cycle ends ~midnight, recovery is scored the next morning). Without the
  // buffer, those recoveries can't find their cycle in cycleMap and get silently
  // dropped. We still only emit strain_score rows for cycles whose start is
  // inside the requested window.
  const CYCLE_BUFFER_MS = 14 * 24 * 60 * 60 * 1000
  const cycleFetchFrom = new Date(fromDate.getTime() - CYCLE_BUFFER_MS)

  let cycles, recoveries, sleeps
  try {
    ;[cycles, recoveries, sleeps] = await Promise.all([
      fetchCycles(fresh.accessToken, cycleFetchFrom, toDate),
      fetchRecoveries(fresh.accessToken, fromDate, toDate),
      fetchSleepSessions(fresh.accessToken, fromDate, toDate),
    ])
  } catch (err) {
    return NextResponse.json(
      { error: `Whoop fetch failed: ${(err as Error).message}` },
      { status: 502 }
    )
  }

  // ── 2. Build planned rows in memory ────────────────────────────────────────
  const cycleMap = new Map<number, { start: string; end: string }>()
  for (const c of cycles) cycleMap.set(c.id, { start: c.start, end: c.end })

  const planned: PlannedRow[] = []
  const buildErrors: string[] = []

  // Cycle metrics — strain. Skip cycles whose start is before our window
  // (these only exist in `cycles` due to the 14-day buffer for recovery lookup).
  for (const cycle of cycles) {
    if (cycle.score_state !== 'SCORED' || !cycle.score) continue
    if (!cycle.start || !cycle.end) {
      buildErrors.push(
        `cycle_${cycle.id}_strain_score: null start/end (likely in-progress cycle)`
      )
      continue
    }
    if (new Date(cycle.start).getTime() < fromDate.getTime()) continue
    planned.push({
      source_record_id: `cycle_${cycle.id}_strain_score`,
      data_shape: 'daily_summary',
      metric_type: 'strain_score',
      period_start: cycle.start,
      period_end: cycle.end,
      numeric_value: cycle.score.strain,
      unit: 'dimensionless',
      canonical_value: cycle.score.strain,
      canonical_unit: 'dimensionless',
    })
  }

  // Recovery metrics
  for (const rec of recoveries) {
    if (rec.score_state !== 'SCORED' || !rec.score) continue
    const cycle = cycleMap.get(rec.cycle_id)
    if (!cycle) {
      buildErrors.push(
        `recovery_${rec.cycle_id}_*: cycle ${rec.cycle_id} not in fetched cycles (even with 14d buffer)`
      )
      continue
    }
    if (!cycle.start || !cycle.end) {
      buildErrors.push(
        `recovery_${rec.cycle_id}_*: linked cycle ${rec.cycle_id} has null start/end`
      )
      continue
    }

    // Whoop SpO2 + skin_temp are 4.0+ fields — typed nullable; null-guard
    // before pushing (filter applied in the loop) so absent fields don't
    // pollute trends with null rows (gotchas #25 + #34).
    const recMap: Record<string, { value: number | null; unit: string }> = {
      recovery_score: { value: rec.score.recovery_score, unit: 'dimensionless' },
      hrv_rmssd: { value: rec.score.hrv_rmssd_milli, unit: 'ms' },
      heart_rate_resting: { value: rec.score.resting_heart_rate, unit: 'bpm' },
      spo2_whoop: { value: rec.score.spo2_percentage, unit: '%' },
      skin_temp: { value: rec.score.skin_temp_celsius, unit: 'C' },
    }

    for (const metric_type of RECOVERY_METRICS) {
      const m = recMap[metric_type]
      if (m.value === null || m.value === undefined) continue
      planned.push({
        source_record_id: `recovery_${rec.cycle_id}_${metric_type}`,
        data_shape: 'daily_summary',
        metric_type,
        period_start: cycle.start,
        period_end: cycle.end,
        numeric_value: m.value,
        unit: m.unit,
        canonical_value: m.value,
        canonical_unit: m.unit,
      })
    }
  }

  // Sleep metrics (non-naps only)
  for (const sleep of sleeps) {
    if (sleep.nap) continue
    if (sleep.score_state !== 'SCORED' || !sleep.score) continue
    if (!sleep.start || !sleep.end) {
      buildErrors.push(
        `sleep_${sleep.id}_*: null start/end (likely in-progress sleep)`
      )
      continue
    }
    const stages = sleep.score.stage_summary
    const totalSleepMilli =
      stages.total_light_sleep_time_milli +
      stages.total_slow_wave_sleep_time_milli +
      stages.total_rem_sleep_time_milli

    const sleepMap: Record<
      string,
      { value: number; unit: string; canonical_unit: string }
    > = {
      sleep_score: {
        value: sleep.score.sleep_performance_percentage,
        unit: 'dimensionless',
        canonical_unit: 'dimensionless',
      },
      sleep_duration_total: {
        value: totalSleepMilli,
        unit: 'milliseconds',
        canonical_unit: 'min',
      },
      sleep_duration_deep: {
        value: stages.total_slow_wave_sleep_time_milli,
        unit: 'milliseconds',
        canonical_unit: 'min',
      },
      sleep_duration_rem: {
        value: stages.total_rem_sleep_time_milli,
        unit: 'milliseconds',
        canonical_unit: 'min',
      },
      sleep_duration_light: {
        value: stages.total_light_sleep_time_milli,
        unit: 'milliseconds',
        canonical_unit: 'min',
      },
      sleep_duration_awake: {
        value: stages.total_awake_time_milli,
        unit: 'milliseconds',
        canonical_unit: 'min',
      },
      respiratory_rate: {
        value: sleep.score.respiratory_rate,
        unit: 'breaths/min',
        canonical_unit: 'breaths/min',
      },
    }

    for (const metric_type of SLEEP_METRICS) {
      const m = sleepMap[metric_type]
      let canonicalValue: number
      try {
        canonicalValue = normaliseUnit(m.value, m.unit, m.canonical_unit)
      } catch (err) {
        buildErrors.push(
          `sleep_${sleep.id}_${metric_type}: ${(err as Error).message}`
        )
        continue
      }
      planned.push({
        source_record_id: `sleep_${sleep.id}_${metric_type}`,
        data_shape: 'daily_summary',
        metric_type,
        period_start: sleep.start,
        period_end: sleep.end,
        numeric_value: m.value,
        unit: m.unit,
        canonical_value: canonicalValue,
        canonical_unit: m.canonical_unit,
      })
    }
  }

  // ── 3. Pull existing IDs from DB in one shot (no 1000-row cap — paginate) ─
  const existingIds = new Set<string>()
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('health_observations')
      .select('source_record_id')
      .eq('source_slug', 'whoop')
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      return NextResponse.json(
        { error: `Read existing IDs failed: ${error.message}` },
        { status: 500 }
      )
    }
    if (!data || data.length === 0) break
    for (const row of data) {
      existingIds.add((row as { source_record_id: string }).source_record_id)
    }
    if (data.length < PAGE_SIZE) break
  }

  // ── 4. Diff: rows planned but not in DB ────────────────────────────────────
  const missing = planned.filter((p) => !existingIds.has(p.source_record_id))

  // ── 5. Log + insert in batches ─────────────────────────────────────────────
  let logId: string
  try {
    logId = await createIngestionLog(supabase, 'whoop', fromDate, toDate)
  } catch (err) {
    return NextResponse.json(
      { error: `ingestion_log create failed: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  let inserted = 0
  const insertErrors: string[] = []

  for (let i = 0; i < missing.length; i += INSERT_BATCH_SIZE) {
    const batch = missing.slice(i, i + INSERT_BATCH_SIZE)
    const rows = batch.map((p) => ({
      source_slug: 'whoop',
      source_record_id: p.source_record_id,
      data_shape: p.data_shape,
      metric_type: p.metric_type,
      period_start: p.period_start,
      period_end: p.period_end,
      numeric_value: p.numeric_value,
      unit: p.unit,
      canonical_value: p.canonical_value,
      canonical_unit: p.canonical_unit,
      ingestion_log_id: logId,
    }))

    const { error } = await supabase
      .from('health_observations')
      .upsert(rows, { onConflict: 'source_slug,source_record_id' })

    if (error) {
      insertErrors.push(
        `batch ${i}-${i + batch.length}: ${error.message}`
      )
    } else {
      inserted += batch.length
    }
  }

  const status: 'success' | 'partial' | 'error' =
    insertErrors.length === 0
      ? 'success'
      : inserted > 0
      ? 'partial'
      : 'error'

  await updateIngestionLog(supabase, logId, {
    status,
    recordsFound: planned.length,
    recordsWritten: inserted,
    recordsSkipped: planned.length - missing.length,
    errorDetail:
      buildErrors.concat(insertErrors).join(' | ').slice(0, 500) || undefined,
  })

  return NextResponse.json(
    {
      ingestionLogId: logId,
      whoopReturned: {
        cycles: cycles.length,
        recoveries: recoveries.length,
        sleeps: sleeps.length,
      },
      planned: planned.length,
      existingInDb: planned.length - missing.length,
      missingBeforeInsert: missing.length,
      inserted,
      buildErrors,
      insertErrors,
      elapsedMs: Date.now() - startedAt,
      status,
    },
    { status: status === 'error' ? 500 : 200 }
  )
}
