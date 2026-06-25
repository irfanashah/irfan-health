'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, FileText, Upload } from 'lucide-react'
import {
  createLabUploadUrl,
  extractFromStorage,
  commitPanel,
  type LabPanelRow,
  type MarkerTrend,
  type CommitPayload,
} from './actions'
import type { ExtractionDraft, DraftValue } from './_lib/types'
import { ALL_MARKER_SLUGS, getMarker } from './_lib/markers'
import { PanelsList } from './PanelsList'
import { MarkerTrends } from './MarkerTrends'
import { createClient as createBrowserSupabase } from '@/lib/supabase/client'

/** Hard client-side cap. Mirrors the bucket's 25 MB limit. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

interface Props {
  initialPanels: LabPanelRow[]
  initialTrends: MarkerTrend[]
}

interface ReviewRow extends DraftValue {
  confirmed_marker_slug: string | null
  /** Per-row UI flag: yellow border + warning text. */
  ui_flag: string | null
}

// Surface a warning when the row has no slug, no confirmed slug, an
// unknown unit, or the LLM left a note. The user can still commit —
// the flag is a nudge, not a block.
function rowWarning(r: ReviewRow): string | null {
  const notes: string[] = []
  if (!r.confirmed_marker_slug || r.confirmed_marker_slug === 'unmapped') notes.push('unmapped marker')
  if (r.numeric_value === null && !r.text_value) notes.push('no value')
  if (r.notes) notes.push(r.notes)
  if (r.confirmed_marker_slug && r.confirmed_marker_slug !== 'unmapped' && r.unit) {
    const def = getMarker(r.confirmed_marker_slug)
    // If the marker has a canonical unit + no conversion handled the
    // reported unit, flag — value still stores, just no canonical.
    if (def?.canonicalUnit && def.convert) {
      const { canonical_value } = def.convert
        ? { canonical_value: def.convert(r.numeric_value ?? 0, r.unit) }
        : { canonical_value: null }
      if (r.numeric_value !== null && canonical_value === null) notes.push(`unit "${r.unit}" not converted`)
    }
  }
  return notes.length ? notes.join(' · ') : null
}

function makeReviewRow(v: DraftValue): ReviewRow {
  const base: ReviewRow = {
    ...v,
    confirmed_marker_slug: v.suggested_marker_slug,
    ui_flag: null,
  }
  base.ui_flag = rowWarning(base)
  return base
}

export function LabsClient({ initialPanels, initialTrends }: Props) {
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
  const [commitOk, setCommitOk] = useState<{ rowsWritten: number; aliasesLearned: number } | null>(null)

  function resetDraft() {
    setDraft(null)
    setRawFileRef(null)
    setDrawnAt('')
    setLabName('')
    setOrderingPhysician('')
    setPanelNotes('')
    setRows([])
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
      setDraft(res.draft)
      setRawFileRef(res.rawFileRef)
      setDrawnAt(res.draft.panel.drawn_at ?? '')
      setLabName(res.draft.panel.lab_name ?? '')
      setOrderingPhysician(res.draft.panel.ordering_physician ?? '')
      setPanelNotes(
        [
          res.draft.panel.notes,
          res.draft.dateAmbiguous ? 'ambiguous date — confirm above' : null,
        ].filter(Boolean).join(' · ')
      )
      setRows(res.draft.values.map(makeReviewRow))
    })
  }

  function updateRow(i: number, patch: Partial<ReviewRow>) {
    setRows((prev) => {
      const next = prev.slice()
      const merged = { ...next[i], ...patch }
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
      setCommitOk({ rowsWritten: res.rowsWritten, aliasesLearned: res.aliasesLearned })
      resetDraft()
      router.refresh()
    })
  }

  const flaggedCount = useMemo(() => rows.filter((r) => r.ui_flag).length, [rows])

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
                  <th>Flag</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.ui_flag ? 'flagged' : ''}>
                    <td>
                      <div className="labs-cell-raw">{r.raw_marker_name}</div>
                      {r.ui_flag && <div className="labs-cell-warn">⚠ {r.ui_flag}</div>}
                      {r.ref_text && <div className="labs-cell-sub">ref: {r.ref_text}</div>}
                      {r.text_value && <div className="labs-cell-sub">text: {r.text_value}</div>}
                    </td>
                    <td>
                      <select
                        value={r.confirmed_marker_slug ?? ''}
                        onChange={(e) => updateRow(i, { confirmed_marker_slug: e.target.value || null })}
                      >
                        <option value="">(unmapped)</option>
                        {ALL_MARKER_SLUGS.map((s) => {
                          const def = getMarker(s)
                          return (
                            <option key={s} value={s}>
                              {def?.display ?? s} {def?.keyMarker ? '★' : ''}
                            </option>
                          )
                        })}
                      </select>
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
                            ref_low: e.target.value === '' ? null : Number(e.target.value),
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
                          })
                        }
                      />
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
                ))}
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
          {commitOk.aliasesLearned > 0 && ` · learned ${commitOk.aliasesLearned} new alias${commitOk.aliasesLearned === 1 ? '' : 'es'}`}.
        </div>
      )}

      {/* ─── Panels list ─────────────────────────────────────────────── */}
      <PanelsList panels={initialPanels} />

      {/* ─── Key-marker trends + picker ─────────────────────────────── */}
      <MarkerTrends trends={initialTrends} />
    </div>
  )
}
