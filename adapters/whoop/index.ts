import type { SupabaseClient } from '@supabase/supabase-js'
import type { Adapter, AdapterConfig, IngestionResult } from '../_lib/types'
import { normaliseUnit } from '../_lib/normalise'
import {
  createIngestionLog,
  updateIngestionLog,
  getLastSuccessfulWindowEnd,
} from '../_lib/ingestion-log'
import { getTokens } from '../_lib/token-store'
import {
  ensureFreshToken,
  fetchCycles,
  fetchRecoveries,
  fetchSleepSessions,
} from './api'

/**
 * Backfill from this date on the very first run.
 * Set to just before the 2026-04-28 STEMI to capture pre/post-event baseline
 * while staying inside Vercel function timeout. Older history (2025 + early
 * 2026) can be backfilled later by POSTing fromDate/toDate to /api/ingest/whoop.
 */
const BACKFILL_START_DATE = new Date('2026-04-15T00:00:00.000Z')

const SOURCE_SLUG = 'whoop'

export const whoopAdapter: Adapter = {
  sourceSlug: SOURCE_SLUG,

  async fetchAndIngest(config: AdapterConfig): Promise<IngestionResult> {
    const { supabase, fromDate, toDate } = config
    const errors: string[] = []
    let recordsFound = 0
    let recordsWritten = 0
    let recordsSkipped = 0

    // 1. Resolve fetch window
    const windowEnd = toDate ?? new Date()

    let windowStart: Date
    if (fromDate) {
      windowStart = fromDate
    } else {
      const lastEnd = await getLastSuccessfulWindowEnd(supabase, SOURCE_SLUG)
      // Overlap by 1 day to catch late-arriving Whoop data
      windowStart = lastEnd
        ? new Date(lastEnd.getTime() - 24 * 60 * 60 * 1000)
        : BACKFILL_START_DATE
    }

    // 2. Create ingestion_log row
    let logId: string
    try {
      logId = await createIngestionLog(
        supabase,
        SOURCE_SLUG,
        windowStart,
        windowEnd
      )
    } catch (err) {
      return {
        ingestionLogId: 'unknown',
        recordsFound: 0,
        recordsWritten: 0,
        recordsSkipped: 0,
        errors: [`Failed to create ingestion_log: ${(err as Error).message}`],
        status: 'error',
      }
    }

    try {
      // 3. Authenticate
      const storedTokens = await getTokens(supabase, SOURCE_SLUG)
      if (!storedTokens) {
        throw new Error(
          'No Whoop tokens found in oauth_tokens. Run the OAuth handshake first.'
        )
      }

      const tokens = await ensureFreshToken(supabase, storedTokens)
      const { accessToken } = tokens

      // 4. Fetch from Whoop
      const [cycles, recoveries, sleepSessions] = await Promise.all([
        fetchCycles(accessToken, windowStart, windowEnd),
        fetchRecoveries(accessToken, windowStart, windowEnd),
        fetchSleepSessions(accessToken, windowStart, windowEnd),
      ])

      const rawPayload = { cycles, recoveries, sleep: sleepSessions }

      // 5 & 6. Normalise and upsert

      // Cycle lookup for recovery period timestamps
      const cycleMap = new Map<number, { start: string; end: string }>()
      for (const c of cycles) {
        cycleMap.set(c.id, { start: c.start, end: c.end })
      }

      // 5a. Cycle metrics — strain
      for (const cycle of cycles) {
        if (cycle.score_state !== 'SCORED' || !cycle.score) continue

        const period_start = cycle.start
        const period_end = cycle.end

        const cycleMetrics = [
          {
            metric_type: 'strain_score',
            value: cycle.score.strain,
            unit: 'dimensionless',
          },
        ]

        recordsFound += cycleMetrics.length

        for (const m of cycleMetrics) {
          const result = await upsertObservation(supabase, {
            source_slug: SOURCE_SLUG,
            source_record_id: `cycle_${cycle.id}_${m.metric_type}`,
            data_shape: 'daily_summary',
            metric_type: m.metric_type,
            period_start,
            period_end,
            numeric_value: m.value,
            unit: m.unit,
            canonical_value: m.value,
            canonical_unit: m.unit,
            ingestion_log_id: logId,
          })
          if (result === 'written') recordsWritten++
          else if (result === 'skipped') recordsSkipped++
          else errors.push(result)
        }
      }

      // 5b. Recovery metrics
      for (const rec of recoveries) {
        if (rec.score_state !== 'SCORED' || !rec.score) continue

        const cycle = cycleMap.get(rec.cycle_id)
        if (!cycle) continue

        const period_start = cycle.start
        const period_end = cycle.end

        const recoveryMetrics: Array<{
          metric_type: string
          value: number
          unit: string
          canonical_unit: string
        }> = [
          {
            metric_type: 'recovery_score',
            value: rec.score.recovery_score,
            unit: 'dimensionless',
            canonical_unit: 'dimensionless',
          },
          {
            metric_type: 'hrv_rmssd',
            value: rec.score.hrv_rmssd_milli,
            unit: 'ms',
            canonical_unit: 'ms',
          },
          {
            metric_type: 'heart_rate_resting',
            value: rec.score.resting_heart_rate,
            unit: 'bpm',
            canonical_unit: 'bpm',
          },
          {
            metric_type: 'spo2_overnight_avg',
            value: rec.score.spo2_percentage,
            unit: '%',
            canonical_unit: '%',
          },
        ]

        recordsFound += recoveryMetrics.length

        for (const m of recoveryMetrics) {
          const result = await upsertObservation(supabase, {
            source_slug: SOURCE_SLUG,
            source_record_id: `recovery_${rec.cycle_id}_${m.metric_type}`,
            data_shape: 'daily_summary',
            metric_type: m.metric_type,
            period_start,
            period_end,
            numeric_value: m.value,
            unit: m.unit,
            canonical_value: m.value,
            canonical_unit: m.canonical_unit,
            ingestion_log_id: logId,
          })
          if (result === 'written') recordsWritten++
          else if (result === 'skipped') recordsSkipped++
          else errors.push(result)
        }
      }

      // 5c. Sleep metrics (exclude naps)
      for (const sleep of sleepSessions) {
        if (sleep.nap) continue
        if (sleep.score_state !== 'SCORED' || !sleep.score) continue

        const period_start = sleep.start
        const period_end = sleep.end
        const stages = sleep.score.stage_summary

        const totalSleepMilli =
          stages.total_light_sleep_time_milli +
          stages.total_slow_wave_sleep_time_milli +
          stages.total_rem_sleep_time_milli

        const sleepMetrics: Array<{
          metric_type: string
          value: number
          unit: string
          canonical_unit: string
        }> = [
          {
            metric_type: 'sleep_score',
            value: sleep.score.sleep_performance_percentage,
            unit: 'dimensionless',
            canonical_unit: 'dimensionless',
          },
          {
            metric_type: 'sleep_duration_total',
            value: totalSleepMilli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'sleep_duration_deep',
            value: stages.total_slow_wave_sleep_time_milli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'sleep_duration_rem',
            value: stages.total_rem_sleep_time_milli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'sleep_duration_light',
            value: stages.total_light_sleep_time_milli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'sleep_duration_awake',
            value: stages.total_awake_time_milli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'respiratory_rate',
            value: sleep.score.respiratory_rate,
            unit: 'breaths/min',
            canonical_unit: 'breaths/min',
          },
        ]

        recordsFound += sleepMetrics.length

        for (const m of sleepMetrics) {
          let canonicalValue: number
          try {
            canonicalValue = normaliseUnit(m.value, m.unit, m.canonical_unit)
          } catch (err) {
            errors.push(
              `sleep_${sleep.id}_${m.metric_type}: ${(err as Error).message}`
            )
            continue
          }

          const result = await upsertObservation(supabase, {
            source_slug: SOURCE_SLUG,
            source_record_id: `sleep_${sleep.id}_${m.metric_type}`,
            data_shape: 'daily_summary',
            metric_type: m.metric_type,
            period_start,
            period_end,
            numeric_value: m.value,
            unit: m.unit,
            canonical_value: canonicalValue,
            canonical_unit: m.canonical_unit,
            ingestion_log_id: logId,
          })
          if (result === 'written') recordsWritten++
          else if (result === 'skipped') recordsSkipped++
          else errors.push(result)
        }
      }

      // 7. Update ingestion_log
      const status =
        errors.length === 0
          ? 'success'
          : errors.length < recordsFound
          ? 'partial'
          : 'error'

      await updateIngestionLog(supabase, logId, {
        status,
        recordsFound,
        recordsWritten,
        recordsSkipped,
        rawPayload,
      })

      return {
        ingestionLogId: logId,
        recordsFound,
        recordsWritten,
        recordsSkipped,
        errors,
        status,
      }
    } catch (err) {
      const message = (err as Error).message

      await updateIngestionLog(supabase, logId, {
        status: 'error',
        recordsFound,
        recordsWritten,
        recordsSkipped,
        errorDetail: message,
      })

      return {
        ingestionLogId: logId,
        recordsFound,
        recordsWritten,
        recordsSkipped,
        errors: [message],
        status: 'error',
      }
    }
  },
}

// 'written' = row inserted or updated | 'skipped' = row existed, values identical | string = error message
type UpsertResult = 'written' | 'skipped' | string

async function upsertObservation(
  supabase: SupabaseClient,
  row: {
    source_slug: string
    source_record_id: string
    data_shape: string
    metric_type: string
    period_start: string
    period_end: string
    numeric_value: number
    unit: string
    canonical_value: number
    canonical_unit: string
    ingestion_log_id: string
  }
): Promise<UpsertResult> {
  // Check for an existing row with identical values first so we can count
  // skipped rows accurately. Supabase returns Postgres `numeric` as either
  // number or string depending on the driver — coerce both sides to Number
  // to compare safely.
  const { data: existing } = await supabase
    .from('health_observations')
    .select('numeric_value, canonical_value')
    .eq('source_slug', row.source_slug)
    .eq('source_record_id', row.source_record_id)
    .maybeSingle()

  if (
    existing &&
    Number(existing.numeric_value) === Number(row.numeric_value) &&
    Number(existing.canonical_value) === Number(row.canonical_value)
  ) {
    return 'skipped'
  }

  const { error } = await supabase
    .from('health_observations')
    .upsert(
      {
        source_slug: row.source_slug,
        source_record_id: row.source_record_id,
        data_shape: row.data_shape,
        metric_type: row.metric_type,
        period_start: row.period_start,
        period_end: row.period_end,
        numeric_value: row.numeric_value,
        unit: row.unit,
        canonical_value: row.canonical_value,
        canonical_unit: row.canonical_unit,
        ingestion_log_id: row.ingestion_log_id,
      },
      { onConflict: 'source_slug,source_record_id' }
    )

  if (error) {
    return `upsert error for ${row.source_record_id}: ${error.message}`
  }

  return 'written'
}
