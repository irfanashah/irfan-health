'use client'

import { useState, useTransition } from 'react'
import { createNote, updateEntry } from '../actions'
import { fromLocalInput, nowLocalForInput, toLocalInput } from '../_lib/datetime'
import type { NotePayload } from '../_lib/types'
import { FieldDateTime, FormMessage } from './WeightForm'

interface Props {
  initial?: { id: string; payload: NotePayload }
  onDone?: () => void
  compact?: boolean  // always-visible variant below the segmented control
}

export function NoteForm({ initial, onDone, compact }: Props) {
  const [recordedAt, setRecordedAt] = useState(
    initial ? toLocalInput(new Date(initial.payload.recorded_at)) : nowLocalForInput()
  )
  const [text, setText] = useState<string>(initial?.payload.text ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const trimmed = text.trim()
    if (!trimmed) {
      setError('Note text required.')
      return
    }

    const payload: NotePayload = {
      recorded_at: fromLocalInput(recordedAt),
      text: trimmed,
    }

    startTransition(async () => {
      const res = initial
        ? await updateEntry({ kind: 'note', id: initial.id, payload })
        : await createNote(payload)
      if (!res.ok) {
        setError(res.error ?? 'Failed to save.')
        return
      }
      setSuccess(true)
      if (!initial) {
        setText('')
        setRecordedAt(nowLocalForInput())
      }
      onDone?.()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {!compact && <FieldDateTime value={recordedAt} onChange={setRecordedAt} label="When" />}

      <div>
        {compact ? (
          <label className="block text-sm font-medium text-foreground mb-1">Quick note</label>
        ) : (
          <label className="block text-sm font-medium text-foreground mb-1">Note</label>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={compact ? 2 : 4}
          placeholder={compact ? 'Standalone note (not tied to a symptom)…' : ''}
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
        {pending ? 'Saving…' : initial ? 'Update' : 'Save note'}
      </button>
    </form>
  )
}
