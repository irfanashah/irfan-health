import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  downloadFile,
  listFolderChildren,
  moveFile,
  resolveRootStructure,
  type DriveFile,
  type SourceFolders,
} from '@/lib/google-drive'
import { FILE_DROP_PARSERS, FILE_DROP_SOURCE_SLUGS } from '@/adapters/file-drop/registry'
import type { FileDropParser, ObservationRow } from '@/adapters/file-drop/types'

export const runtime = 'nodejs'
export const maxDuration = 800

// Batch upsert is all-or-nothing per call (gotcha #11). Slice 4 v1 writes
// only 2 rows per Oxylink file so this is forward-looking, but the pattern
// MUST hold for future parsers that emit more rows per file (Labs PDF will).
const UPSERT_BATCH_SIZE = 200

interface PerFileResult {
  source: string
  file: { id: string; name: string }
  status: 'success' | 'error'
  records_found: number
  records_written: number
  records_skipped: number
  ingestion_log_id: string | null
  reason?: string
  moved_to: 'processed' | 'failed' | null
}

interface PerSourceResult {
  source: string
  configured: boolean
  files_seen: number
  results: PerFileResult[]
}

interface CronResult {
  status: 'success' | 'partial' | 'error'
  root_id: string
  per_source: PerSourceResult[]
  elapsed_ms: number
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Bearer-token auth — Vercel cron sends Authorization: Bearer ${CRON_SECRET}.
  const auth = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!auth || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const rootId = process.env.GDRIVE_ROOT_FOLDER_ID
  if (!rootId) {
    return NextResponse.json(
      { error: 'GDRIVE_ROOT_FOLDER_ID env var not set' },
      { status: 500 }
    )
  }

  // ?probe=1 — diagnostic mode. Dumps what the service account actually sees
  // under the root + inbox so we can debug "configured:false" without guessing
  // at folder names. Short-circuits before any processing.
  const url = new URL(request.url)
  if (url.searchParams.get('probe') === '1') {
    return await probeDriveStructure(rootId)
  }

  const startedAt = Date.now()
  const supabase = createServiceClient()

  // Resolve subfolder ids once for this cron invocation (decision #1).
  let structure
  try {
    structure = await resolveRootStructure(rootId, FILE_DROP_SOURCE_SLUGS)
  } catch (err) {
    return NextResponse.json(
      { error: `Drive root structure resolution failed: ${(err as Error).message}` },
      { status: 502 }
    )
  }

  const perSource: PerSourceResult[] = []
  let anyError = false
  let anySuccess = false

  for (const sourceSlug of FILE_DROP_SOURCE_SLUGS) {
    const folders = structure.bySource[sourceSlug]
    if (!folders) {
      // Source's inbox subfolder doesn't exist yet — skip silently. This
      // covers the deferred Contour/Labs case (registry empty for them
      // for now anyway, but defensive).
      perSource.push({ source: sourceSlug, configured: false, files_seen: 0, results: [] })
      continue
    }

    const parser = FILE_DROP_PARSERS[sourceSlug]
    const results = await processSourceInbox(supabase, parser, folders)
    perSource.push({
      source: sourceSlug,
      configured: true,
      files_seen: results.length,
      results,
    })
    for (const r of results) {
      if (r.status === 'success') anySuccess = true
      else anyError = true
    }
  }

  const status: CronResult['status'] =
    anyError && anySuccess ? 'partial' : anyError ? 'error' : 'success'

  const payload: CronResult = {
    status,
    root_id: rootId,
    per_source: perSource,
    elapsed_ms: Date.now() - startedAt,
  }

  return NextResponse.json(payload, {
    // 'error' is a hard failure (no files succeeded); 'partial' still 200
    // because some succeeded — diagnostics surface the failed ones.
    status: status === 'error' ? 500 : 200,
  })
}

// ─── Per-source processing ─────────────────────────────────────────────────

async function processSourceInbox(
  supabase: ReturnType<typeof createServiceClient>,
  parser: FileDropParser,
  folders: SourceFolders
): Promise<PerFileResult[]> {
  let files: DriveFile[]
  try {
    files = await listFolderChildren(folders.inbox, { mimeFilter: 'file' })
  } catch (err) {
    // Drive-side listing failure — log one ingestion_log row at the source
    // level and bail. No files were moved.
    const logId = await writeFailureLog(supabase, parser.sourceSlug, {
      filename: '(listing failed)',
      drive_file_id: null,
      reason: `inbox listing failed: ${(err as Error).message}`,
    })
    return [{
      source: parser.sourceSlug,
      file: { id: '', name: '(listing failed)' },
      status: 'error',
      records_found: 0,
      records_written: 0,
      records_skipped: 0,
      ingestion_log_id: logId,
      reason: (err as Error).message,
      moved_to: null,
    }]
  }

  // Missing/empty inbox = non-event. Write one ingestion_log row at
  // status='success', records_found=0 for the run, per the spec.
  if (files.length === 0) {
    const logId = await writeNoopLog(supabase, parser.sourceSlug)
    return [{
      source: parser.sourceSlug,
      file: { id: '', name: '(empty inbox)' },
      status: 'success',
      records_found: 0,
      records_written: 0,
      records_skipped: 0,
      ingestion_log_id: logId,
      moved_to: null,
    }]
  }

  const results: PerFileResult[] = []
  for (const file of files) {
    results.push(await processOneFile(supabase, parser, folders, file))
  }
  return results
}

async function processOneFile(
  supabase: ReturnType<typeof createServiceClient>,
  parser: FileDropParser,
  folders: SourceFolders,
  file: DriveFile
): Promise<PerFileResult> {
  // 1. Download.
  let bytes: Buffer
  try {
    bytes = await downloadFile(file.id)
  } catch (err) {
    return await failFile(supabase, parser, folders, file, null, `download failed: ${(err as Error).message}`)
  }

  // 2. Validate header — cheap reject of misfiled files (decision #8).
  if (!parser.validate(bytes)) {
    return await failFile(supabase, parser, folders, file, null, 'content validation failed (header signature mismatch)')
  }

  // 3. Parse.
  const result = parser.parse(bytes, { name: file.name, driveFileId: file.id })
  if (result.kind === 'fail') {
    return await failFile(supabase, parser, folders, file, result.summary ?? null, result.reason)
  }
  const { rows, summary } = result

  // 4. Open ingestion_log row (one per file). Use period_start/end as the
  //    fetch window so a future daily_metrics-style query can find these.
  //    Direct insert (not createIngestionLog) because we want raw_payload
  //    populated from the start with file metadata + skip breakdown.
  const { data: logRow, error: logErr } = await supabase
    .from('ingestion_log')
    .insert({
      source_slug: parser.sourceSlug,
      fetch_window_start: summary.period_start,
      fetch_window_end: summary.period_end,
      status: 'pending',
      raw_payload: {
        filename: file.name,
        drive_file_id: file.id,
        parser: parser.sourceSlug,
        skip_breakdown: summary.skip_breakdown,
        rows_seen: summary.rows_seen,
        rows_valid: summary.rows_valid,
        ...summary.meta,
      },
    })
    .select('id')
    .single()

  if (logErr || !logRow) {
    return await failFile(
      supabase, parser, folders, file, summary,
      `ingestion_log insert failed: ${logErr?.message ?? 'unknown'}`
    )
  }
  const logId = (logRow as { id: string }).id

  // 5. Stamp ingestion_log_id on each row.
  const stamped = rows.map((r) => ({ ...r, ingestion_log_id: logId }))

  // 6. Batch upsert. All-or-nothing per call (gotcha #11) — rows are already
  //    validated by the parser, so batches should land cleanly.
  let written = 0
  const upsertErrors: string[] = []
  for (let i = 0; i < stamped.length; i += UPSERT_BATCH_SIZE) {
    const batch = stamped.slice(i, i + UPSERT_BATCH_SIZE)
    const { error } = await supabase
      .from('health_observations')
      .upsert(batch, { onConflict: 'source_slug,source_record_id' })
    if (error) {
      upsertErrors.push(`batch ${i}-${i + batch.length}: ${error.message}`)
    } else {
      written += batch.length
    }
  }

  if (upsertErrors.length > 0) {
    // Update log to 'error' and move to failed/ so the file isn't lost.
    await supabase
      .from('ingestion_log')
      .update({
        status: 'error',
        records_found: summary.rows_valid,
        records_written: written,
        records_skipped: summary.skip_breakdown.sentinel
          + summary.skip_breakdown.out_of_range
          + summary.skip_breakdown.parse_errors,
        error_detail: upsertErrors.join(' | ').slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', logId)
    const moved = await tryMove(file.id, folders.inbox, folders.failed)
    return {
      source: parser.sourceSlug,
      file: { id: file.id, name: file.name },
      status: 'error',
      records_found: summary.rows_valid,
      records_written: written,
      records_skipped: summary.skip_breakdown.sentinel + summary.skip_breakdown.out_of_range + summary.skip_breakdown.parse_errors,
      ingestion_log_id: logId,
      reason: upsertErrors.join(' | '),
      moved_to: moved ? 'failed' : null,
    }
  }

  // 7. Success — finalise log + move to processed/.
  const skipped = summary.skip_breakdown.sentinel + summary.skip_breakdown.out_of_range + summary.skip_breakdown.parse_errors
  await supabase
    .from('ingestion_log')
    .update({
      status: 'success',
      records_found: summary.rows_valid,
      records_written: written,
      records_skipped: skipped,
      completed_at: new Date().toISOString(),
    })
    .eq('id', logId)

  const moved = await tryMove(file.id, folders.inbox, folders.processed)

  return {
    source: parser.sourceSlug,
    file: { id: file.id, name: file.name },
    status: 'success',
    records_found: summary.rows_valid,
    records_written: written,
    records_skipped: skipped,
    ingestion_log_id: logId,
    moved_to: moved ? 'processed' : null,
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function tryMove(fileId: string, from: string, to: string): Promise<boolean> {
  try {
    await moveFile(fileId, from, to)
    return true
  } catch (err) {
    // Move failure is logged but doesn't downgrade the ingest verdict.
    // The next cron run will see the file in inbox again; idempotent
    // upsert dedupes the rows, but the diagnostic log row will accumulate.
    // Worth surfacing in /diagnostics as a known caveat.
    console.error('[file-drop] moveFile failed:', (err as Error).message, { fileId, from, to })
    return false
  }
}

async function failFile(
  supabase: ReturnType<typeof createServiceClient>,
  parser: FileDropParser,
  folders: SourceFolders,
  file: DriveFile,
  summary: { period_start?: string; period_end?: string; skip_breakdown?: { sentinel: number; out_of_range: number; parse_errors: number } } | null,
  reason: string
): Promise<PerFileResult> {
  const logId = await writeFailureLog(supabase, parser.sourceSlug, {
    filename: file.name,
    drive_file_id: file.id,
    reason,
    summary,
  })
  const moved = await tryMove(file.id, folders.inbox, folders.failed)
  return {
    source: parser.sourceSlug,
    file: { id: file.id, name: file.name },
    status: 'error',
    records_found: 0,
    records_written: 0,
    records_skipped: 0,
    ingestion_log_id: logId,
    reason,
    moved_to: moved ? 'failed' : null,
  }
}

async function writeFailureLog(
  supabase: ReturnType<typeof createServiceClient>,
  sourceSlug: string,
  payload: { filename: string; drive_file_id: string | null; reason: string; summary?: unknown }
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .insert({
      source_slug: sourceSlug,
      status: 'error',
      records_found: 0,
      records_written: 0,
      records_skipped: 0,
      error_detail: payload.reason.slice(0, 500),
      raw_payload: payload,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[file-drop] writeFailureLog failed:', error?.message)
    return null
  }
  return (data as { id: string }).id
}

async function writeNoopLog(
  supabase: ReturnType<typeof createServiceClient>,
  sourceSlug: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .insert({
      source_slug: sourceSlug,
      status: 'success',
      records_found: 0,
      records_written: 0,
      records_skipped: 0,
      raw_payload: { note: 'empty inbox — no-op' },
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[file-drop] writeNoopLog failed:', error?.message)
    return null
  }
  return (data as { id: string }).id
}

// Silence unused-import warning when /api/* runs through tsc without full lints.
void ([] as ObservationRow[])

// ─── Probe (?probe=1) ──────────────────────────────────────────────────────
//
// Lists everything the service account can see under the root + the inbox
// subfolders. Used to debug "configured:false" by showing literal folder
// names (catches invisible characters, casing, duplicate folders) without
// guessing.

async function probeDriveStructure(rootId: string): Promise<NextResponse> {
  const out: {
    root_id: string
    root_children: { folders: Array<{ id: string; name: string; nameBytes: number[] }>; files: Array<{ id: string; name: string }> }
    inbox_children: { folders: Array<{ id: string; name: string; nameBytes: number[] }>; files: Array<{ id: string; name: string }> } | null
    source_lookups: Array<{ slug: string; sourceFolder: string; found_id: string | null }>
    error?: string
  } = {
    root_id: rootId,
    root_children: { folders: [], files: [] },
    inbox_children: null,
    source_lookups: [],
  }

  try {
    const rootFolders = await listFolderChildren(rootId, { mimeFilter: 'folder' })
    const rootFiles = await listFolderChildren(rootId, { mimeFilter: 'file' })
    out.root_children.folders = rootFolders.map((f) => ({ id: f.id, name: f.name, nameBytes: nameToBytes(f.name) }))
    out.root_children.files = rootFiles.map((f) => ({ id: f.id, name: f.name }))

    // ALL inbox candidates (including any duplicates).
    const inboxCandidates = rootFolders.filter((f) => f.name === 'inbox')
    if (inboxCandidates.length === 0) {
      out.error = `No folder literally named 'inbox' under root. Check root_children.folders for what's actually there.`
      return NextResponse.json(out, { status: 200 })
    }
    if (inboxCandidates.length > 1) {
      out.error = `Multiple folders named 'inbox' under root (${inboxCandidates.length}) — the cron picks one at random. Delete the dupes.`
    }

    // Probe each inbox candidate's children (just take the first for the
    // primary view; if there are dupes the error above flags it).
    const inboxId = inboxCandidates[0].id
    const inboxFolders = await listFolderChildren(inboxId, { mimeFilter: 'folder' })
    const inboxFiles = await listFolderChildren(inboxId, { mimeFilter: 'file' })
    out.inbox_children = {
      folders: inboxFolders.map((f) => ({ id: f.id, name: f.name, nameBytes: nameToBytes(f.name) })),
      files: inboxFiles.map((f) => ({ id: f.id, name: f.name })),
    }

    // What does the same name-match the cron uses return for each parser?
    for (const slug of FILE_DROP_SOURCE_SLUGS) {
      const parser = FILE_DROP_PARSERS[slug]
      const match = inboxFolders.find((f) => f.name === parser.sourceFolder)
      out.source_lookups.push({
        slug,
        sourceFolder: parser.sourceFolder,
        found_id: match?.id ?? null,
      })
    }
  } catch (err) {
    out.error = `probe failed: ${(err as Error).message}`
  }

  return NextResponse.json(out, { status: 200 })
}

/** Render each character of a name as its codepoint, so invisible chars surface. */
function nameToBytes(name: string): number[] {
  const out: number[] = []
  for (const ch of name) out.push(ch.codePointAt(0)!)
  return out
}
