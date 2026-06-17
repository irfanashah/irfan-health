'use client'

import { useState, useTransition, useMemo } from 'react'
import { createSymptom, updateEntry } from '../actions'
import { fromLocalInput, nowLocalForInput, toLocalInput } from '../_lib/datetime'
import {
  GROUP_LABELS,
  RED_FLAG_REMINDER,
  SYMPTOMS,
  getSymptom,
  type SymptomGroup,
} from '../_lib/symptoms'
import type { SymptomPayload } from '../_lib/types'
import { FieldDateTime, FormMessage } from './WeightForm'

interface Props {
  initial?: { id: string; payload: SymptomPayload }
  onDone?: () => void
}

export function SymptomForm({ initial, onDone }: Props) {
  const [recordedAt, setRecordedAt] = useState(
    initial ? toLocalInput(new Date(initial.payload.recorded_at)) : nowLocalForInput()
  )
  const [code, setCode] = useState<string>(initial ? initial.payload.symptom_code : '')
  const [severity, setSeverity] = useState<string>(
    initial && initial.payload.severity !== null ? String(initial.payload.severity) : ''
  )
  const [note, setNote] = useState<string>(initial?.payload.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()

  const grouped = useMemo(() => {
    const order: SymptomGroup[] = ['cardiac', 'respiratory', 'general', 'gi', 'neuro', 'other']
    return order.map((g) => ({
      group: g,
      label: GROUP_LABELS[g],
      items: SYMPTOMS.filter((s) => s.group === g),
    }))
  }, [])

  const selected = code ? getSymptom(code) : undefined
  const isRedFlag = selected?.red_flag === true
  const needsNote = code === 'other'

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!code) {
      setError('Pick a symptom.')
      return
    }
    const trimmedNote = note.trim()
    if (needsNote && !trimmedNote) {
      setError('A note is required for "Other".')
      return
    }
    let sev: number | null = null
    if (severity !== '') {
      const s = Number(severity)
      if (!Number.isInteger(s) || s < 1 || s > 5) {
        setError('Severity must be 1–5.')
        return
      }
      sev = s
    }

    const payload: SymptomPayload = {
      recorded_at: fromLocalInput(recordedAt),
      symptom_code: code,
      severity: sev,
      note: trimmedNote || null,
    }

    startTransition(async () => {
      const res = initial
        ? await updateEntry({ kind: 'symptom', id: initial.id, payload })
        : await createSymptom(payload)
      if (!res.ok) {
        setError(res.error ?? 'Failed to save.')
        return
      }
      setSuccess(true)
      if (!initial) {
        setCode('')
        setSeverity('')
        setNote('')
      }
      onDone?.()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FieldDateTime value={recordedAt} onChange={setRecordedAt} label="When" />

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Symptom</label>
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          className="w-full px-3 py-3 border border-input rounded-md text-base
                     bg-card text-foreground
                     focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">— Select —</option>
          {grouped.map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.items.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                  {s.red_flag ? ' ⚠︎' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {isRedFlag && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm text-foreground">{RED_FLAG_REMINDER}</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Severity <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => setSeverity(severity === String(n) ? '' : String(n))}
              aria-pressed={severity === String(n)}
              className={`flex-1 py-3 rounded-md border text-sm font-medium transition-colors ${
                severity === String(n)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-card text-foreground hover:bg-muted'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Note {needsNote && <span className="text-destructive">*</span>}
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border border-input rounded-md text-base
                     bg-card text-foreground
                     focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
        />
      </div>

      <FormMessage error={error} success={success ? (initial ? 'Updated.' : 'Logged.') : null} />

      <button
        type="submit"
        disabled={pending}
        className="w-full py-3 px-4 bg-primary text-primary-foreground text-sm font-medium
                   rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-opacity"
      >
        {pending ? 'Saving…' : initial ? 'Update' : 'Log symptom'}
      </button>
    </form>
  )
}
