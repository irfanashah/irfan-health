'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { NotebookPen, Plus, Check, ChevronDown, AlertTriangle } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import {
  createWeight,
  createGlucose,
  createSymptom,
  createBp,
  createNote,
} from '@/app/log/actions'
import { SYMPTOMS, getSymptom, RED_FLAG_REMINDER } from '@/app/log/_lib/symptoms'

type Tab = 'weight' | 'glucose' | 'bp' | 'symptom'

const TABS: { id: Tab; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'glucose', label: 'Glucose' },
  { id: 'bp', label: 'BP' },
  { id: 'symptom', label: 'Symptom' },
]

interface Props {
  glucoseUnit: 'mmol/L' | 'mg/dL'
}

export function QuickLogPanel({ glucoseUnit }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [tab, setTab] = useState<Tab>('weight')
  const [flash, setFlash] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // per-tab state
  const [weight, setWeight] = useState('')
  const [glucose, setGlucose] = useState('')
  const [sys, setSys] = useState('')
  const [dia, setDia] = useState('')
  // Default to a clear, non-cardiac symptom so the form isn't pre-charged
  // with a red-flag (would show the reminder before the user picks anything).
  const [symptomCode, setSymptomCode] = useState('fatigue')
  const [sev, setSev] = useState(0)
  const [note, setNote] = useState('')

  const selectedSymptom = getSymptom(symptomCode)
  const isRedFlag = tab === 'symptom' && selectedSymptom?.red_flag === true

  function reset() {
    setWeight('')
    setGlucose('')
    setSys('')
    setDia('')
    setSev(0)
    setNote('')
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const recorded_at = new Date().toISOString()
    const trimmedNote = note.trim() || null

    startTransition(async () => {
      let res
      if (tab === 'weight') {
        const v = Number(weight)
        if (!Number.isFinite(v)) { setErr('Enter a weight.'); return }
        res = await createWeight({ recorded_at, weight_kg: v })
      } else if (tab === 'glucose') {
        const v = Number(glucose)
        if (!Number.isFinite(v)) { setErr('Enter a glucose value.'); return }
        res = await createGlucose({ recorded_at, value: v, unit: glucoseUnit })
      } else if (tab === 'bp') {
        const s = Number(sys), d = Number(dia)
        if (!Number.isFinite(s) || !Number.isFinite(d)) { setErr('Enter systolic and diastolic.'); return }
        res = await createBp({
          measured_at: recorded_at,
          systolic_mmhg: s,
          diastolic_mmhg: d,
          pulse_bpm: null,
          position: null,
          arm: null,
        })
      } else {
        if (!symptomCode) { setErr('Pick a symptom.'); return }
        if (symptomCode === 'other' && !trimmedNote) { setErr('Other requires a note.'); return }
        res = await createSymptom({
          recorded_at,
          symptom_code: symptomCode,
          severity: sev || null,
          note: trimmedNote,
        })
      }
      // Always also save a standalone note if the user typed one and we're not
      // already in symptom mode (where the note attaches to the symptom).
      // For now, the note attaches to the entry above; standalone notes go via
      // the dedicated Quick note panel below the segmented form (added when
      // we expand the QuickLog UX) — keep this commit tight.
      if (!res.ok) {
        setErr(res.error ?? 'Failed to save.')
        return
      }
      reset()
      setFlash(true)
      setTimeout(() => setFlash(false), 1400)
      router.refresh()
    })
  }

  async function submitStandaloneNote(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const res = await createNote({ recorded_at: new Date().toISOString(), text: trimmed })
    if (res.ok) router.refresh()
  }

  return (
    <Card className="col-5">
      <PanelHeader
        icon={<NotebookPen size={18} />}
        title="Quick log"
        source="manual"
        accent="var(--amber)"
      />
      <form className="quicklog" onSubmit={submit}>
        <div className="seg">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`seg-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => { setTab(t.id); setErr(null) }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ql-fields">
          {tab === 'weight' && (
            <label className="field">
              <span className="field-lbl">Weight</span>
              <div className="input-unit">
                <input
                  type="number" step="0.1" inputMode="decimal"
                  value={weight} onChange={(e) => setWeight(e.target.value)}
                  placeholder="88.5"
                />
                <span>kg</span>
              </div>
            </label>
          )}
          {tab === 'glucose' && (
            <label className="field">
              <span className="field-lbl">Fingerstick glucose</span>
              <div className="input-unit">
                <input
                  type="number" step="0.1" inputMode="decimal"
                  value={glucose} onChange={(e) => setGlucose(e.target.value)}
                  placeholder={glucoseUnit === 'mmol/L' ? '6.1' : '110'}
                />
                <span>{glucoseUnit}</span>
              </div>
            </label>
          )}
          {tab === 'bp' && (
            <div className="bp-fields">
              <label className="field">
                <span className="field-lbl">Systolic</span>
                <div className="input-unit">
                  <input type="number" inputMode="numeric" value={sys} onChange={(e) => setSys(e.target.value)} placeholder="122" />
                  <span>mmHg</span>
                </div>
              </label>
              <span className="bp-slash">/</span>
              <label className="field">
                <span className="field-lbl">Diastolic</span>
                <div className="input-unit">
                  <input type="number" inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} placeholder="79" />
                  <span>mmHg</span>
                </div>
              </label>
            </div>
          )}
          {tab === 'symptom' && (
            <div className="sym-fields">
              <label className="field">
                <span className="field-lbl">Symptom</span>
                <div className="select-wrap">
                  <select value={symptomCode} onChange={(e) => setSymptomCode(e.target.value)}>
                    {SYMPTOMS.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}{s.red_flag ? ' ⚠︎' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </div>
              </label>
              <label className="field">
                <span className="field-lbl">
                  Severity <span className="field-opt">(optional)</span>
                </span>
                <div className="sev-pick">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <button
                      type="button" key={i}
                      className={`sev-btn ${sev >= i ? 'on' : ''} ${sev === i ? 'sel' : ''}`}
                      onClick={() => setSev(sev === i ? 0 : i)}
                    >{i}</button>
                  ))}
                </div>
              </label>
            </div>
          )}
        </div>

        {isRedFlag && (
          <div className="redflag-banner inline">
            <AlertTriangle size={14} />
            <span>{RED_FLAG_REMINDER} You can still log it below.</span>
          </div>
        )}

        <label className="field">
          <span className="field-lbl">Quick note</span>
          <input
            className="note-input" type="text" value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tab === 'symptom' ? 'Add an optional note…' : 'Optional — attached to this entry'}
          />
        </label>

        <div className="form-err">{err}</div>

        <div className="ql-actions">
          <button type="submit" className={`btn-primary ${flash ? 'flash' : ''}`} disabled={pending}>
            {flash ? <><Check size={16} /> Added to log</> : <><Plus size={16} /> {pending ? 'Saving…' : 'Add entry'}</>}
          </button>
        </div>
      </form>

      {/* Always-visible "Quick note" as a peer path — mirrors Slice 3's UX. */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--card-border)', paddingTop: 14 }}>
        <StandaloneNote onSubmit={submitStandaloneNote} />
      </div>
    </Card>
  )
}

function StandaloneNote({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [text, setText] = useState('')
  const [pending, startTransition] = useTransition()
  function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    startTransition(async () => {
      await onSubmit(text)
      setText('')
    })
  }
  return (
    <form onSubmit={onSave} className="quicklog" style={{ gap: 10 }}>
      <span className="field-lbl">Standalone note</span>
      <textarea
        className="note-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Free-text note, not tied to a symptom…"
        style={{ resize: 'vertical' }}
      />
      <button type="submit" className="btn-primary" disabled={pending || !text.trim()}>
        <Plus size={16} /> {pending ? 'Saving…' : 'Save note'}
      </button>
    </form>
  )
}
