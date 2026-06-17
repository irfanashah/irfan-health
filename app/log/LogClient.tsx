'use client'

import { useState } from 'react'
import { WeightForm } from './forms/WeightForm'
import { GlucoseForm } from './forms/GlucoseForm'
import { SymptomForm } from './forms/SymptomForm'
import { BpForm } from './forms/BpForm'
import { NoteForm } from './forms/NoteForm'

type Tab = 'weight' | 'glucose' | 'symptom' | 'bp'

const TABS: { id: Tab; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'glucose', label: 'Glucose' },
  { id: 'symptom', label: 'Symptom' },
  { id: 'bp', label: 'BP' },
]

export function LogClient() {
  const [tab, setTab] = useState<Tab>('weight')

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

      <section
        role="tabpanel"
        className="rounded-md border border-border bg-card p-4"
      >
        {tab === 'weight' && <WeightForm />}
        {tab === 'glucose' && <GlucoseForm />}
        {tab === 'symptom' && <SymptomForm />}
        {tab === 'bp' && <BpForm />}
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Quick note</h2>
        <NoteForm compact />
      </section>
    </div>
  )
}
