'use client'

import { useState, useTransition } from 'react'
import { createBp, updateEntry } from '../actions'
import { fromLocalInput, nowLocalForInput, toLocalInput } from '../_lib/datetime'
import type { BpPayload, BpPosition } from '../_lib/types'
import { FieldDateTime, FormMessage } from './WeightForm'

interface Props {
  initial?: { id: string; payload: BpPayload }
  onDone?: () => void
}

export function BpForm({ initial, onDone }: Props) {
  const [measuredAt, setMeasuredAt] = useState(
    initial ? toLocalInput(new Date(initial.payload.measured_at)) : nowLocalForInput()
  )
  const [systolic, setSystolic] = useState<string>(initial ? String(initial.payload.systolic_mmhg) : '')
  const [diastolic, setDiastolic] = useState<string>(initial ? String(initial.payload.diastolic_mmhg) : '')
  const [pulse, setPulse] = useState<string>(
    initial && initial.payload.pulse_bpm !== null ? String(initial.payload.pulse_bpm) : ''
  )
  const [position, setPosition] = useState<BpPosition | ''>(initial?.payload.position ?? '')
  const [arm, setArm] = useState<string>(initial?.payload.arm ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const sys = Number(systolic)
    const dia = Number(diastolic)
    if (!Number.isFinite(sys) || !Number.isFinite(dia)) {
      setError('Systolic and diastolic required.')
      return
    }
    if (dia >= sys) {
      setError('Diastolic must be lower than systolic.')
      return
    }
    let p: number | null = null
    if (pulse !== '') {
      const pn = Number(pulse)
      if (!Number.isFinite(pn)) {
        setError('Pulse must be a number.')
        return
      }
      p = pn
    }

    const payload: BpPayload = {
      measured_at: fromLocalInput(measuredAt),
      systolic_mmhg: sys,
      diastolic_mmhg: dia,
      pulse_bpm: p,
      position: position === '' ? null : position,
      arm: arm.trim() || null,
    }

    startTransition(async () => {
      const res = initial
        ? await updateEntry({ kind: 'bp', id: initial.id, payload })
        : await createBp(payload)
      if (!res.ok) {
        setError(res.error ?? 'Failed to save.')
        return
      }
      setSuccess(true)
      if (!initial) {
        setSystolic('')
        setDiastolic('')
        setPulse('')
        setPosition('')
        setArm('')
      }
      onDone?.()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FieldDateTime value={measuredAt} onChange={setMeasuredAt} label="When" />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Systolic</label>
          <input
            type="number"
            inputMode="numeric"
            value={systolic}
            onChange={(e) => setSystolic(e.target.value)}
            required
            className="w-full px-3 py-3 border border-input rounded-md text-base
                       bg-card text-foreground
                       focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Diastolic</label>
          <input
            type="number"
            inputMode="numeric"
            value={diastolic}
            onChange={(e) => setDiastolic(e.target.value)}
            required
            className="w-full px-3 py-3 border border-input rounded-md text-base
                       bg-card text-foreground
                       focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Pulse <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          type="number"
          inputMode="numeric"
          value={pulse}
          onChange={(e) => setPulse(e.target.value)}
          className="w-full px-3 py-3 border border-input rounded-md text-base
                     bg-card text-foreground
                     focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Position</label>
          <select
            value={position ?? ''}
            onChange={(e) => setPosition(e.target.value as BpPosition | '')}
            className="w-full px-3 py-3 border border-input rounded-md text-base
                       bg-card text-foreground
                       focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">—</option>
            <option value="sitting">Sitting</option>
            <option value="lying">Lying</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Arm <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={arm}
            placeholder="left / right"
            onChange={(e) => setArm(e.target.value)}
            className="w-full px-3 py-3 border border-input rounded-md text-base
                       bg-card text-foreground
                       focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
          />
        </div>
      </div>

      <FormMessage error={error} success={success ? (initial ? 'Updated.' : 'Logged.') : null} />

      <button
        type="submit"
        disabled={pending}
        className="w-full py-3 px-4 bg-primary text-primary-foreground text-sm font-medium
                   rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-opacity"
      >
        {pending ? 'Saving…' : initial ? 'Update' : 'Log BP'}
      </button>
    </form>
  )
}
