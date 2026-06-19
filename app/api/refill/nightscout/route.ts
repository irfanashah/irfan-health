import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  createIngestionLog,
  updateIngestionLog,
} from '@/adapters/_lib/ingestion-log'
import { getEntries, type NightscoutEntry } from '@/adapters/nightscout/api'
import { buildCgmRow, type CgmRow } from '@/adapters/nightscout'

export const runtime = 'nodejs'
export const maxDuration = 800

// CGM history starts 2026-05-28 (Clarity backfill). Older windows are guaranteed
// empty — no point walking 17 empty 30-day chunks back to Jan 2025. POST
// { fromDate: '…' } overrides per-call when needed.
const DEFAULT_FROM = '2026-05-01T00:00:00.000Z'
const SOURCE_SLUG = 'nightscout'
const INSERT_BATCH_SIZE = 200
const READ_PAGE_SIZE = 1000

// 30-day chunks for NS pulls. CGM is ~288 readings/day; 30 d × 288 ≈ 8,640
// per chunk, well below our count=100000 cap. Smaller chunks would multiply
// HTTP overhead without gain.
const CHUNK_MS = 30 * 24 * 60 * 60 * 1000

interface RefillBody {
  fromDate?: string
  toDate?: string
}

interface ChunkSummary {
  fromDate: string
  toDate: string
  entries: number
}

interface RefillResult {
  ingestionLogId: string
  window: { fromDate: string; toDate: string }
  chunks: ChunkSummary[]
  nightscoutReturned: number
  planned: number
  existingInDb: number
  missingBeforeInsert: number
  inserted: number
  buildErrors: string[]
  insertErrors: string[]
  elapsedMs: number
  status: 'success' | 'partial' | 'error'
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Session auth
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

  if (!(fromDate.getTime() < toDate.getTime())) {
    return NextResponse.json(
      { error: 'fromDate must be earlier than toDate' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()
  const startedAt = Date.now()

  // 1. Open an ingestion_log row so the refill leaves an audit trail.
  let logId: string
  try {
    logId = await createIngestionLog(supabase, SOURCE_SLUG, fromDate, toDate)
  } catch (err) {
    return NextResponse.json(
      { error: `ingestion_log create failed: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  // 2. Walk the window in 30-day chunks, accumulating sgv entries.
  const chunks: ChunkSummary[] = []
  const allEntries: NightscoutEntry[] = []
  try {
    for (
      let chunkStart = fromDate.getTime();
      chunkStart < toDate.getTime();
      chunkStart += CHUNK_MS
    ) {
      const chunkEnd = Math.min(chunkStart + CHUNK_MS, toDate.getTime())
      const chunkFromDate = new Date(chunkStart)
      const chunkToDate = new Date(chunkEnd)

      const entries = await getEntries({
        fromDate: chunkFromDate,
        toDate: chunkToDate,
      })

      chunks.push({
        fromDate: chunkFromDate.toISOString(),
        toDate: chunkToDate.toISOString(),
        entries: entries.length,
      })
      allEntries.push(...entries)
    }
  } catch (err) {
    await updateIngestionLog(supabase, logId, {
      status: 'error',
      recordsFound: 0,
      recordsWritten: 0,
      recordsSkipped: 0,
      errorDetail: `Nightscout fetch failed: ${(err as Error).message}`,
    })
    return NextResponse.json(
      { error: `Nightscout fetch failed: ${(err as Error).message}` },
      { status: 502 }
    )
  }

  // 3. Build planned rows using the shared filter (gotcha #25 — keep adapter
  //    and refill agreeing on what gets filtered). Track skips for honesty.
  const planned: CgmRow[] = []
  const buildErrors: string[] = []
  let nonSgv = 0
  let outOfRange = 0
  for (const entry of allEntries) {
    const row = buildCgmRow(entry, logId)
    if (!row) {
      if (entry.type !== 'sgv') {
        nonSgv++
      } else {
        outOfRange++
      }
      continue
    }
    planned.push(row)
  }
  if (nonSgv > 0) buildErrors.push(`non-sgv filtered: ${nonSgv}`)
  if (outOfRange > 0) buildErrors.push(`out-of-range/blank sgv filtered: ${outOfRange}`)

  // 4. Pull existing source_record_ids for source_slug='nightscout', paginated
  //    past Supabase's 1000-row .select() cap (gotcha #10).
  const existingIds = new Set<string>()
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('health_observations')
      .select('source_record_id')
      .eq('source_slug', SOURCE_SLUG)
      .range(offset, offset + READ_PAGE_SIZE - 1)

    if (error) {
      await updateIngestionLog(supabase, logId, {
        status: 'error',
        recordsFound: planned.length,
        recordsWritten: 0,
        recordsSkipped: 0,
        errorDetail: `Read existing IDs failed: ${error.message}`,
      })
      return NextResponse.json(
        { error: `Read existing IDs failed: ${error.message}` },
        { status: 500 }
      )
    }
    if (!data || data.length === 0) break
    for (const row of data) {
      existingIds.add((row as { source_record_id: string }).source_record_id)
    }
    if (data.length < READ_PAGE_SIZE) break
  }

  // 5. Diff in memory.
  const missing = planned.filter((r) => !existingIds.has(r.source_record_id))

  // 6. Batch upsert 200 at a time (gotcha #11 — invalid rows were filtered in
  //    step 3, so batches should land cleanly).
  let inserted = 0
  const insertErrors: string[] = []
  for (let i = 0; i < missing.length; i += INSERT_BATCH_SIZE) {
    const batch = missing.slice(i, i + INSERT_BATCH_SIZE)
    const { error } = await supabase
      .from('health_observations')
      .upsert(batch, { onConflict: 'source_slug,source_record_id' })
    if (error) {
      insertErrors.push(`batch ${i}-${i + batch.length}: ${error.message}`)
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

  const payload: RefillResult = {
    ingestionLogId: logId,
    window: { fromDate: fromDate.toISOString(), toDate: toDate.toISOString() },
    chunks,
    nightscoutReturned: allEntries.length,
    planned: planned.length,
    existingInDb: planned.length - missing.length,
    missingBeforeInsert: missing.length,
    inserted,
    buildErrors,
    insertErrors,
    elapsedMs: Date.now() - startedAt,
    status,
  }

  return NextResponse.json(payload, {
    status: status === 'error' ? 500 : 200,
  })
}
