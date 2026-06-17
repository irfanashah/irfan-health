'use client'

import { useState, useTransition } from 'react'
import { createWeight, updateEntry } from '../actions'
import { fromLocalInput, nowLocalForInput, toLocalInput } from '../_lib/datetime'
import { WEIGHT_KG_MAX, WEIGHT_KG_MIN } from '../_lib/ranges'
import type { WeightPayload } from '../_lib/types'

interface Props {
  initial?: { id: string; payload: WeightPayload }
  onDone?: () => void
}

export function WeightForm({ initial, onDone }: Props) {
  const [recordedAt, setRecordedAt] = useState(
    initial ? toLocalInput(new Date(initial.payload.recorded_at)) : nowLocalForInput()
  )
  const [kg, setKg] = useState<string>(initial ? String(initial.payload.weight_kg) : '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const value = Number(kg)
    if (!Number.isFinite(value)) {
      setError('Enter a number.')
      return
    }
    if (value < WEIGHT_KG_MIN || value > WEIGHT_KG_MAX) {
      setError(`Must be ${WEIGHT_KG_MIN}–${WEIGHT_KG_MAX} kg.`)
      return
    }

    const payload: WeightPayload = {
      recorded_at: fromLocalInput(recordedAt),
      weight_kg: value,
    }

    startTransition(async () => {
      const res = initial
        ? await updateEntry({ kind: 'weight', id: initial.id, payload })
        : await createWeight(payload)
      if (!res.ok) {
        setError(res.error ?? 'Failed to save.')
        return
      }
      setSuccess(true)
      if (!initial) setKg('')
      onDone?.()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FieldDateTime value={recordedAt} onChange={setRecordedAt} label="When" />

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Weight (kg)</label>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min={WEIGHT_KG_MIN}
          max={WEIGHT_KG_MAX}
          value={kg}
          onChange={(e) => setKg(e.target.value)}
          required
          className="w-full px-3 py-3 border border-input rounded-md text-base
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
        {pending ? 'Saving…' : initial ? 'Update' : 'Log weight'}
      </button>
    </form>
  )
}

export function FieldDateTime({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full px-3 py-3 border border-input rounded-md text-base
                   bg-card text-foreground
                   focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
      />
    </div>
  )
}

export function FormMessage({
  error,
  success,
}: {
  error: string | null
  success: string | null
}) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (success) return <p className="text-sm text-accent-teal">{success}</p>
  return null
}
