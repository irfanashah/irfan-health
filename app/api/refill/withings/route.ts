import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getTokens } from '@/adapters/_lib/token-store'
import {
  createIngestionLog,
  updateIngestionLog,
} from '@/adapters/_lib/ingestion-log'
import {
  ensureFreshToken,
  fetchBpMeasureGroups,
  MEAS_TYPE_DIASTOLIC,
  MEAS_TYPE_SYSTOLIC,
} from '@/adapters/withings/api'
import { buildBpRow, type BpRow } from '@/adapters/withings'

export const runtime = 'nodejs'
export const maxDuration = 800

const DEFAULT_FROM = '2025-01-01T00:00:00.000Z'
const INSERT_BATCH_SIZE = 200

interface RefillBody {
  fromDate?: string
  toDate?: string
}

interface RefillResult {
  ingestionLogId: string
  withingsReturned: { measureGrps: number }
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

  const supabase = createServiceClient()
  const startedAt = Date.now()

  // 1. Auth + fetch from Withings
  const tokens = await getTokens(supabase, 'withings')
  if (!tokens) {
    return NextResponse.json(
      { error: 'No Withings tokens. Run handshake first.' },
      { status: 400 }
    )
  }
  const fresh = await ensureFreshToken(supabase, tokens)

  let measureGrps
  try {
    measureGrps = await fetchBpMeasureGroups(fresh.accessToken, fromDate, toDate)
  } catch (err) {
    return NextResponse.json(
      { error: `Withings fetch failed: ${(err as Error).message}` },
      { status: 502 }
    )
  }

  // 2. Open ingestion_log so every refill leaves an audit row
  let logId: string
  try {
    logId = await createIngestionLog(supabase, 'withings', fromDate, toDate)
  } catch (err) {
    return NextResponse.json(
      { error: `ingestion_log create failed: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  // 3. Build planned rows in memory using the shared filter (gotcha #24).
  //    Track skip reasons in buildErrors so the diagnostic surface is honest.
  const planned: BpRow[] = []
  const buildErrors: string[] = []
  for (const grp of measureGrps) {
    const row = buildBpRow(grp, logId)
    if (!row) {
      const hasSys = grp.measures.some((m) => m.type === MEAS_TYPE_SYSTOLIC)
      const hasDia = grp.measures.some((m) => m.type === MEAS_TYPE_DIASTOLIC)
      buildErrors.push(
        `grp ${grp.grpid}: filtered (attrib=${grp.attrib}, sys=${hasSys}, dia=${hasDia})`
      )
      continue
    }
    planned.push(row)
  }

  // 4. Pull existing source_record_ids from bp_readings (paginate past the
  //    1000-row .select() cap — gotcha #10).
  const existingIds = new Set<string>()
  const PAGE_SIZE = 1000
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('bp_readings')
      .select('source_record_id')
      .eq('source_slug', 'withings')
      .range(offset, offset + PAGE_SIZE - 1)

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
    if (data.length < PAGE_SIZE) break
  }

  // 5. Diff
  const missing = planned.filter((r) => !existingIds.has(r.source_record_id))

  // 6. Batch upsert (all-or-nothing per batch — gotcha #11. We've already
  //    filtered invalid rows above so batches should land cleanly.)
  let inserted = 0
  const insertErrors: string[] = []
  for (let i = 0; i < missing.length; i += INSERT_BATCH_SIZE) {
    const batch = missing.slice(i, i + INSERT_BATCH_SIZE)
    const { error } = await supabase
      .from('bp_readings')
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
    withingsReturned: { measureGrps: measureGrps.length },
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
