// Server-side fetcher for the /diagnostics file-drop panel (Slice 4).
//
// Reads the last ~20 ingestion_log rows for any file-drop source slug.
// "did each file land, and why didn't this one" — not source-vs-DB
// reconciliation (that's the Whoop/Withings/Nightscout panel pattern).

import { createServiceClient } from '@/lib/supabase/service'
import { FILE_DROP_SOURCE_SLUGS } from '@/adapters/file-drop/registry'

export interface FileDropLogRow {
  id: string
  source_slug: string
  triggered_at: string
  completed_at: string | null
  status: 'pending' | 'success' | 'partial' | 'error'
  records_found: number | null
  records_written: number | null
  records_skipped: number | null
  error_detail: string | null
  /** Decoded from raw_payload: file metadata + skip breakdown + parser meta. */
  payload: {
    filename?: string
    drive_file_id?: string | null
    parser?: string
    note?: string
    reason?: string
    skip_breakdown?: { sentinel: number; out_of_range: number; parse_errors: number }
    rows_seen?: number
    rows_valid?: number
    wake_date?: string
    spo2_avg?: number
    spo2_min?: number
    pulse_avg_bpm?: number
    session_duration_min?: number
    movement_events?: number
  }
}

export async function fetchFileDropLogs(limit = 20): Promise<FileDropLogRow[]> {
  if (FILE_DROP_SOURCE_SLUGS.length === 0) return []
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('ingestion_log')
    .select('id, source_slug, triggered_at, completed_at, status, records_found, records_written, records_skipped, error_detail, raw_payload')
    .in('source_slug', FILE_DROP_SOURCE_SLUGS as string[])
    .order('triggered_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`file-drop ingestion_log fetch failed: ${error.message}`)

  return (data ?? []).map((r) => {
    const row = r as {
      id: string
      source_slug: string
      triggered_at: string
      completed_at: string | null
      status: 'pending' | 'success' | 'partial' | 'error'
      records_found: number | null
      records_written: number | null
      records_skipped: number | null
      error_detail: string | null
      raw_payload: unknown
    }
    return {
      id: row.id,
      source_slug: row.source_slug,
      triggered_at: row.triggered_at,
      completed_at: row.completed_at,
      status: row.status,
      records_found: row.records_found,
      records_written: row.records_written,
      records_skipped: row.records_skipped,
      error_detail: row.error_detail,
      payload: (row.raw_payload as FileDropLogRow['payload']) ?? {},
    }
  })
}
