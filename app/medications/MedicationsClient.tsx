'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Pill, Pencil, RotateCcw, X } from 'lucide-react'
import {
  createMedication,
  updateMedication,
  deactivateMedication,
  reactivateMedication,
  type MedicationRow,
} from './actions'

interface Props {
  meds: MedicationRow[]
}

interface DraftMed {
  name: string
  dose: string
  frequency: string
  notes: string
}

const EMPTY: DraftMed = { name: '', dose: '', frequency: '', notes: '' }

export function MedicationsClient({ meds }: Props) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

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
