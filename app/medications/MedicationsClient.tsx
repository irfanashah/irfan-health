'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Pill, Pencil, RotateCcw, X } from 'lucide-react'
import {
  createMedication,
  updateMedication,
  deactivateMedication,
  reactivateMedication,
  confirmTodayMeds,
  markTodaySkipped,
  clearToday,
  type MedicationRow,
  type AdherenceSummary,
} from './actions'

interface Props {
  meds: MedicationRow[]
  adherence: AdherenceSummary
}

interface DraftMed {
  name: string
  dose: string
  frequency: string
  notes: string
}

const EMPTY: DraftMed = { name: '', dose: '', frequency: '', notes: '' }

// ─── Adherence history section ──────────────────────────────────────
//
// Sits above the meds list. 30-day heat-strip + the two honest numbers
// (adherence-of-logged + coverage) + streak + one-tap. cleared is never
// shown — it just reads as unknown.

function fmtPct(v: number | null, dp = 0): string {
  if (v === null) return '—'
  return `${v.toFixed(dp)}%`
}

function AdherenceHistory({ adherence, busy, onConfirm, onSkip, onUndo, error }: {
  adherence: AdherenceSummary
  busy: boolean
  onConfirm: () => void
  onSkip: (note: string) => void
  onUndo: () => void
  error: string | null
}) {
  const [showSkip, setShowSkip] = useState(false)
  const [skipNote, setSkipNote] = useState('')
  const today = adherence.todayStatus
  const days = adherence.days

  function submitSkip() {
    onSkip(skipNote)
    setShowSkip(false)
    setSkipNote('')
  }

  return (
    <section className="meds-card">
      <h2 className="meds-section-title">
        <Pill size={16} /> Adherence
        <span className="meds-adh-self-reported" title="Self-reported — not verified intake.">self-reported</span>
      </h2>

      {!adherence.hasAnyRecord ? (
        <div className="meds-empty">
          Tracking not yet started — tap below to log today.
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={onConfirm} disabled={busy} className="meds-btn meds-btn-primary">
              <CheckCircle2 size={14} /> Took today's meds
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="meds-adh-stats">
            <div className="meds-adh-stat">
              <span className="meds-adh-stat-n">{fmtPct(adherence.adherencePctOfLogged)}</span>
              <span className="meds-adh-stat-l">of logged days taken</span>
              <span className="meds-adh-stat-sub">{adherence.takenCount} taken · {adherence.skippedCount} skipped</span>
            </div>
            <div className="meds-adh-stat">
              <span className="meds-adh-stat-n">{fmtPct(adherence.coveragePct)}</span>
              <span className="meds-adh-stat-l">coverage</span>
              <span className="meds-adh-stat-sub">{adherence.loggedCount} of {adherence.expectedDays ?? '—'} expected days logged</span>
            </div>
            <div className="meds-adh-stat">
              <span className="meds-adh-stat-n">{adherence.streak}</span>
              <span className="meds-adh-stat-l">day streak</span>
              <span className="meds-adh-stat-sub">consecutive ‘taken’ days</span>
            </div>
          </div>

          <div className="meds-adh-strip" aria-label="Last 30 days adherence">
            {days.map((d) => (
              <span
                key={d.day}
                className={`meds-adh-cell meds-adh-cell-${d.status}`}
                title={`${d.day} — ${d.status === 'taken' ? 'Taken' : d.status === 'skipped' ? 'Skipped' : 'Not logged'}`}
              />
            ))}
          </div>
          <div className="meds-adh-strip-legend">
            <span><span className="meds-adh-cell meds-adh-cell-taken" /> taken</span>
            <span><span className="meds-adh-cell meds-adh-cell-skipped" /> skipped</span>
            <span><span className="meds-adh-cell meds-adh-cell-unknown" /> not logged</span>
            <span className="meds-adh-strip-range">last {days.length} days</span>
          </div>

          <div className="meds-adh-action">
            {today === 'taken' ? (
              <>
                <span className="meds-adh-state"><CheckCircle2 size={14} /> Logged for today</span>
                <button type="button" className="meds-btn meds-btn-ghost" onClick={onUndo} disabled={busy}>
                  <RotateCcw size={13} /> Undo
                </button>
              </>
            ) : today === 'skipped' ? (
              <>
                <span className="meds-adh-state meds-adh-state-skipped"><X size={14} /> Skipped today</span>
                <button type="button" className="meds-btn meds-btn-primary" onClick={onConfirm} disabled={busy}>
                  <CheckCircle2 size={13} /> Took today's meds
                </button>
                <button type="button" className="meds-btn meds-btn-ghost" onClick={onUndo} disabled={busy}>
                  <RotateCcw size={13} /> Undo
                </button>
              </>
            ) : (
              <>
                <button type="button" className="meds-btn meds-btn-primary" onClick={onConfirm} disabled={busy}>
                  <CheckCircle2 size={14} /> Took today's meds
                </button>
                {!showSkip ? (
                  <button type="button" className="meds-btn meds-btn-ghost" onClick={() => setShowSkip(true)} disabled={busy}>
                    Skipped today
                  </button>
                ) : (
                  <>
                    <input
                      type="text"
                      value={skipNote}
                      onChange={(e) => setSkipNote(e.target.value)}
                      placeholder="Optional note"
                      disabled={busy}
                      className="meds-adh-skip-input"
                    />
                    <button type="button" className="meds-btn meds-btn-primary" onClick={submitSkip} disabled={busy}>
                      Mark skipped
                    </button>
                    <button type="button" className="meds-btn meds-btn-ghost" onClick={() => { setShowSkip(false); setSkipNote('') }} disabled={busy}>
                      Cancel
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {error && <div className="meds-error">{error}</div>}
    </section>
  )
}

// ─── Main component ─────────────────────────────────────────────────

export function MedicationsClient({ meds, adherence }: Props) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [adhError, setAdhError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  function runAdh(action: () => Promise<{ ok: boolean; error?: string }>) {
    setAdhError(null)
    startTransition(async () => {
      const res = await action()
      if (!res.ok) {
        setAdhError(res.error ?? 'Unknown error')
        return
      }
      router.refresh()
    })
  }

  // Add form
  const [draft, setDraft] = useState<DraftMed>(EMPTY)
  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<DraftMed>(EMPTY)

  function flash(message: string) {
    setOk(message)
    setError(null)
    setTimeout(() => setOk(null), 2500)
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createMedication({
        name: draft.name,
        dose: draft.dose || null,
        frequency: draft.frequency || null,
        notes: draft.notes || null,
      })
      if (!res.ok) {
        setError(res.error ?? 'Unknown error')
        return
      }
      setDraft(EMPTY)
      flash('Added.')
      router.refresh()
    })
  }

  function startEdit(m: MedicationRow) {
    setEditingId(m.id)
    setEditDraft({
      name: m.name,
      dose: m.dose ?? '',
      frequency: m.frequency ?? '',
      notes: m.notes ?? '',
    })
  }

  function onSaveEdit(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await updateMedication(id, {
        name: editDraft.name,
        dose: editDraft.dose || null,
        frequency: editDraft.frequency || null,
        notes: editDraft.notes || null,
      })
      if (!res.ok) {
        setError(res.error ?? 'Unknown error')
        return
      }
      setEditingId(null)
      flash('Updated.')
      router.refresh()
    })
  }

  function onDeactivate(id: string, name: string) {
    if (!confirm(`Stop tracking "${name}" as active? You can reactivate it later — it won't be deleted.`)) return
    startTransition(async () => {
      const res = await deactivateMedication(id)
      if (!res.ok) {
        setError(res.error ?? 'Unknown error')
        return
      }
      flash('Deactivated.')
      router.refresh()
    })
  }

  function onReactivate(id: string) {
    startTransition(async () => {
      const res = await reactivateMedication(id)
      if (!res.ok) {
        setError(res.error ?? 'Unknown error')
        return
      }
      flash('Reactivated.')
      router.refresh()
    })
  }

  const active = meds.filter((m) => m.active)
  const archived = meds.filter((m) => !m.active)

  return (
    <div className="meds-page">
      <AdherenceHistory
        adherence={adherence}
        busy={busy}
        onConfirm={() => runAdh(confirmTodayMeds)}
        onSkip={(note) => runAdh(() => markTodaySkipped(note || undefined))}
        onUndo={() => runAdh(clearToday)}
        error={adhError}
      />

      <section className="meds-card">
        <h2 className="meds-section-title"><Pill size={16} /> Add medication</h2>
        <form onSubmit={onAdd} className="meds-form">
          <label>
            <span>Name *</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Concor"
              required
              disabled={busy}
            />
          </label>
          <label>
            <span>Dose</span>
            <input
              type="text"
              value={draft.dose}
              onChange={(e) => setDraft({ ...draft, dose: e.target.value })}
              placeholder="5mg"
              disabled={busy}
            />
          </label>
          <label>
            <span>Frequency</span>
            <input
              type="text"
              value={draft.frequency}
              onChange={(e) => setDraft({ ...draft, frequency: e.target.value })}
              placeholder="morning / BD / TDS"
              disabled={busy}
            />
          </label>
          <label className="full">
            <span>Notes</span>
            <input
              type="text"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="bisoprolol — beta-blocker"
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy || !draft.name.trim()} className="meds-btn meds-btn-primary">
            Add
          </button>
        </form>
        {error && <div className="meds-error">{error}</div>}
        {ok && <div className="meds-ok"><CheckCircle2 size={14} /> {ok}</div>}
      </section>

      <section className="meds-card">
        <h2 className="meds-section-title"><Pill size={16} /> Active ({active.length})</h2>
        {active.length === 0 ? (
          <div className="meds-empty">No active medications.</div>
        ) : (
          <ul className="meds-list">
            {active.map((m) => (
              <li key={m.id} className="meds-row">
                {editingId === m.id ? (
                  <div className="meds-edit-row">
                    <input value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} placeholder="Name" />
                    <input value={editDraft.dose} onChange={(e) => setEditDraft({ ...editDraft, dose: e.target.value })} placeholder="Dose" />
                    <input value={editDraft.frequency} onChange={(e) => setEditDraft({ ...editDraft, frequency: e.target.value })} placeholder="Frequency" />
                    <input value={editDraft.notes} onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })} placeholder="Notes" />
                    <div className="meds-row-actions">
                      <button onClick={() => onSaveEdit(m.id)} disabled={busy} className="meds-btn meds-btn-primary">Save</button>
                      <button onClick={() => setEditingId(null)} disabled={busy} className="meds-btn meds-btn-ghost">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="meds-row-main">
                      <div className="meds-row-name">
                        <strong>{m.name}</strong> {m.dose && <span className="meds-row-dose">{m.dose}</span>}
                      </div>
                      <div className="meds-row-meta">
                        {m.frequency && <span>{m.frequency}</span>}
                        {m.notes && <span className="meds-row-notes">{m.notes}</span>}
                      </div>
                    </div>
                    <div className="meds-row-actions">
                      <button onClick={() => startEdit(m)} className="meds-btn meds-btn-ghost" title="Edit">
                        <Pencil size={13} /> Edit
                      </button>
                      <button onClick={() => onDeactivate(m.id, m.name)} className="meds-btn meds-btn-ghost" title="Deactivate (keeps history)">
                        <X size={13} /> Stop
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section className="meds-card">
          <h2 className="meds-section-title">Archived ({archived.length})</h2>
          <ul className="meds-list">
            {archived.map((m) => (
              <li key={m.id} className="meds-row meds-row-archived">
                <div className="meds-row-main">
                  <div className="meds-row-name">
                    <strong>{m.name}</strong> {m.dose && <span className="meds-row-dose">{m.dose}</span>}
                  </div>
                  <div className="meds-row-meta">
                    {m.frequency && <span>{m.frequency}</span>}
                    {m.notes && <span className="meds-row-notes">{m.notes}</span>}
                  </div>
                </div>
                <div className="meds-row-actions">
                  <button onClick={() => onReactivate(m.id)} className="meds-btn meds-btn-ghost" title="Reactivate">
                    <RotateCcw size={13} /> Reactivate
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
