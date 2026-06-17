'use client'

import { useState, useTransition } from 'react'
import { createGlucose, updateEntry } from '../actions'
import { fromLocalInput, nowLocalForInput, toLocalInput } from '../_lib/datetime'
import { mgdlToMmol, mmolToMgdl, roundTo1dp } from '../_lib/glucose'
import { GLUCOSE_MMOL_MAX, GLUCOSE_MMOL_MIN } from '../_lib/ranges'
import type { GlucosePayload, GlucoseUnit } from '../_lib/types'
import { FieldDateTime, FormMessage } from './WeightForm'

interface Props {
  initial?: { id: string; payload: GlucosePayload }
  onDone?: () => void
}

export function GlucoseForm({ initial, onDone }: Props) {
  const [recordedAt, setRecordedAt] = useState(
    initial ? toLocalInput(new Date(initial.payload.recorded_at)) : nowLocalForInput()
  )
  const [value, setValue] = useState<string>(initial ? String(initial.payload.value) : '')
  const [unit, setUnit] = useState<GlucoseUnit>(initial ? initial.payload.unit : 'mmol/L')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()

  const v = Number(value)
  const showPreview = Number.isFinite(v) && value !== ''
  const previewMmol = unit === 'mg/dL' ? mgdlToMmol(v) : roundTo1dp(v)
  const previewMgdl = unit === 'mmol/L' ? mmolToMgdl(v) : Math.round(v)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!Number.isFinite(v)) {
      setError('Enter a number.')
      return
    }

    const payload: GlucosePayload = {
      recorded_at: fromLocalInput(recordedAt),
      value: v,
      unit,
    }

    startTransition(async () => {
      const res = initial
        ? await updateEntry({ kind: 'glucose', id: initial.id, payload })
        : await createGlucose(payload)
      if (!res.ok) {
        setError(res.error ?? 'Failed to save.')
        return
      }
      setSuccess(true)
      if (!initial) setValue('')
      onDone?.()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FieldDateTime value={recordedAt} onChange={setRecordedAt} label="When" />

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Glucose</label>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            className="flex-1 px-3 py-3 border border-input rounded-md text-base
                       bg-card text-foreground
                       focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as GlucoseUnit)}
            className="px-3 py-3 border border-input rounded-md text-base
                       bg-card text-foreground
                       focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="mmol/L">mmol/L</option>
            <option value="mg/dL">mg/dL</option>
          </select>
        </div>
        {showPreview && (
          <p className="text-xs text-muted-foreground mt-1">
            ≈ {previewMmol} mmol/L · {previewMgdl} mg/dL
          </p>
        )}
        <p className="text-xs text-muted-foreground/70 mt-1">
          Range: {GLUCOSE_MMOL_MIN}–{GLUCOSE_MMOL_MAX} mmol/L
        </p>
      </div>

      <FormMessage error={error} success={success ? (initial ? 'Updated.' : 'Logged.') : null} />

      <button
        type="submit"
        disabled={pending}
        className="w-full py-3 px-4 bg-primary text-primary-foreground text-sm font-medium
                   rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-opacity"
      >
        {pending ? 'Saving…' : initial ? 'Update' : 'Log glucose'}
      </button>
    </form>
  )
}
