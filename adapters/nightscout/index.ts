import type { SupabaseClient } from '@supabase/supabase-js'
import type { Adapter, AdapterConfig, IngestionResult } from '../_lib/types'
import {
  createIngestionLog,
  updateIngestionLog,
  getLastCoveredWindowEnd,
} from '../_lib/ingestion-log'
import { computeIngestWindow, INGEST_WINDOW_CONFIG } from '../_lib/ingestion-window'
import { mgdlToMmol } from '@/app/log/_lib/glucose'
import { getEntries, type NightscoutEntry } from './api'

const SOURCE_SLUG = 'nightscout'

/**
 * Backfill start used only when no prior successful run exists AND the caller
 * didn't pass a window. Nightscout history begins 2026-05-28 (Clarity backfill),
 * so 2026-05-01 is the earliest sensible default. POST { fromDate: '…' } to
 * /api/ingest/nightscout to override.
 */
const BACKFILL_START_DATE = new Date('2026-05-01T00:00:00.000Z')

/**
 * Plausibility guard for CGM readings (mg/dL). Real CGM output starts at 40 —
 * Dexcom G7's measurement range is 40–400 and Libre's is 40–500. Anything
 * below 40 is a sentinel/special code (0, 1, single digits, "LOW" encodings),
 * not a real reading. 40–500 cleanly covers the valid range for both devices
 * (keeping the adapter device-agnostic) while excluding all sub-40 sentinels.
 */
const SGV_MIN_MGDL = 40
const SGV_MAX_MGDL = 500

const INSERT_BATCH_SIZE = 200

export interface CgmRow {
  source_slug: string
  source_record_id: string
  data_shape: 'time_series'
  metric_type: 'glucose_cgm'
  recorded_at: string
  numeric_value: number
  unit: 'mg/dL'
  canonical_value: number
  canonical_unit: 'mmol/L'
  extras: Record<string, unknown>
  ingestion_log_id: string
}

/**
 * Build a `health_observations` row from a Nightscout entry.
 * Returns null if the entry is not a valid sgv reading — wrong type, missing
 * or non-numeric `sgv`, or outside the 40–500 mg/dL plausibility band. The
 * skip reasons are intentional and apply identically in the cron adapter and
 * in the refill route (gotcha #25 — adapter and refill must agree on filters).
 *
 * `extras` keys are OMITTED when undefined (vs. stored as null). Querying
 * `extras->>'direction'` returns null either way; this keeps the JSON
 * compact for clarity-backfill rows that have no trend info.
 */
export function buildCgmRow(
  entry: NightscoutEntry,
  ingestion_log_id: string
): CgmRow | null {
  if (entry.type !== 'sgv') return null
  if (typeof entry.sgv !== 'number' || !Number.isFinite(entry.sgv)) return null
  if (entry.sgv < SGV_MIN_MGDL || entry.sgv > SGV_MAX_MGDL) return null
  if (typeof entry.date !== 'number' || !Number.isFinite(entry.date)) return null
  if (typeof entry._id !== 'string' || entry._id.length === 0) return null

  const extras: Record<string, unknown> = {}
  if (entry.direction !== undefined) extras.direction = entry.direction
  if (entry.device !== undefined) extras.device = entry.device
  if (entry.noise !== undefined) extras.noise = entry.noise

  return {
    source_slug: SOURCE_SLUG,
    source_record_id: entry._id,
    data_shape: 'time_series',
    metric_type: 'glucose_cgm',
    recorded_at: new Date(entry.date).toISOString(),
    numeric_value: entry.sgv,
    unit: 'mg/dL',
    canonical_value: mgdlToMmol(entry.sgv),
    canonical_unit: 'mmol/L',
    extras,
    ingestion_log_id,
  }
}

export const nightscoutAdapter: Adapter = {
  sourceSlug: SOURCE_SLUG,

  async fetchAndIngest(config: AdapterConfig): Promise<IngestionResult> {
    const { supabase, fromDate, toDate } = config

    // 1. Resolve fetch window. Caller-supplied dates win (refill/backfill);
    // otherwise frontier-based, widened lookback + capped (H1 + H3, gotcha
    // #157/#158) — the cron route no longer passes explicit dates, so this
    // is now the live path for the cron too (previously bypassed, see the
    // route's own history).
    let windowStart: Date
    let windowEnd: Date
    if (fromDate) {
      windowStart = fromDate
      windowEnd = toDate ?? new Date()
    } else {
      const lastEnd = await getLastCoveredWindowEnd(supabase, SOURCE_SLUG)
      const win = computeIngestWindow(
        lastEnd,
        Date.now(),
        INGEST_WINDOW_CONFIG.nightscout.lookbackMs,
        INGEST_WINDOW_CONFIG.nightscout.maxLookbackMs,
        BACKFILL_START_DATE
      )
      windowStart = win.windowStart
      windowEnd = win.windowEnd
    }

    // 2. Open ingestion_log
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
      // 3. Fetch entries (single call — caller controls window size; cron
      //    sends ~48h, refill walks 30-day chunks).
      const entries = await getEntries({
        fromDate: windowStart,
        toDate: windowEnd,
      })

      // Episodic: an empty window between sensor stints is success, not error.
      // The spec is explicit on this (CLAUDE.md gotcha to be added).
      const recordsFound = entries.length

      // 4. Build rows via the shared filter. Track skip reasons inline.
      const planned: CgmRow[] = []
      let filteredOutOfRange = 0
      let filteredNonSgv = 0
      for (const e of entries) {
        const row = buildCgmRow(e, logId)
        if (row) {
          planned.push(row)
        } else if (e.type !== 'sgv') {
          filteredNonSgv++
        } else {
          // Most common: out-of-range or missing sgv.
          filteredOutOfRange++
        }
      }

      const recordsSkippedByFilter = filteredOutOfRange + filteredNonSgv

      // 5. Batch upsert. Idempotent via UNIQUE (source_slug, source_record_id).
      let inserted = 0
      const insertErrors: string[] = []
      for (let i = 0; i < planned.length; i += INSERT_BATCH_SIZE) {
        const batch = planned.slice(i, i + INSERT_BATCH_SIZE)
        const result = await batchUpsertObservations(supabase, batch)
        if (result.error) {
          insertErrors.push(
            `batch ${i}-${i + batch.length}: ${result.error}`
          )
        } else {
          inserted += batch.length
        }
      }

      // Records skipped at the DB level (already present, upsert idempotent)
      // are NOT counted here separately — Postgres treats them as part of the
      // upsert. We expose what we filtered + an approximate "already in DB"
      // figure (inserted vs planned) in the refill route. The cron just needs
      // a status verdict.
      const recordsWritten = inserted
      const recordsSkipped = recordsSkippedByFilter

      const status: 'success' | 'partial' | 'error' =
        insertErrors.length === 0
          ? 'success'
          : recordsWritten > 0
          ? 'partial'
          : 'error'

      await updateIngestionLog(supabase, logId, {
        status,
        recordsFound,
        recordsWritten,
        recordsSkipped,
        rawPayload: {
          entryCount: entries.length,
          filteredOutOfRange,
          filteredNonSgv,
        },
        errorDetail: insertErrors.length
          ? insertErrors.join(' | ').slice(0, 500)
          : undefined,
      })

      return {
        ingestionLogId: logId,
        recordsFound,
        recordsWritten,
        recordsSkipped,
        errors: insertErrors,
        status,
      }
    } catch (err) {
      const message = (err as Error).message
      await updateIngestionLog(supabase, logId, {
        status: 'error',
        recordsFound: 0,
        recordsWritten: 0,
        recordsSkipped: 0,
        errorDetail: message,
      })
      return {
        ingestionLogId: logId,
        recordsFound: 0,
        recordsWritten: 0,
        recordsSkipped: 0,
        errors: [message],
        status: 'error',
      }
    }
  },
}

async function batchUpsertObservations(
  supabase: SupabaseClient,
  batch: CgmRow[]
): Promise<{ error?: string }> {
  if (batch.length === 0) return {}
  const { error } = await supabase
    .from('health_observations')
    .upsert(batch, { onConflict: 'source_slug,source_record_id' })
  if (error) return { error: error.message }
  return {}
}
