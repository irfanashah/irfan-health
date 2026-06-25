'use server'

// Labs slice — server actions.
//
//   uploadAndExtract(formData)  — accepts the uploaded PDF, stores it in
//                                 Storage, runs the hybrid LLM extraction,
//                                 applies learned aliases, returns the draft
//                                 + the Storage path. Nothing is committed
//                                 to lab_panels/lab_values here — the user
//                                 confirms the draft in the review UI first.
//
//   commitPanel(payload)        — writes lab_panels + lab_values (raw +
//                                 canonical preserved) + ingestion_log, AND
//                                 persists new/confirmed raw_marker_name →
//                                 marker_slug pairs into lab_marker_aliases.
//                                 Both writes happen serverside, never auto-
//                                 triggered.

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { extractLabReport } from './_lib/extract'
import { applyAliasesToDraft } from './_lib/apply-aliases'
import { getMarker, toCanonical } from './_lib/markers'
import type { ExtractionDraft, DraftValue } from './_lib/types'

const STORAGE_BUCKET = 'lab-reports'
const SOURCE_SLUG = 'labs'

async function requireSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorised')
  return user
}

// ─── Upload + extract ────────────────────────────────────────────────────

export interface ExtractResult {
  ok: true
  rawFileRef: string
  draft: ExtractionDraft
}
export interface ExtractError {
  ok: false
  error: string
}

export async function uploadAndExtract(formData: FormData): Promise<ExtractResult | ExtractError> {
  try {
    await requireSession()
    const file = formData.get('file') as File | null
    if (!file || file.size === 0) return { ok: false, error: 'No file uploaded.' }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return { ok: false, error: 'Only PDF files are accepted.' }
    }
    const bytes = Buffer.from(await file.arrayBuffer())

    // 1. Store raw file in Storage — `raw_file_ref` audit trail.
    // Path: <yyyy-mm-dd>/<epoch-ms>-<safe-filename>.pdf so concurrent
    // uploads on the same day don't collide.
    const supabaseService = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
    const rawFileRef = `${today}/${Date.now()}-${safeName}`

    const uploadResult = await supabaseService.storage
      .from(STORAGE_BUCKET)
      .upload(rawFileRef, bytes, {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (uploadResult.error) {
      return {
        ok: false,
        error: `Storage upload failed: ${uploadResult.error.message}. Is the "${STORAGE_BUCKET}" bucket created?`,
      }
    }

    // 2. Extract via the hybrid path (text-layer-first, vision fallback).
    const rawDraft = await extractLabReport(bytes)

    // 3. Overlay learned aliases — deterministic mappings take precedence
    //    over the LLM's per-call suggestion. The first commit of a new
    //    marker name becomes the alias used by every future report.
    const aliasedValues = await applyAliasesToDraft(
      supabaseService,
      rawDraft.values,
      rawDraft.panel.lab_name
    )

    return {
      ok: true,
      rawFileRef,
      draft: { ...rawDraft, values: aliasedValues },
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ─── Commit panel ─────────────────────────────────────────────────────────

/** What the review UI submits. Mostly the draft shape with user corrections. */
export interface CommitPayload {
  rawFileRef: string | null
  drawnAt: string                   // YYYY-MM-DD (required, user-confirmed)
  labName: string | null
  orderingPhysician: string | null
  notes: string | null
  extractionPath: 'text' | 'vision'
  values: Array<DraftValue & {
    /** The user-confirmed canonical slug (may equal suggested_marker_slug or be edited). */
    confirmed_marker_slug: string | null
  }>
}

export interface CommitResult {
  ok: true
  panelId: string
  rowsWritten: number
  aliasesLearned: number
}
export interface CommitError {
  ok: false
  error: string
}

export async function commitPanel(payload: CommitPayload): Promise<CommitResult | CommitError> {
  try {
    await requireSession()

    if (!payload.drawnAt || !/^\d{4}-\d{2}-\d{2}$/.test(payload.drawnAt)) {
      return { ok: false, error: 'Draw date (YYYY-MM-DD) is required.' }
    }
    if (payload.values.length === 0) {
      return { ok: false, error: 'No marker rows to commit.' }
    }

    const supabase = createServiceClient()

    // 1. Open an ingestion_log row first — links panel + values for audit.
    const { data: logRow, error: logErr } = await supabase
      .from('ingestion_log')
      .insert({
        source_slug: SOURCE_SLUG,
        fetch_window_start: payload.drawnAt,
        fetch_window_end: payload.drawnAt,
        status: 'pending',
        raw_payload: {
          flow: 'manual_upload_review',
          extraction_path: payload.extractionPath,
          raw_file_ref: payload.rawFileRef,
          lab_name: payload.labName,
          ordering_physician: payload.orderingPhysician,
          rows_seen: payload.values.length,
        },
      })
      .select('id')
      .single()
    if (logErr || !logRow) {
      return { ok: false, error: `ingestion_log insert failed: ${logErr?.message ?? 'unknown'}` }
    }
    const logId = (logRow as { id: string }).id

    // 2. Insert the panel.
    const { data: panelRow, error: panelErr } = await supabase
      .from('lab_panels')
      .insert({
        source_slug: SOURCE_SLUG,
        drawn_at: payload.drawnAt,
        lab_name: payload.labName,
        ordering_physician: payload.orderingPhysician,
        notes: payload.notes,
        raw_file_ref: payload.rawFileRef,
        ingestion_log_id: logId,
      })
      .select('id')
      .single()
    if (panelErr || !panelRow) {
      await supabase
        .from('ingestion_log')
        .update({
          status: 'error',
          completed_at: new Date().toISOString(),
          error_detail: `lab_panels insert failed: ${panelErr?.message ?? 'unknown'}`,
        })
        .eq('id', logId)
      return { ok: false, error: `lab_panels insert failed: ${panelErr?.message ?? 'unknown'}` }
    }
    const panelId = (panelRow as { id: string }).id

    // 3. Build + insert lab_values. For each row:
    //      - canonical_value / canonical_unit derived deterministically from
    //        the marker registry when a conversion exists (else null + flag
    //        the unknown unit in the review UI — never guess).
    //      - raw_marker_name + reported unit always preserved verbatim.
    //    NOTE marker_slug is NOT NULL in the schema; rows without a confirmed
    //    slug land as 'unmapped' so they're trivial to query + re-map later.
    const valueRows = payload.values.map((v) => {
      const slug = v.confirmed_marker_slug?.trim() || 'unmapped'
      const { canonical_value, canonical_unit } =
        slug !== 'unmapped' && v.numeric_value !== null
          ? toCanonical(slug, v.numeric_value, v.unit)
          : { canonical_value: null, canonical_unit: null }
      return {
        panel_id: panelId,
        marker_slug: slug,
        raw_marker_name: v.raw_marker_name,
        numeric_value: v.numeric_value,
        text_value: v.text_value,
        unit: v.unit,
        canonical_value,
        canonical_unit,
        ref_low: v.ref_low,
        ref_high: v.ref_high,
        ref_unit: v.ref_unit,
        flag: v.flag,
      }
    })

    const { error: valuesErr } = await supabase.from('lab_values').insert(valueRows)
    if (valuesErr) {
      await supabase
        .from('ingestion_log')
        .update({
          status: 'error',
          completed_at: new Date().toISOString(),
          records_found: payload.values.length,
          records_written: 0,
          error_detail: `lab_values insert failed: ${valuesErr.message}`,
        })
        .eq('id', logId)
      return { ok: false, error: `lab_values insert failed: ${valuesErr.message}` }
    }

    // 4. Persist learned aliases. Each user-confirmed (raw_marker_name →
    //    marker_slug) pair (excluding 'unmapped') is upserted into
    //    lab_marker_aliases. Scope: lab_name on a per-lab row so different
    //    labs can disambiguate the same raw string. ON CONFLICT DO NOTHING
    //    so the first commit wins — re-commits don't churn the table.
    let aliasesLearned = 0
    const aliasRows = payload.values
      .filter((v) => v.confirmed_marker_slug && v.confirmed_marker_slug !== 'unmapped' && v.raw_marker_name)
      .map((v) => ({
        raw_marker_name: v.raw_marker_name,
        lab_name: payload.labName ?? null,
        marker_slug: v.confirmed_marker_slug!,
      }))
    if (aliasRows.length > 0) {
      const { error: aliasErr, count } = await supabase
        .from('lab_marker_aliases')
        .upsert(aliasRows, { onConflict: 'raw_marker_name,lab_name', ignoreDuplicates: true, count: 'exact' })
      if (!aliasErr) aliasesLearned = count ?? 0
      // Alias persistence failure is non-fatal — the panel + values are
      // already written; learning is a bonus, not a blocker.
    }

    // 5. Close out the ingestion_log row.
    await supabase
      .from('ingestion_log')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        records_found: payload.values.length,
        records_written: payload.values.length,
        records_skipped: 0,
      })
      .eq('id', logId)

    return { ok: true, panelId, rowsWritten: valueRows.length, aliasesLearned }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ─── Read: panels + key-marker trends for /labs page ──────────────────────

export interface LabPanelRow {
  id: string
  drawn_at: string
  lab_name: string | null
  ordering_physician: string | null
  notes: string | null
  raw_file_ref: string | null
  created_at: string
  values: LabValueRow[]
}

export interface LabValueRow {
  marker_slug: string
  raw_marker_name: string
  numeric_value: number | null
  text_value: string | null
  unit: string | null
  canonical_value: number | null
  canonical_unit: string | null
  ref_low: number | null
  ref_high: number | null
  ref_unit: string | null
  flag: 'H' | 'L' | 'HH' | 'LL' | 'N' | null
}

/** All panels chronologically (newest first) with their values inline. */
export async function fetchAllPanels(): Promise<LabPanelRow[]> {
  const supabase = createServiceClient()
  const { data: panels } = await supabase
    .from('lab_panels')
    .select('id, drawn_at, lab_name, ordering_physician, notes, raw_file_ref, created_at')
    .eq('source_slug', SOURCE_SLUG)
    .order('drawn_at', { ascending: false })
  if (!panels) return []
  const panelIds = panels.map((p) => (p as { id: string }).id)
  if (panelIds.length === 0) return []
  const { data: values } = await supabase
    .from('lab_values')
    .select('panel_id, marker_slug, raw_marker_name, numeric_value, text_value, unit, canonical_value, canonical_unit, ref_low, ref_high, ref_unit, flag')
    .in('panel_id', panelIds)
  const byPanel = new Map<string, LabValueRow[]>()
  for (const raw of (values ?? [])) {
    const row = raw as LabValueRow & { panel_id: string }
    const list = byPanel.get(row.panel_id) ?? []
    list.push({
      marker_slug: row.marker_slug,
      raw_marker_name: row.raw_marker_name,
      numeric_value: typeof row.numeric_value === 'string' ? Number(row.numeric_value) : row.numeric_value,
      text_value: row.text_value,
      unit: row.unit,
      canonical_value: typeof row.canonical_value === 'string' ? Number(row.canonical_value) : row.canonical_value,
      canonical_unit: row.canonical_unit,
      ref_low: typeof row.ref_low === 'string' ? Number(row.ref_low) : row.ref_low,
      ref_high: typeof row.ref_high === 'string' ? Number(row.ref_high) : row.ref_high,
      ref_unit: row.ref_unit,
      flag: row.flag,
    })
    byPanel.set(row.panel_id, list)
  }
  return (panels as Array<{ id: string } & Omit<LabPanelRow, 'values'>>).map((p) => ({
    ...p,
    values: byPanel.get(p.id) ?? [],
  }))
}

export interface MarkerTrendPoint {
  drawn_at: string
  value: number
  ref_low: number | null
  ref_high: number | null
  flag: 'H' | 'L' | 'HH' | 'LL' | 'N' | null
  unit: string
}

export interface MarkerTrend {
  marker_slug: string
  display: string
  canonical_unit: string | null
  points: MarkerTrendPoint[]
}

/**
 * For every marker that has ≥1 canonical reading across all panels,
 * return the trend points keyed by marker_slug (chronological).
 * The /labs page filters this list for key markers + the picker dropdown.
 */
export async function fetchAllMarkerTrends(): Promise<MarkerTrend[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('lab_values')
    .select('marker_slug, canonical_value, canonical_unit, unit, ref_low, ref_high, flag, panel_id, lab_panels!inner(drawn_at, source_slug)')
    .not('marker_slug', 'eq', 'unmapped')
    .not('canonical_value', 'is', null)
    .order('marker_slug', { ascending: true })
  if (!data) return []

  // Supabase's nested-select returns the joined table as an array even
  // for an inner one-to-one relationship; pick the first.
  type Row = {
    marker_slug: string
    canonical_value: number | string | null
    canonical_unit: string | null
    unit: string | null
    ref_low: number | string | null
    ref_high: number | string | null
    flag: MarkerTrendPoint['flag']
    lab_panels: { drawn_at: string; source_slug: string } | { drawn_at: string; source_slug: string }[]
  }

  const byMarker = new Map<string, MarkerTrendPoint[]>()
  for (const raw of data as unknown as Row[]) {
    const panelMeta = Array.isArray(raw.lab_panels) ? raw.lab_panels[0] : raw.lab_panels
    if (!panelMeta || panelMeta.source_slug !== SOURCE_SLUG) continue
    const v = typeof raw.canonical_value === 'string' ? Number(raw.canonical_value) : raw.canonical_value
    if (v === null || !Number.isFinite(v)) continue
    const list = byMarker.get(raw.marker_slug) ?? []
    list.push({
      drawn_at: panelMeta.drawn_at,
      value: v,
      ref_low: typeof raw.ref_low === 'string' ? Number(raw.ref_low) : raw.ref_low,
      ref_high: typeof raw.ref_high === 'string' ? Number(raw.ref_high) : raw.ref_high,
      flag: raw.flag,
      unit: raw.canonical_unit ?? raw.unit ?? '',
    })
    byMarker.set(raw.marker_slug, list)
  }

  const out: MarkerTrend[] = []
  for (const [slug, points] of byMarker) {
    const def = getMarker(slug)
    points.sort((a, b) => a.drawn_at.localeCompare(b.drawn_at))
    out.push({
      marker_slug: slug,
      display: def?.display ?? slug,
      canonical_unit: def?.canonicalUnit ?? null,
      points,
    })
  }
  return out
}
