'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Anchor, Calendar, Pill, X } from 'lucide-react'
import {
  addContextPeriodAction,
  addMedChangeAction,
  deactivateContextPeriodAction,
  deactivateMedChangeAction,
  previewAnchorAction,
  setAnchorAction,
  type AnchorPreviewRow,
} from './actions'
import { DRIFT_CONFIG, DRIFT_METRICS, type DriftMetricId } from '@/components/dashboard/drift-config'

type ContextType = 'ramadan' | 'travel' | 'illness' | 'other' | 'anomaly'

interface AnchorRow { id: string; source_start: string; source_end: string; set_at: string; note: string | null; active: boolean }
interface ContextRow { id: string; start_date: string; end_date: string; type: ContextType; suppress_alerts: boolean; exclude_from_baseline: boolean; note: string | null; active: boolean; created_at: string }
interface MedRow { id: string; change_date: string; label: string; affected_metrics: string[]; note: string | null; active: boolean; created_at: string }

interface Props {
  anchors: AnchorRow[]
  contexts: ContextRow[]
  medChanges: MedRow[]
}

export function BaselinesClient({ anchors, contexts, medChanges }: Props) {
  return (
    <>
      <section className="card col-12">
        <SetAnchorForm />
        <AnchorHistory anchors={anchors} />
      </section>

      <section className="card col-7">
        <ContextPeriodForm />
        <ContextHistory contexts={contexts} />
      </section>

      <section className="card col-5">
        <MedChangeForm />
        <MedChangeHistory medChanges={medChanges} />
      </section>
    </>
  )
}

// ─── Set anchor ────────────────────────────────────────────────────────────

function SetAnchorForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Lazy initializers — computed exactly once at mount, not recomputed (and
  // discarded) on every re-render the way a plain `const` here would be.
  const [start, setStart] = useState(() => new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10))
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<AnchorPreviewRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  function onPreview() {
    setErr(null); setOk(false)
    startTransition(async () => {
      const res = await previewAnchorAction(start, end)
      if (!res.ok) { setErr(res.error ?? 'Preview failed.'); setPreview(null); return }
      setPreview(res.stats ?? [])
    })
  }

  function onFreeze() {
    setErr(null); setOk(false)
    if (!window.confirm('Freeze this window as the active anchor? The prior anchor will be archived (active=false), never deleted.')) return
    startTransition(async () => {
      const res = await setAnchorAction(start, end, note.trim() || null)
      if (!res.ok) { setErr(res.error ?? 'Set anchor failed.'); return }
      setOk(true)
      setPreview(null)
      setNote('')
      router.refresh()
    })
  }

  return (
    <div>
      <div className="panel-head">
        <div className="panel-head-l">
          <span className="panel-icon" style={{ color: 'var(--teal)' }}><Anchor size={18} /></span>
          <h2 className="panel-title">Set anchor</h2>
        </div>
        <span className="muted-note">Pick a clean post-rehab window → preview → freeze</span>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ minWidth: 160 }}>
          <span className="field-lbl">Start</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
            className="note-input" />
        </label>
        <label className="field" style={{ minWidth: 160 }}>
          <span className="field-lbl">End</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
            className="note-input" />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span className="field-lbl">Note <span className="field-opt">(optional)</span></span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. post-rehab stable month, all meds settled"
            className="note-input" />
        </label>
        <button type="button" className="chip" onClick={onPreview} disabled={pending}>
          {pending ? 'Computing…' : 'Preview'}
        </button>
        <button type="button" className="btn-primary" onClick={onFreeze}
          disabled={pending || !preview || preview.length === 0}>
          Freeze as active anchor
        </button>
      </div>

      {err && <p className="form-err" style={{ marginTop: 8 }}>{err}</p>}
      {ok && <p style={{ color: 'var(--teal)', fontSize: 12.5, marginTop: 8, fontWeight: 600 }}>Anchor frozen.</p>}

      {preview && (
        <div style={{ marginTop: 14, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 480 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '6px 12px 6px 0' }}>Metric</th>
                <th style={{ padding: '6px 12px' }}>Median</th>
                <th style={{ padding: '6px 12px' }}>MAD</th>
                <th style={{ padding: '6px 12px' }}>n</th>
                <th style={{ padding: '6px 12px' }}>Frozen?</th>
              </tr>
            </thead>
            <tbody>
              {preview.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 8, color: 'var(--text-dim)' }}>No data in the chosen window.</td></tr>
              ) : (
                preview.map((row) => {
                  const cfg = DRIFT_CONFIG[row.metric as DriftMetricId]
                  const dp = cfg?.unit === 'mmol/L' ? 1 : 0
                  const willFreeze = row.n >= 5
                  return (
                    <tr key={row.metric} style={{ borderTop: '1px solid var(--card-border)' }}>
                      <td style={{ padding: '6px 12px 6px 0', fontWeight: 600 }}>{cfg?.label ?? row.metric}</td>
                      <td style={{ padding: '6px 12px', fontVariantNumeric: 'tabular-nums' }}>{row.median.toFixed(dp)} {cfg?.unit ?? ''}</td>
                      <td style={{ padding: '6px 12px', fontVariantNumeric: 'tabular-nums' }}>{row.mad.toFixed(dp + 1)}</td>
                      <td style={{ padding: '6px 12px', fontVariantNumeric: 'tabular-nums' }}>{row.n}</td>
                      <td style={{ padding: '6px 12px', color: willFreeze ? 'var(--teal)' : 'var(--text-dim)' }}>
                        {willFreeze ? 'yes' : 'no (n<5)'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          <p className="muted-note" style={{ marginTop: 8 }}>
            Only metrics with n ≥ 5 in this window will be frozen — partial anchors are valid.
            You can re-preview a different window before freezing.
          </p>
        </div>
      )}
    </div>
  )
}

function AnchorHistory({ anchors }: { anchors: AnchorRow[] }) {
  if (anchors.length === 0) return null
  return (
    <div style={{ marginTop: 18 }}>
      <h3 className="panel-title" style={{ fontSize: 13, marginBottom: 6 }}>Anchor history</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {anchors.map((a) => (
          <li key={a.id} style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 0', borderTop: '1px solid var(--card-border)', fontSize: 12.5,
          }}>
            <span style={{ fontWeight: 700, color: a.active ? 'var(--teal)' : 'var(--text-dim)' }}>
              {a.active ? 'ACTIVE' : 'archived'}
            </span>
            <span>{a.source_start} → {a.source_end}</span>
            <span className="muted-note">set {new Date(a.set_at).toLocaleDateString([], { timeZone: 'Asia/Dubai' })}</span>
            {a.note && <span style={{ color: 'var(--text-muted)' }}>· {a.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Context period form ───────────────────────────────────────────────────

const CONTEXT_TYPES: ContextType[] = ['ramadan', 'travel', 'illness', 'other', 'anomaly']

function ContextPeriodForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const today = new Date().toISOString().slice(0, 10)
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [type, setType] = useState<ContextType>('illness')
  const [suppressAlerts, setSuppressAlerts] = useState(true)
  const [excludeFromBaseline, setExcludeFromBaseline] = useState(true)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    startTransition(async () => {
      const res = await addContextPeriodAction({
        start_date: start, end_date: end, type,
        suppress_alerts: suppressAlerts, exclude_from_baseline: excludeFromBaseline,
        note: note.trim() || null,
      })
      if (!res.ok) { setErr(res.error ?? 'Failed to save.'); return }
      setStart(today); setEnd(today); setType('illness'); setNote('')
      setSuppressAlerts(true); setExcludeFromBaseline(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="panel-head">
        <div className="panel-head-l">
          <span className="panel-icon" style={{ color: 'var(--amber)' }}><Calendar size={18} /></span>
          <h2 className="panel-title">Add context period</h2>
        </div>
        <span className="muted-note">Multi-day defaults both flags true</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <label className="field">
          <span className="field-lbl">Start</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="note-input" />
        </label>
        <label className="field">
          <span className="field-lbl">End</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="note-input" />
        </label>
        <label className="field">
          <span className="field-lbl">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as ContextType)} className="note-input">
            {CONTEXT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
          <input type="checkbox" checked={excludeFromBaseline} onChange={(e) => setExcludeFromBaseline(e.target.checked)} />
          Exclude from baseline
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
          <input type="checkbox" checked={suppressAlerts} onChange={(e) => setSuppressAlerts(e.target.checked)} />
          Suppress alerts
        </label>
      </div>

      <label className="field" style={{ marginTop: 10 }}>
        <span className="field-lbl">Note <span className="field-opt">(optional)</span></span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="note-input"
          placeholder="e.g. Ramadan, work trip, mild cold" />
      </label>

      <div style={{ marginTop: 12 }}>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Add context period'}
        </button>
      </div>
      {err && <p className="form-err" style={{ marginTop: 6 }}>{err}</p>}
    </form>
  )
}

function ContextHistory({ contexts }: { contexts: ContextRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  if (contexts.length === 0) return null
  function onDeactivate(id: string) {
    if (!window.confirm('Deactivate this context period? Past row stays for history; future days stop being suppressed/excluded.')) return
    startTransition(async () => { await deactivateContextPeriodAction(id); router.refresh() })
  }
  return (
    <div style={{ marginTop: 18 }}>
      <h3 className="panel-title" style={{ fontSize: 13, marginBottom: 6 }}>Recent context periods</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {contexts.map((c) => (
          <li key={c.id} style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 0', borderTop: '1px solid var(--card-border)', fontSize: 12.5,
          }}>
            <span style={{ fontWeight: 700, color: c.active ? 'var(--amber)' : 'var(--text-dim)' }}>
              {c.active ? c.type : `${c.type} (inactive)`}
            </span>
            <span>{c.start_date} → {c.end_date}</span>
            <span className="muted-note">
              {c.exclude_from_baseline ? '· excludes baseline' : ''} {c.suppress_alerts ? '· suppresses alerts' : ''}
            </span>
            {c.note && <span style={{ color: 'var(--text-muted)' }}>· {c.note}</span>}
            {c.active && (
              <button type="button" onClick={() => onDeactivate(c.id)} disabled={pending}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <X size={12} /> deactivate
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Med change form ───────────────────────────────────────────────────────

const BP_HR_PRESET: DriftMetricId[] = ['rhr', 'sys', 'dia']

function MedChangeForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const today = new Date().toISOString().slice(0, 10)
  const [changeDate, setChangeDate] = useState(today)
  const [label, setLabel] = useState('')
  const [affected, setAffected] = useState<Set<DriftMetricId>>(new Set())
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function toggle(m: DriftMetricId) {
    setAffected((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m); else next.add(m)
      return next
    })
  }
  function applyPreset() {
    setAffected(new Set(BP_HR_PRESET))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    startTransition(async () => {
      const res = await addMedChangeAction({
        change_date: changeDate,
        label: label.trim(),
        affected_metrics: Array.from(affected),
        note: note.trim() || null,
      })
      if (!res.ok) { setErr(res.error ?? 'Failed to save.'); return }
      setChangeDate(today); setLabel(''); setAffected(new Set()); setNote('')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="panel-head">
        <div className="panel-head-l">
          <span className="panel-icon" style={{ color: 'var(--purple)' }}><Pill size={18} /></span>
          <h2 className="panel-title">Add med change</h2>
        </div>
        <span className="muted-note">Resets rolling baseline · never touches anchor</span>
      </div>

      <label className="field">
        <span className="field-lbl">Change date</span>
        <input type="date" value={changeDate} onChange={(e) => setChangeDate(e.target.value)} className="note-input" />
      </label>

      <label className="field" style={{ marginTop: 8 }}>
        <span className="field-lbl">Label</span>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className="note-input"
          placeholder="e.g. bisoprolol 5→2.5mg" />
      </label>

      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className="field-lbl">Affected metrics</span>
          <button type="button" className="chip" onClick={applyPreset}>BP / HR preset</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DRIFT_METRICS.map((m) => (
            <button key={m} type="button"
              onClick={() => toggle(m)}
              className={`chip ${affected.has(m) ? 'active' : ''}`}
            >
              {DRIFT_CONFIG[m].short}
            </button>
          ))}
        </div>
      </div>

      <label className="field" style={{ marginTop: 10 }}>
        <span className="field-lbl">Note <span className="field-opt">(optional)</span></span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="note-input" />
      </label>

      <div style={{ marginTop: 12 }}>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Saving…' : 'Add med change'}
        </button>
      </div>
      {err && <p className="form-err" style={{ marginTop: 6 }}>{err}</p>}
      <p className="muted-note" style={{ marginTop: 8 }}>
        Affected metrics will revert to <i>establishing</i> until ~28 days of post-change data accrue — that&apos;s intended; you may want to set a fresh anchor after the new dose stabilises.
      </p>
    </form>
  )
}

function MedChangeHistory({ medChanges }: { medChanges: MedRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  if (medChanges.length === 0) return null
  function onDeactivate(id: string) {
    if (!window.confirm('Deactivate this med change? The reset stops applying to future windows.')) return
    startTransition(async () => { await deactivateMedChangeAction(id); router.refresh() })
  }
  return (
    <div style={{ marginTop: 18 }}>
      <h3 className="panel-title" style={{ fontSize: 13, marginBottom: 6 }}>Recent med changes</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {medChanges.map((m) => (
          <li key={m.id} style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 0', borderTop: '1px solid var(--card-border)', fontSize: 12.5,
          }}>
            <span style={{ fontWeight: 700, color: m.active ? 'var(--purple)' : 'var(--text-dim)' }}>
              {m.active ? 'ACTIVE' : 'inactive'}
            </span>
            <span>{m.change_date}</span>
            <span style={{ fontWeight: 600 }}>{m.label}</span>
            <span className="muted-note">→ {m.affected_metrics.join(', ')}</span>
            {m.note && <span style={{ color: 'var(--text-muted)' }}>· {m.note}</span>}
            {m.active && (
              <button type="button" onClick={() => onDeactivate(m.id)} disabled={pending}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <X size={12} /> deactivate
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
