'use server'

// Labs slice — server actions.
//
//   createLabUploadUrl(filename) — issue a signed Storage upload URL so the
//                                  browser can put the PDF directly into the
//                                  `lab-reports` bucket WITHOUT routing the
//                                  file bytes through a server action (gotcha:
//                                  Next.js server actions cap request bodies
//                                  at 1 MB; Vercel caps full requests at
//                                  ~4.5 MB regardless). The browser never
//                                  sees a Storage anon key — just a one-shot
//                                  token scoped to this path.
//
//   extractFromStorage(path)     — server downloads the just-uploaded PDF
//                                  from Storage, runs the hybrid LLM
//                                  extraction (text-layer-first, vision
//                                  fallback), overlays learned aliases, and
//                                  returns the draft. File stays in Storage
//                                  as the `raw_file_ref` audit trail — no
//                                  double-store, no temp files.
//
//   commitPanel(payload)         — writes lab_panels + lab_values (raw +
//                                  canonical preserved) + ingestion_log AND
//                                  persists new/confirmed raw_marker_name →
//                                  marker_slug pairs into lab_marker_aliases.
//                                  Both writes happen serverside, never auto-
//                                  triggered.

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { extractLabReport } from './_lib/extract'
import { applyAliasesToDraft } from './_lib/apply-aliases'
import { getMarker, toCanonical } from './_lib/markers'
import { fetchRememberedRanges, overlayRangesOnDraft, PATIENT_SEX } from './_lib/ranges'
import type { ExtractionDraft, DraftValue } from './_lib/types'

const STORAGE_BUCKET = 'lab-reports'
const SOURCE_SLUG = 'labs'

async function requireSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorised')
  return user
}

// ─── Signed upload URL (step 1 of the two-step browser → Storage flow) ──

export interface SignedUploadResult {
  ok: true
  /** Storage path (becomes `raw_file_ref` on commit). */
  path: string
  /** One-shot signed-upload token. Client passes this to uploadToSignedUrl. */
  token: string
}
export interface SignedUploadError {
  ok: false
  error: string
}

/**
 * Issue a signed upload URL so the browser uploads the PDF directly to
 * Supabase Storage. The server still controls the path (server-generated
 * date + epoch + safe filename) so the client can't pollute the bucket
 * layout. The token is single-use and scoped to this exact path.
 */
export async function createLabUploadUrl(
  filename: string
): Promise<SignedUploadResult | SignedUploadError> {
  try {
    await requireSession()
    if (!filename || typeof filename !== 'string') {
      return { ok: false, error: 'Filename is required.' }
    }
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return { ok: false, error: 'Only PDF files are accepted.' }
    }
    const today = new Date().toISOString().slice(0, 10)
    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
    const path = `${today}/${Date.now()}-${safeName}`

    const supabase = createServiceClient()
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(path)
    if (error || !data) {
      return {
        ok: false,
        error: `Could not create signed upload URL: ${error?.message ?? 'unknown'}. Is the "${STORAGE_BUCKET}" Storage bucket created?`,
      }
    }
    return { ok: true, path: data.path, token: data.token }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ─── Extract from Storage (step 2) ───────────────────────────────────────

export interface ExtractResult {
  ok: true
  rawFileRef: string
  draft: ExtractionDraft
}
export interface ExtractError {
  ok: false
  error: string
}

/**
 * Pull the just-uploaded PDF back from Storage on the server, then run the
 * existing hybrid extraction. The client passes ONLY the small Storage
 * path string — the file bytes never traverse the server-action body limit.
 */
export async function extractFromStorage(path: string): Promise<ExtractResult | ExtractError> {
  try {
    await requireSession()
    if (!path || typeof path !== 'string') {
      return { ok: false, error: 'Storage path is required.' }
    }
    const supabaseService = createServiceClient()

    // Download the PDF the browser just put into Storage.
    const { data: blob, error: dlErr } = await supabaseService.storage
      .from(STORAGE_BUCKET)
      .download(path)
    if (dlErr || !blob) {
      return { ok: false, error: `Could not read PDF from Storage: ${dlErr?.message ?? 'not found'}` }
    }
    const bytes = Buffer.from(await blob.arrayBuffer())

    // Hybrid extraction (text-layer-first, vision fallback).
    const rawDraft = await extractLabReport(bytes)

    // ─── Deterministic overlays — confirmed knowledge wins over the LLM ──
    //
    // 1. Marker aliases: apply BEFORE looking up remembered ranges so
    //    the slug we look the range up under is the CONFIRMED one (not
    //    the LLM's per-call guess).
    // 2. Remembered standard ranges: for any value whose slug has a
    //    remembered (slug, sex) entry AND the lab didn't print a range,
    //    overlay the remembered range + recompute the flag. This makes
    //    repeated panels for the same marker fully deterministic —
    //    the AI is only consulted on genuinely-new markers.
    const aliasedValues = await applyAliasesToDraft(
      supabaseService,
      rawDraft.values,
      rawDraft.panel.lab_name
    )
    const slugs = aliasedValues
      .map((v) => v.suggested_marker_slug)
      .filter((s): s is string => !!s)
    const remembered = await fetchRememberedRanges(supabaseService, slugs)
    const finalValues = overlayRangesOnDraft(aliasedValues, remembered)

    return {
      ok: true,
      rawFileRef: path,
      draft: { ...rawDraft, values: finalValues },
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
  /** Count of newly-confirmed standard ranges persisted to lab_marker_ref_ranges. */
  rangesLearned: number
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
    //      - ref_source captures the provenance of the stored range
    //        ('reported' / 'standard' / null) so future exports + the
    //        trend-band rendering can be honest about where the range
    //        came from. 'proposed' from the draft becomes 'standard' on
    //        commit — the user confirmed it, so it's no longer a
    //        proposal; it's a confirmed standard for this canonical.
    //    NOTE marker_slug is NOT NULL in the schema; rows without a confirmed
    //    slug land as 'unmapped' so they're trivial to query + re-map later.
    const valueRows = payload.values.map((v) => {
      const slug = v.confirmed_marker_slug?.trim() || 'unmapped'
      const def = slug !== 'unmapped' ? getMarker(slug) : undefined
      const { canonical_value, canonical_unit } =
        slug !== 'unmapped' && v.numeric_value !== null
          ? toCanonical(slug, v.numeric_value, v.unit)
          : { canonical_value: null, canonical_unit: null }
      const refSource: 'reported' | 'standard' | null =
        v.range_source === 'reported'
          ? 'reported'
          : (v.range_source === 'standard' || v.range_source === 'proposed') &&
              (v.ref_low !== null || v.ref_high !== null)
            ? 'standard'
            : null

      // Echo dimensions come in cm OR mm depending on the lab. The value is
      // canonicalised to cm above; canonicalise the REPORTED ref band the
      // same way (via the marker's own convert on the value's unit) so the
      // trend band and the value share one unit (cm). ECHO ONLY — blood ref
      // ranges are left as printed (that unit-mismatch is a separate backlog
      // item, M8). If the unit is unknown the convert returns null and we
      // keep the printed range rather than guessing (gotcha #167).
      let refLow = v.ref_low
      let refHigh = v.ref_high
      let refUnit = v.ref_unit
      if (def?.category === 'echo' && def.convert && def.canonicalUnit && v.unit) {
        const cLow = v.ref_low !== null ? def.convert(v.ref_low, v.unit) : null
        const cHigh = v.ref_high !== null ? def.convert(v.ref_high, v.unit) : null
        const converted = (v.ref_low !== null && cLow !== null) || (v.ref_high !== null && cHigh !== null)
        if (converted) {
          refLow = v.ref_low !== null ? cLow : null
          refHigh = v.ref_high !== null ? cHigh : null
          refUnit = def.canonicalUnit
        }
      }

      return {
        panel_id: panelId,
        marker_slug: slug,
        raw_marker_name: v.raw_marker_name,
        numeric_value: v.numeric_value,
        text_value: v.text_value,
        unit: v.unit,
        canonical_value,
        canonical_unit,
        ref_low: refLow,
        ref_high: refHigh,
        ref_unit: refUnit,
        ref_source: refSource,
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

    // 5. Persist learned standard reference ranges. Any row whose
    //    range_source is 'proposed' OR 'standard' AND has a numeric
    //    low/high becomes a confirmed standard for its canonical
    //    marker_slug at the patient's sex. Same learn-as-you-go pattern
    //    as aliases: `ignoreDuplicates: true` so the FIRST commit's
    //    range wins; subsequent commits don't churn the table. Critical
    //    thresholds (HH/LL) persist alongside when present.
    //    'reported' ranges are NEVER persisted as standards — they're
    //    a specific lab's range for a specific draw, not a population
    //    standard. Only AI-proposed / standard-overlay rows feed this.
    let rangesLearned = 0
    const rangeRows = payload.values
      .filter(
        (v) =>
          v.confirmed_marker_slug &&
          v.confirmed_marker_slug !== 'unmapped' &&
          (v.range_source === 'proposed' || v.range_source === 'standard') &&
          (v.ref_low !== null || v.ref_high !== null)
      )
      .map((v) => ({
        marker_slug: v.confirmed_marker_slug!,
        sex: PATIENT_SEX,
        ref_low: v.ref_low,
        ref_high: v.ref_high,
        ref_unit: v.ref_unit,
        critical_low: v.critical_low,
        critical_high: v.critical_high,
      }))
    if (rangeRows.length > 0) {
      const { error: rangeErr, count } = await supabase
        .from('lab_marker_ref_ranges')
        .upsert(rangeRows, {
          onConflict: 'marker_slug,sex',
          ignoreDuplicates: true,
          count: 'exact',
        })
      if (!rangeErr) rangesLearned = count ?? 0
      // Range-store failure is non-fatal — the panel + values are
      // already written; remembering is a bonus.
    }

    // 6. Close out the ingestion_log row.
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

    return { ok: true, panelId, rowsWritten: valueRows.length, aliasesLearned, rangesLearned }
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
  ref_source: 'reported' | 'standard' | null
  flag: 'H' | 'L' | 'HH' | 'LL' | 'N' | null
}

/** All panels chronologically (newest first) with their values inline. */
export async function fetchAllPanels(): Promise<LabPanelRow[]> {
  await requireSession()
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
    .select('panel_id, marker_slug, raw_marker_name, numeric_value, text_value, unit, canonical_value, canonical_unit, ref_low, ref_high, ref_unit, ref_source, flag')
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
      ref_source: (row as unknown as { ref_source: LabValueRow['ref_source'] }).ref_source ?? null,
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
  ref_source: 'reported' | 'standard' | null
  flag: 'H' | 'L' | 'HH' | 'LL' | 'N' | null
  unit: string
  /**
   * Whether `value` is in canonical or reported units.
   * 'canonical' = converted via markers.ts::toCanonical (the default path).
   * 'reported'  = no canonical conversion exists for this marker (Lp(a),
   *               where mg/dL↔nmol/L is assay-dependent); value is the
   *               raw numeric_value + unit is the reported unit.
   *               Target evaluation must unit-match before comparing.
   */
  valueSource: 'canonical' | 'reported'
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
  await requireSession()
  const supabase = createServiceClient()
  // Pull both canonical_value AND numeric_value. The default path is the
  // canonical value (every cardiac lipid except Lp(a)); for markers whose
  // registry says canonicalUnit===null we fall back to the reported
  // (numeric_value + unit) pair so they stop being silently dropped. This
  // is the smallest fix for the Lp(a) case (mg/dL↔nmol/L is assay-
  // dependent so we never auto-convert) without forking a second reader.
  const { data } = await supabase
    .from('lab_values')
    .select('marker_slug, canonical_value, canonical_unit, numeric_value, unit, ref_low, ref_high, ref_source, flag, panel_id, lab_panels!inner(drawn_at, source_slug)')
    .not('marker_slug', 'eq', 'unmapped')
    .order('marker_slug', { ascending: true })
  if (!data) return []

  // Supabase's nested-select returns the joined table as an array even
  // for an inner one-to-one relationship; pick the first.
  type Row = {
    marker_slug: string
    canonical_value: number | string | null
    canonical_unit: string | null
    numeric_value: number | string | null
    unit: string | null
    ref_low: number | string | null
    ref_high: number | string | null
    ref_source: 'reported' | 'standard' | null
    flag: MarkerTrendPoint['flag']
    lab_panels: { drawn_at: string; source_slug: string } | { drawn_at: string; source_slug: string }[]
  }

  const byMarker = new Map<string, MarkerTrendPoint[]>()
  for (const raw of data as unknown as Row[]) {
    const panelMeta = Array.isArray(raw.lab_panels) ? raw.lab_panels[0] : raw.lab_panels
    if (!panelMeta || panelMeta.source_slug !== SOURCE_SLUG) continue

    const canonical = typeof raw.canonical_value === 'string' ? Number(raw.canonical_value) : raw.canonical_value
    const reported = typeof raw.numeric_value === 'string' ? Number(raw.numeric_value) : raw.numeric_value
    const def = getMarker(raw.marker_slug)

    let value: number | null = null
    let unit = ''
    let valueSource: MarkerTrendPoint['valueSource'] = 'canonical'

    if (canonical !== null && Number.isFinite(canonical)) {
      value = canonical
      unit = raw.canonical_unit ?? raw.unit ?? ''
      valueSource = 'canonical'
    } else if (def && def.canonicalUnit === null && reported !== null && Number.isFinite(reported)) {
      // Registered no-canonical marker (Lp(a)) → fall back to reported.
      value = reported
      unit = raw.unit ?? ''
      valueSource = 'reported'
    } else {
      // Canonical missing + not a no-canonical marker (e.g. a registered
      // marker whose conversion failed because the unit was unknown).
      // Drop silently — the review UI surfaces the unit warning at commit
      // time; we don't want to chart an un-converted value alongside
      // canonical ones and pretend they're comparable.
      continue
    }

    const list = byMarker.get(raw.marker_slug) ?? []
    list.push({
      drawn_at: panelMeta.drawn_at,
      value,
      ref_low: typeof raw.ref_low === 'string' ? Number(raw.ref_low) : raw.ref_low,
      ref_high: typeof raw.ref_high === 'string' ? Number(raw.ref_high) : raw.ref_high,
      ref_source: raw.ref_source ?? null,
      flag: raw.flag,
      unit,
      valueSource,
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
