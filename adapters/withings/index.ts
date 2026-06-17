import type { SupabaseClient } from '@supabase/supabase-js'
import type { Adapter, AdapterConfig, IngestionResult } from '../_lib/types'
import {
  createIngestionLog,
  updateIngestionLog,
  getLastSuccessfulWindowEnd,
} from '../_lib/ingestion-log'
import { getTokens } from '../_lib/token-store'
import {
  ensureFreshToken,
  fetchBpMeasureGroups,
  MEAS_TYPE_DIASTOLIC,
  MEAS_TYPE_SYSTOLIC,
  MEAS_TYPE_PULSE,
  type WithingsMeasureGroup,
  type WithingsMeasure,
} from './api'

/** Backfill from this date on the very first run. */
const BACKFILL_START_DATE = new Date('2025-01-01T00:00:00.000Z')

const SOURCE_SLUG = 'withings'

/**
 * Withings `attrib` codes we accept as real measurements:
 *   0 = device-recorded, 1 = manual entry via app, 2 = manual override
 * Skipped: 4 (user objective), 5 (flagged wrong), 7 (creation-only stub),
 * and anything else we don't recognise. The refill route uses the same set
 * (see gotcha #24: adapter and refill must agree on what gets filtered).
 */
const ACCEPTED_ATTRIB = new Set<number>([0, 1, 2])

export interface BpRow {
  source_slug: string
  source_record_id: string
  measured_at: string
  systolic_mmhg: number
  diastolic_mmhg: number
  pulse_bpm: number | null
  position: string | null
  extras: Record<string, unknown>
  ingestion_log_id: string
}

function findMeasure(
  measures: WithingsMeasure[],
  type: number
): WithingsMeasure | undefined {
  return measures.find((m) => m.type === type)
}

/**
 * Withings encodes scale in the `unit` field as a power of 10.
 * Real value = value × 10^unit. Example: { value: 1200, unit: -1 } → 120.
 */
function realValue(m: WithingsMeasure): number {
  return m.value * Math.pow(10, m.unit)
}

/**
 * Build a `bp_readings` row from a Withings measuregrp.
 * Returns null if the group is not a valid BP reading — wrong attrib, missing
 * systolic, missing diastolic, etc. The skip reasons are intentional and apply
 * identically in the cron-driven adapter and in the refill route.
 */
export function buildBpRow(
  grp: WithingsMeasureGroup,
  ingestion_log_id: string
): BpRow | null {
  if (!ACCEPTED_ATTRIB.has(grp.attrib)) return null

  const sys = findMeasure(grp.measures, MEAS_TYPE_SYSTOLIC)
  const dia = findMeasure(grp.measures, MEAS_TYPE_DIASTOLIC)
  if (!sys || !dia) return null

  const pulse = findMeasure(grp.measures, MEAS_TYPE_PULSE)

  return {
    source_slug: SOURCE_SLUG,
    source_record_id: `bp_${grp.grpid}`,
    measured_at: new Date(grp.date * 1000).toISOString(),
    systolic_mmhg: Math.round(realValue(sys)),
    diastolic_mmhg: Math.round(realValue(dia)),
    pulse_bpm: pulse ? Math.round(realValue(pulse)) : null,
    position: null,
    extras: {
      deviceid: grp.deviceid ?? null,
      category: grp.category,
      attrib: grp.attrib,
      raw_measures: grp.measures,
    },
    ingestion_log_id,
  }
}

export const withingsAdapter: Adapter = {
  sourceSlug: SOURCE_SLUG,

  async fetchAndIngest(config: AdapterConfig): Promise<IngestionResult> {
    const { supabase, fromDate, toDate } = config
    const errors: string[] = []
    let recordsFound = 0
    let recordsWritten = 0
    let recordsSkipped = 0

    // 1. Resolve window
    const windowEnd = toDate ?? new Date()
    let windowStart: Date
    if (fromDate) {
      windowStart = fromDate
    } else {
      const lastEnd = await getLastSuccessfulWindowEnd(supabase, SOURCE_SLUG)
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
      // 3. Auth
      const stored = await getTokens(supabase, SOURCE_SLUG)
      if (!stored) {
        throw new Error(
          'No Withings tokens found in oauth_tokens. Run the OAuth handshake first.'
        )
      }
      const tokens = await ensureFreshToken(supabase, stored)

      // 4. Fetch
      const measureGrps = await fetchBpMeasureGroups(
        tokens.accessToken,
        windowStart,
        windowEnd
      )
      const rawPayload = { measuregrps: measureGrps }

      // 5 & 6. Build + upsert. The build step applies the same null/attrib
      // filter the refill route uses.
      for (const grp of measureGrps) {
        recordsFound++
        const row = buildBpRow(grp, logId)
        if (!row) {
          recordsSkipped++
          continue
        }
        const result = await upsertBpReading(supabase, row)
        if (result === 'written') recordsWritten++
        else if (result === 'skipped') recordsSkipped++
        else errors.push(result)
      }

      // 7. Update log
      const status: 'success' | 'partial' | 'error' =
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

type UpsertResult = 'written' | 'skipped' | string

async function upsertBpReading(
  supabase: SupabaseClient,
  row: BpRow
): Promise<UpsertResult> {
  // Per-row pre-check so we can count 'skipped' accurately. Postgres `smallint`
  // round-trips as JS number, but Number() coercion stays defensive (gotcha #8).
  const { data: existing } = await supabase
    .from('bp_readings')
    .select('systolic_mmhg, diastolic_mmhg, pulse_bpm')
    .eq('source_slug', row.source_slug)
    .eq('source_record_id', row.source_record_id)
    .maybeSingle()

  if (
    existing &&
    Number(existing.systolic_mmhg) === Number(row.systolic_mmhg) &&
    Number(existing.diastolic_mmhg) === Number(row.diastolic_mmhg) &&
    Number(existing.pulse_bpm ?? -1) === Number(row.pulse_bpm ?? -1)
  ) {
    return 'skipped'
  }

  const { error } = await supabase.from('bp_readings').upsert(
    {
      source_slug: row.source_slug,
      source_record_id: row.source_record_id,
      measured_at: row.measured_at,
      systolic_mmhg: row.systolic_mmhg,
      diastolic_mmhg: row.diastolic_mmhg,
      pulse_bpm: row.pulse_bpm,
      position: row.position,
      extras: row.extras,
      ingestion_log_id: row.ingestion_log_id,
    },
    { onConflict: 'source_slug,source_record_id' }
  )

  if (error) {
    return `upsert error for ${row.source_record_id}: ${error.message}`
  }
  return 'written'
}
