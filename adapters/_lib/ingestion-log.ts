import type { SupabaseClient } from '@supabase/supabase-js'

export async function createIngestionLog(
  supabase: SupabaseClient,
  sourceSlug: string,
  windowStart: Date,
  windowEnd: Date
): Promise<string> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .insert({
      source_slug: sourceSlug,
      fetch_window_start: windowStart.toISOString(),
      fetch_window_end: windowEnd.toISOString(),
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create ingestion_log row: ${error?.message}`)
  }

  return data.id as string
}

export async function updateIngestionLog(
  supabase: SupabaseClient,
  logId: string,
  update: {
    status: 'success' | 'partial' | 'error'
    recordsFound: number
    recordsWritten: number
    recordsSkipped: number
    rawPayload?: unknown
    errorDetail?: string
  }
): Promise<void> {
  const { error } = await supabase
    .from('ingestion_log')
    .update({
      status: update.status,
      records_found: update.recordsFound,
      records_written: update.recordsWritten,
      records_skipped: update.recordsSkipped,
      raw_payload: update.rawPayload ?? null,
      error_detail: update.errorDetail ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', logId)

  if (error) {
    console.error(`Failed to update ingestion_log row ${logId}:`, error.message)
  }
}

/**
 * Returns the fetch_window_end of the most recent successful run for a source,
 * or null if no successful run exists (first run / backfill).
 */
export async function getLastSuccessfulWindowEnd(
  supabase: SupabaseClient,
  sourceSlug: string
): Promise<Date | null> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .select('fetch_window_end')
    .eq('source_slug', sourceSlug)
    .eq('status', 'success')
    .order('fetch_window_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data?.fetch_window_end) return null

  return new Date(data.fetch_window_end as string)
}
