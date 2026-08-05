'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Upload } from 'lucide-react'
import {
  createLabUploadUrl,
  extractFromStorage,
  commitPanel,
  type CommitPayload,
} from './actions'
import type { ExtractionDraft, DraftValue } from './_lib/types'
import { ALL_MARKER_SLUGS, getMarker } from './_lib/markers'
import { bestSuggestedSlug, similarExistingSlugs } from './_lib/slug-suggest'
import { computeFlag } from './_lib/ranges'
import { createClient as createBrowserSupabase } from '@/lib/supabase/client'

/** Hard client-side cap. Mirrors the bucket's 25 MB limit. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

interface ReviewRow extends DraftValue {
  /** User-confirmed canonical slug. May be a new slug (auto-create) or merged with an existing one. */
  confirmed_marker_slug: string | null
  /** Suggested merge candidates — existing slugs similar to the suggested/proposed one. */
  merge_candidates: string[]
  /** Per-row UI warning text: shown as a small note, doesn't block commit. */
  ui_flag: string | null
}

// Surface a warning when the row has no slug, no value, an unknown
// unit, or the LLM left a note. The user can still commit —
// the warning is a nudge, not a block. Critical states are handled
// via the flag dropdown + value highlight.
function rowWarning(r: ReviewRow): string | null {
  const notes: string[] = []
  if (!r.confirmed_marker_slug || r.confirmed_marker_slug === 'unmapped') notes.push('unmapped marker')
  if (r.numeric_value === null && !r.text_value) notes.push('no value')
  if (r.notes) notes.push(r.notes)
  if (r.confirmed_marker_slug && r.confirmed_marker_slug !== 'unmapped' && r.unit) {
    const def = getMarker(r.confirmed_marker_slug)
    if (def?.canonicalUnit && def.convert) {
      const canonical_value = def.convert(r.numeric_value ?? 0, r.unit)
      if (r.numeric_value !== null && canonical_value === null) notes.push(`unit "${r.unit}" not converted`)
    }
  }
  return notes.length ? notes.join(' · ') : null
}

function makeReviewRow(v: DraftValue): ReviewRow {
  // Auto-suggest a non-empty slug for every row. The LLM's suggestion
  // wins when present; else a code-side slugified raw name. 'unmapped'
  // only ever appears if the user explicitly clears the dropdown.
  const suggested = bestSuggestedSlug(v.raw_marker_name, v.suggested_marker_slug)
  const base: ReviewRow = {
    ...v,
    confirmed_marker_slug: suggested,
    merge_candidates: similarExistingSlugs(suggested),
    ui_flag: null,
  }
  base.ui_flag = rowWarning(base)
  return base
}

/**
 * Re-compute the flag from the current row state (value + final range +
 * critical thresholds). Honours an explicit lab flag if it's already
 * set as `H`/`L`/etc; recomputes when null/N.
 */
function recomputeRowFlag(r: ReviewRow): ReviewRow['flag'] {
  return computeFlag({
    value: r.numeric_value,
    refLow: r.ref_low,
    refHigh: r.ref_high,
    criticalLow: r.critical_low,
    criticalHigh: r.critical_high,
    labFlag: r.range_source === 'reported' ? r.flag : null,
  })
}

/**
 * Returns the load-bearing context for a critical flag — the threshold
 * that was crossed and the row's display label. Used by the review UI
 * to render the loud "PANIC — confirm" callout on HH/LL rows so a
 * critical flag is NEVER set silently. Null for non-critical rows
 * (common case stays compact).
 *
 * For a critical flag from a lab-printed source (r.range_source ===
 * 'reported' and r.flag === 'HH'/'LL'), we may not have an explicit
 * critical_low/high on the draft — the LLM just lifted the lab's flag.
 * The callout still surfaces ("lab-printed panic") and the user
 * confirms by leaving it.
 */
function criticalContext(r: ReviewRow): {
  kind: 'HH' | 'LL'
  thresholdLabel: string
  source: 'lab' | 'computed'
} | null {
  if (r.flag !== 'HH' && r.flag !== 'LL') return null
  const labPrinted = r.range_source === 'reported'
  if (r.flag === 'HH') {
    const t = r.critical_high
    return {
      kind: 'HH',
      thresholdLabel: t !== null
        ? `crosses critical high ${t}${r.ref_unit ? ' ' + r.ref_unit : ''}`
        : 'lab-printed critical high',
      source: labPrinted ? 'lab' : 'computed',
    }
  }
  const t = r.critical_low
  return {
    kind: 'LL',
    thresholdLabel: t !== null
      ? `crosses critical low ${t}${r.ref_unit ? ' ' + r.ref_unit : ''}`
      : 'lab-printed critical low',
    source: labPrinted ? 'lab' : 'computed',
  }
}

export function LabsClient() {
  const router = useRouter()
  const [busy, startTransition] = useTransition()

  // Upload + extract state
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExtractionDraft | null>(null)
  const [rawFileRef, setRawFileRef] = useState<string | null>(null)

  // Review state — initialised from the draft, edited inline.
  const [drawnAt, setDrawnAt] = useState('')
  const [labName, setLabName] = useState('')
  const [orderingPhysician, setOrderingPhysician] = useState('')
  const [panelNotes, setPanelNotes] = useState('')
  const [rows, setRows] = useState<ReviewRow[]>([])

  // Commit state
  const [commitError, setCommitError] = useState<string | null>(null)
  const [commitOk, setCommitOk] = useState<{ rowsWritten: number; aliasesLearned: number; rangesLearned: number } | null>(null)

  // Clear only the draft/review fields — NOT the commit status. After a
  // successful commit we clear the draft (so the review UI collapses) but
  // must KEEP `commitOk` so the success banner renders (L8) — the banner's
  // condition is `commitOk && !draft`, so nulling commitOk in the same
  // state batch that nulls draft made a successful commit look silent and
  // invited a duplicate re-upload (which feeds M14).
  function clearDraftFields() {
    setDraft(null)
    setRawFileRef(null)
    setDrawnAt('')
    setLabName('')
    setOrderingPhysician('')
    setPanelNotes('')
    setRows([])
  }

  // Full reset — draft fields AND status. Used by Discard and at the start
  // of a new upload, where a stale success/error banner should clear.
  function resetDraft() {
    clearDraftFields()
    setCommitOk(null)
    setCommitError(null)
  }

  // Two-step upload:
  //   1. Ask the server for a signed upload URL (small request — no file bytes).
  //   2. Upload the PDF DIRECTLY to Supabase Storage from the browser
  //      (bypasses the 1 MB Next.js server-action limit AND the ~4.5 MB
  //      Vercel request ceiling).
  //   3. Tell the server "this path is now in Storage; extract it" → the
  //      server downloads it back, runs the hybrid extraction, returns
  //      the draft. The Storage object stays — it IS the raw_file_ref
  //      audit trail.
  async function onUpload(file: File | null) {
    setUploadError(null)
    setCommitOk(null)
    setCommitError(null)
    if (!file || file.size === 0) {
      setUploadError('No file selected.')
      return
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are accepted.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max 25 MB.`)
      return
    }
    startTransition(async () => {
      // Step 1: signed URL
      const urlRes = await createLabUploadUrl(file.name)
      if (!urlRes.ok) {
        setUploadError(urlRes.error)
        return
      }
      // Step 2: browser → Storage direct upload
      try {
        const supabase = createBrowserSupabase()
        const { error: upErr } = await supabase.storage
          .from('lab-reports')
          .uploadToSignedUrl(urlRes.path, urlRes.token, file, {
            contentType: 'application/pdf',
            upsert: false,
          })
        if (upErr) {
          setUploadError(`Storage upload failed: ${upErr.message}`)
          return
        }
      } catch (err) {
        setUploadError(`Storage upload failed: ${(err as Error).message}`)
        return
      }
      // Step 3: server-side extract
      const res = await extractFromStorage(urlRes.path)
      if (!res.ok) {
        setUploadError(res.error)
        return
      }
      // Build the review draft from the extracted payload. Guard the shape
      // and wrap in try/catch: a malformed draft (missing panel/values, an
      // unexpected row shape) must surface as a legible inline error, NOT
      // throw out of this transition — an uncaught throw here propagates to
      // the app error boundary and blanks the whole page (gotcha #161).
      try {
        const draft = res.draft
        const panel = draft?.panel ?? {}
        const values = Array.isArray(draft?.values) ? draft.values : []
        setDraft(draft)
        setRawFileRef(res.rawFileRef)
        setDrawnAt(panel.drawn_at ?? '')
        setLabName(panel.lab_name ?? '')
        setOrderingPhysician(panel.ordering_physician ?? '')
        setPanelNotes(
          [
            panel.notes,
            draft?.dateAmbiguous ? 'ambiguous date — confirm above' : null,
          ].filter(Boolean).join(' · ')
        )
        setRows(values.map(makeReviewRow))
      } catch (err) {
        setUploadError(
          `Extraction succeeded but the draft could not be displayed: ${(err as Error).message}. ` +
          `The PDF is saved — please report this so it can be fixed.`
        )
      }
    })
  }

  function updateRow(i: number, patch: Partial<ReviewRow>) {
    setRows((prev) => {
      const next = prev.slice()
      const merged: ReviewRow = { ...next[i], ...patch }
      // If the user changed a range / value / critical field, recompute
      // the flag (unless they explicitly picked one — patch.flag wins).
      const flagFieldsChanged =
        'numeric_value' in patch ||
        'ref_low' in patch ||
        'ref_high' in patch ||
        'critical_low' in patch ||
        'critical_high' in patch
      if (flagFieldsChanged && !('flag' in patch)) {
        merged.flag = recomputeRowFlag(merged)
      }
      // If the slug changed, refresh the merge-candidates list.
      if ('confirmed_marker_slug' in patch && merged.confirmed_marker_slug) {
        merged.merge_candidates = similarExistingSlugs(merged.confirmed_marker_slug)
      }
      merged.ui_flag = rowWarning(merged)
      next[i] = merged
      return next
    })
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function onCommit() {
    if (!draft || rows.length === 0) return
    setCommitError(null)
    setCommitOk(null)
    const payload: CommitPayload = {
      rawFileRef,
      drawnAt,
      labName: labName.trim() || null,
      orderingPhysician: orderingPhysician.trim() || null,
      notes: panelNotes.trim() || null,
      extractionPath: draft.path,
      values: rows.map((r) => ({
        raw_marker_name: r.raw_marker_name,
        numeric_value: r.numeric_value,
        text_value: r.text_value,
        unit: r.unit,
        ref_low: r.ref_low,
        ref_high: r.ref_high,
        ref_unit: r.ref_unit,
        ref_text: r.ref_text,
        range_source: r.range_source,
        critical_low: r.critical_low,
        critical_high: r.critical_high,
        flag: r.flag,
        suggested_marker_slug: r.suggested_marker_slug,
        notes: r.notes,
        confirmed_marker_slug: r.confirmed_marker_slug,
      })),
    }
    startTransition(async () => {
      const res = await commitPanel(payload)
      if (!res.ok) {
        setCommitError(res.error)
        return
      }
      setCommitError(null)
      setCommitOk({
        rowsWritten: res.rowsWritten,
        aliasesLearned: res.aliasesLearned,
        rangesLearned: res.rangesLearned,
      })
      // Collapse the review UI but KEEP commitOk so the success banner
      // shows (L8). commitOk clears on the next upload (onUpload nulls it)
      // or Discard. router.refresh() re-fetches server data without
      // remounting this client component, so the banner survives it.
      clearDraftFields()
      router.refresh()
    })
  }

  const flaggedCount = useMemo(() => rows.filter((r) => r.ui_flag).length, [rows])
  const criticalCount = useMemo(
    () => rows.filter((r) => r.flag === 'HH' || r.flag === 'LL').length,
    [rows]
  )

  return (
    <div className="labs-container">
      {/* ─── Upload ──────────────────────────────────────────────────── */}
      <section className="labs-card">
        <h2 className="labs-section-title">
          <Upload size={16} /> Upload a lab report
        </h2>
        <p className="labs-section-sub">
          PDF only. Sent to Anthropic for structuring; nothing is written until you review and confirm below.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const file = fd.get('file') as File | null
            onUpload(file)
          }}
          className="labs-upload-form"
        >
          <input
            type="file"
            name="file"
            accept="application/pdf,.pdf"
            required
            disabled={busy}
            className="labs-file-input"
          />
          <button type="submit" disabled={busy} className="labs-btn labs-btn-primary">
            {busy && !draft ? 'Uploading + extracting…' : 'Upload + extract'}
          </button>
        </form>
        {uploadError && (
          <div className="labs-error">
            <AlertCircle size={14} /> {uploadError}
          </div>
        )}
      </section>

      {/* ─── Review draft ────────────────────────────────────────────── */}
      {draft && (
        <section className="labs-card">
          <div className="labs-review-head">
            <h2 className="labs-section-title">
              <FileText size={16} /> Review draft
              <span className={`labs-path-tag labs-path-${draft.path}`}>
                {draft.path === 'text' ? 'text layer' : 'vision'}
              </span>
            </h2>
            <button
              type="button"
              onClick={resetDraft}
              className="labs-btn labs-btn-secondary"
              disabled={busy}
            >
              Discard
            </button>
          </div>
          {draft.path === 'vision' && (
            <div className="labs-warn">
              <AlertCircle size={14} /> Vision extraction — digits transcribed from pixels. Double-check every value.
            </div>
          )}
          {draft.extractionNote && (
            <div className="labs-info"><AlertCircle size={14} /> {draft.extractionNote}</div>
          )}

          {/* Panel-level fields */}
          <div className="labs-panel-fields">
            <label>
              <span>Drawn at *</span>
              <input
                type="date"
                value={drawnAt}
                onChange={(e) => setDrawnAt(e.target.value)}
                required
              />
            </label>
            <label>
              <span>Lab</span>
              <input
                type="text"
                value={labName}
                onChange={(e) => setLabName(e.target.value)}
                placeholder="Fakeeh University Hospital"
              />
            </label>
            <label>
              <span>Ordering physician</span>
              <input
                type="text"
                value={orderingPhysician}
                onChange={(e) => setOrderingPhysician(e.target.value)}
                placeholder="Dr. Fekry Eldeeb"
              />
            </label>
            <label className="labs-full">
              <span>Notes</span>
              <input
                type="text"
                value={panelNotes}
                onChange={(e) => setPanelNotes(e.target.value)}
              />
            </label>
          </div>

          {/* Critical-flag banner — HH/LL are the highest-stakes flag
              on the platform; for cardiac patients K/Na/glucose at panic
              values is an arrhythmia-risk signal, not a cosmetic badge.
              Surface a top-of-review count + "confirm each one
              explicitly" instruction so a panic flag is never buried
              in a 30-row panel. Common case (zero critical) hides this. */}
          {criticalCount > 0 && (
            <div className="labs-critical-banner">
              <AlertCircle size={16} />
              <span>
                <strong>{criticalCount} critical flag{criticalCount === 1 ? '' : 's'}</strong>{' '}
                ({criticalCount === 1 ? 'HH or LL' : 'HH/LL'}) — review each row below; commit confirms.
              </span>
            </div>
          )}

          {/* Marker table */}
          <div className="labs-table-wrap">
            <table className="labs-table">
              <thead>
                <tr>
                  <th>Raw name</th>
                  <th>Canonical</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Ref low</th>
                  <th>Ref high</th>
                  <th>Source</th>
                  <th>Flag</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const slug = r.confirmed_marker_slug ?? ''
                  // Suggested slug is "new" iff it's not already in the
                  // registry AND it's non-empty AND not 'unmapped'.
                  const isNewSlug = slug && slug !== 'unmapped' && !ALL_MARKER_SLUGS.includes(slug)
                  const critical = criticalContext(r)
                  // Critical class wins over flagged — red over amber
                  // for the highest-stakes signal (cardiac arrhythmia risk
                  // on a K/Na/glucose panic value, not a cosmetic badge).
                  const rowClass = critical ? 'critical' : r.ui_flag ? 'flagged' : ''
                  return (
                    <tr key={i} className={rowClass}>
                      <td>
                        <div className="labs-cell-raw">{r.raw_marker_name}</div>
                        {critical && (
                          <div className="labs-cell-critical">
                            <strong>{critical.kind} — PANIC</strong> · {critical.thresholdLabel}
                            {critical.source === 'lab' && ' (from lab)'}
                          </div>
                        )}
                        {r.ui_flag && <div className="labs-cell-warn">⚠ {r.ui_flag}</div>}
                        {r.ref_text && <div className="labs-cell-sub">ref: {r.ref_text}</div>}
                        {r.text_value && <div className="labs-cell-sub">text: {r.text_value}</div>}
                      </td>
                      <td>
                        <select
                          value={slug}
                          onChange={(e) => updateRow(i, { confirmed_marker_slug: e.target.value || null })}
                        >
                          <option value="">(unmapped)</option>
                          {isNewSlug && (
                            <option value={slug}>
                              ➕ Create &quot;{slug}&quot;
                            </option>
                          )}
                          {ALL_MARKER_SLUGS.map((s) => {
                            const def = getMarker(s)
                            return (
                              <option key={s} value={s}>
                                {def?.display ?? s} {def?.keyMarker ? '★' : ''}
                              </option>
                            )
                          })}
                        </select>
                        {isNewSlug && r.merge_candidates.length > 0 && (
                          <div className="labs-cell-merge">
                            merge with existing?{' '}
                            {r.merge_candidates.map((c, ci) => (
                              <button
                                key={c}
                                type="button"
                                className="labs-merge-chip"
                                onClick={() => updateRow(i, { confirmed_marker_slug: c })}
                              >
                                {getMarker(c)?.display ?? c}
                                {ci < r.merge_candidates.length - 1 ? ',' : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          value={r.numeric_value ?? ''}
                          onChange={(e) =>
                            updateRow(i, {
                              numeric_value: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={r.unit ?? ''}
                          onChange={(e) => updateRow(i, { unit: e.target.value || null })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          value={r.ref_low ?? ''}
                          onChange={(e) =>
                            updateRow(i, {
                              // Editing a ref re-derives provenance: if both
                              // refs become empty, source clears; otherwise
                              // a user-edited range is a 'standard' (their
                              // confirmation, not the lab's print).
                              ref_low: e.target.value === '' ? null : Number(e.target.value),
                              range_source: e.target.value === '' && r.ref_high === null
                                ? null
                                : r.range_source === 'reported'
                                  ? 'reported'
                                  : (r.range_source ?? 'standard'),
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          value={r.ref_high ?? ''}
                          onChange={(e) =>
                            updateRow(i, {
                              ref_high: e.target.value === '' ? null : Number(e.target.value),
                              range_source: e.target.value === '' && r.ref_low === null
                                ? null
                                : r.range_source === 'reported'
                                  ? 'reported'
                                  : (r.range_source ?? 'standard'),
                            })
                          }
                        />
                      </td>
                      <td>
                        {r.range_source === 'reported' && (
                          <span className="labs-prov labs-prov-reported" title="Range printed on the report">from report</span>
                        )}
                        {r.range_source === 'standard' && (
                          <span className="labs-prov labs-prov-standard" title="Confirmed standard from your remembered library">standard</span>
                        )}
                        {r.range_source === 'proposed' && (
                          <span className="labs-prov labs-prov-proposed" title="AI-proposed population standard — confirm and it'll be remembered">proposed</span>
                        )}
                      </td>
                      <td>
                        <select
                          value={r.flag ?? ''}
                          onChange={(e) =>
                            updateRow(i, { flag: (e.target.value || null) as ReviewRow['flag'] })
                          }
                        >
                          <option value=""></option>
                          <option value="H">H</option>
                          <option value="L">L</option>
                          <option value="HH">HH</option>
                          <option value="LL">LL</option>
                          <option value="N">N</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          className="labs-btn-icon"
                          title="Remove this row from the draft"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="labs-commit-row">
            <div className="labs-commit-summary">
              {rows.length} marker{rows.length === 1 ? '' : 's'}
              {flaggedCount > 0 && <span className="labs-commit-flagged"> · {flaggedCount} flagged</span>}
            </div>
            <button
              type="button"
              onClick={onCommit}
              disabled={busy || rows.length === 0 || !drawnAt}
              className="labs-btn labs-btn-primary"
            >
              {busy ? 'Committing…' : 'Confirm + commit'}
            </button>
          </div>
          {commitError && (
            <div className="labs-error">
              <AlertCircle size={14} /> {commitError}
            </div>
          )}
        </section>
      )}

      {commitOk && !draft && (
        <div className="labs-success">
          <CheckCircle2 size={16} /> Committed {commitOk.rowsWritten} marker{commitOk.rowsWritten === 1 ? '' : 's'}
          {commitOk.aliasesLearned > 0 && ` · learned ${commitOk.aliasesLearned} new alias${commitOk.aliasesLearned === 1 ? '' : 'es'}`}
          {commitOk.rangesLearned > 0 && ` · remembered ${commitOk.rangesLearned} new standard range${commitOk.rangesLearned === 1 ? '' : 's'}`}.
        </div>
      )}

      {/* CTA back to the dashboard Labs tab — data viz (panels list +
          trends) lives there, rendered in the dashboard palette. This
          page is intentionally just the import tool. */}
      <Link href="/" className="labs-cta-link">
        See your labs in the dashboard <ArrowRight size={14} />
      </Link>
    </div>
  )
}
