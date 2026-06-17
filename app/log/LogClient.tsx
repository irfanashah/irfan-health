'use client'

import { useState } from 'react'
import { WeightForm } from './forms/WeightForm'
import { GlucoseForm } from './forms/GlucoseForm'
import { SymptomForm } from './forms/SymptomForm'
import { BpForm } from './forms/BpForm'
import { NoteForm } from './forms/NoteForm'
import { RecentList } from './RecentList'
import { kindLabel } from './_lib/fetch-recent'
import type {
  BpPayload,
  GlucosePayload,
  NotePayload,
  RecentEntry,
  SymptomPayload,
  WeightPayload,
} from './_lib/types'

type Tab = 'weight' | 'glucose' | 'symptom' | 'bp'

const TABS: { id: Tab; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'glucose', label: 'Glucose' },
  { id: 'symptom', label: 'Symptom' },
  { id: 'bp', label: 'BP' },
]

interface Props {
  recent: RecentEntry[]
}

export function LogClient({ recent }: Props) {
  const [tab, setTab] = useState<Tab>('weight')
  const [editing, setEditing] = useState<RecentEntry | null>(null)

  function handleEdit(entry: RecentEntry) {
    setEditing(entry)
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  function cancelEdit() {
    setEditing(null)
  }

  function onDone() {
    setEditing(null)
  }

  // Edit mode: show the matching form pre-filled, hide the segmented control.
  if (editing) {
    return (
      <div className="space-y-6">
        <div className="rounded-md border border-accent-amber/40 bg-accent-amber/5 p-3 flex items-center justify-between">
          <p className="text-sm text-foreground">
            Editing {kindLabel(editing.kind)} entry
          </p>
          <button
            type="button"
            onClick={cancelEdit}
            className="text-xs px-2 py-1 rounded border border-input bg-card text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>

        <section className="rounded-md border border-border bg-card p-4">
          {editing.kind === 'weight' && (
            <WeightForm
              initial={{ id: editing.id, payload: editing.raw as WeightPayload }}
              onDone={onDone}
            />
          )}
          {editing.kind === 'glucose' && (
            <GlucoseForm
              initial={{ id: editing.id, payload: editing.raw as GlucosePayload }}
              onDone={onDone}
            />
          )}
          {editing.kind === 'symptom' && (
            <SymptomForm
              initial={{ id: editing.id, payload: editing.raw as SymptomPayload }}
              onDone={onDone}
            />
          )}
          {editing.kind === 'note' && (
            <NoteForm
              initial={{ id: editing.id, payload: editing.raw as NotePayload }}
              onDone={onDone}
            />
          )}
          {editing.kind === 'bp' && (
            <BpForm
              initial={{ id: editing.id, payload: editing.raw as BpPayload }}
              onDone={onDone}
            />
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Entry type"
        className="grid grid-cols-4 gap-1 p-1 rounded-md bg-muted"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`py-2 rounded-sm text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section role="tabpanel" className="rounded-md border border-border bg-card p-4">
        {tab === 'weight' && <WeightForm />}
        {tab === 'glucose' && <GlucoseForm />}
        {tab === 'symptom' && <SymptomForm />}
        {tab === 'bp' && <BpForm />}
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Quick note</h2>
        <NoteForm compact />
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent (last 20)</h2>
        <RecentList entries={recent} onEdit={handleEdit} />
      </section>
    </div>
  )
}
