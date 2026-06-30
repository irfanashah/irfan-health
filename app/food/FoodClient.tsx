'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Sparkles, Trash2, Pencil, X } from 'lucide-react'
import { defaultMealLabel } from './_lib/estimate'
import { estimateMealAction, commitMeal, updateMeal, deleteMeal } from './actions'
import type { MealDraft, MealItem, MealLabel, MealRow } from './_lib/types'

interface Props {
  initialMeals: MealRow[]
  llmAvailable: boolean
}

const LABEL_ORDER: MealLabel[] = ['breakfast', 'lunch', 'dinner', 'snack']

function toLocalInput(iso: string): string {
  // datetime-local needs YYYY-MM-DDTHH:mm in LOCAL time. We display GST
  // (the user is in Dubai). Same fixed-offset trick used in lib/gst.ts.
  const d = new Date(Date.parse(iso) + 4 * 3600_000)
  return d.toISOString().slice(0, 16)
}
function fromLocalInput(local: string): string {
  // local is GST (UTC+4) — subtract 4h to get UTC ISO.
  return new Date(Date.parse(local + 'Z') - 4 * 3600_000).toISOString()
}
function fmtGst(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
function fmtGstDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
}
function gstDateKey(iso: string): string {
  return new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 10)
}

function emptyDraft(eatenAt: string): MealDraft {
  return {
    eatenAt,
    description: '',
    mealLabel: defaultMealLabel(eatenAt),
    items: [{ name: '', qty: '', carbs_g: null, protein_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null, calories: null }],
    totals: { carbs_g: 0, protein_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, calories: 0 },
    note: null,
  }
}

function recomputeTotals(items: MealItem[]): MealDraft['totals'] {
  const sum = (key: keyof MealItem): number | null => {
    let s = 0, any = false
    for (const it of items) {
      const v = (it[key] ?? null) as number | null
      if (v !== null && Number.isFinite(v)) { s += v; any = true }
    }
    return any ? Math.round(s * 10) / 10 : null
  }
  return {
    carbs_g: sum('carbs_g'),
    protein_g: sum('protein_g'),
    fat_g: sum('fat_g'),
    fiber_g: sum('fiber_g'),
    sugar_g: sum('sugar_g'),
    sodium_mg: sum('sodium_mg') === null ? null : Math.round(sum('sodium_mg') as number),
    calories: sum('calories') === null ? null : Math.round(sum('calories') as number),
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export function FoodClient({ initialMeals, llmAvailable }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  // Entry form
  const [description, setDescription] = useState('')
  const [eatenAtLocal, setEatenAtLocal] = useState(() => toLocalInput(new Date().toISOString()))

  // Review draft (post-estimate or pre-manual). null = no draft yet.
  const [draft, setDraft] = useState<MealDraft | null>(null)
  const [draftEdited, setDraftEdited] = useState(false)

  // Inline edit on a committed row.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<MealRow | null>(null)

  function showFlash(msg: string) {
    setFlash(msg)
    setError(null)
    setTimeout(() => setFlash(null), 2500)
  }

  function onEstimate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const eatenAt = fromLocalInput(eatenAtLocal)
    if (!description.trim()) { setError('Describe the meal first.'); return }
    startTransition(async () => {
      const res = await estimateMealAction(description.trim(), eatenAt)
      if (res.kind === 'ok') {
        setDraft(res.draft)
        setDraftEdited(false)
        return
      }
      if (res.missingKey) {
        // Manual fallback — empty draft, user fills in numbers by hand.
        setDraft({ ...emptyDraft(eatenAt), description: description.trim() })
        setDraftEdited(true)
        setError(res.error)
        return
      }
      setError(res.error)
    })
  }

  function onManualLog() {
    const eatenAt = fromLocalInput(eatenAtLocal)
    if (!description.trim()) { setError('Describe the meal first.'); return }
    setDraft({ ...emptyDraft(eatenAt), description: description.trim() })
    setDraftEdited(true)
  }

  function updateDraftItem(i: number, patch: Partial<MealItem>) {
    if (!draft) return
    const items = draft.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
    setDraft({ ...draft, items, totals: recomputeTotals(items) })
    setDraftEdited(true)
  }
  function addDraftItem() {
    if (!draft) return
    setDraft({
      ...draft,
      items: [...draft.items, { name: '', qty: '', carbs_g: null, protein_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null, calories: null }],
    })
    setDraftEdited(true)
  }
  function removeDraftItem(i: number) {
    if (!draft) return
    const items = draft.items.filter((_, idx) => idx !== i)
    setDraft({ ...draft, items, totals: recomputeTotals(items) })
    setDraftEdited(true)
  }
  function updateDraftTotal(key: keyof MealDraft['totals'], v: number | null) {
    if (!draft) return
    setDraft({ ...draft, totals: { ...draft.totals, [key]: v } })
    setDraftEdited(true)
  }

  function onCommit() {
    if (!draft) return
    setError(null)
    startTransition(async () => {
      const res = await commitMeal({ draft, edited: draftEdited })
      if (!res.ok) { setError(res.error ?? 'Commit failed.'); return }
      setDraft(null)
      setDraftEdited(false)
      setDescription('')
      showFlash('Logged.')
      router.refresh()
    })
  }

  function onCancelDraft() {
    setDraft(null)
    setDraftEdited(false)
  }

  function onStartEdit(m: MealRow) {
    setEditingId(m.id)
    setEditDraft({ ...m })
  }
  function onSaveEdit() {
    if (!editingId || !editDraft) return
    const m = editDraft
    setError(null)
    startTransition(async () => {
      const res = await updateMeal(editingId, {
        eatenAt: m.eaten_at,
        description: m.description,
        mealLabel: m.meal_label,
        carbs_g: m.carbs_g, protein_g: m.protein_g, fat_g: m.fat_g, fiber_g: m.fiber_g,
        sugar_g: m.sugar_g, sodium_mg: m.sodium_mg, calories: m.calories,
      })
      if (!res.ok) { setError(res.error ?? 'Update failed.'); return }
      setEditingId(null); setEditDraft(null)
      showFlash('Updated.')
      router.refresh()
    })
  }
  function onDelete(id: string) {
    if (!confirm('Delete this meal? This cannot be undone.')) return
    startTransition(async () => {
      const res = await deleteMeal(id)
      if (!res.ok) { setError(res.error ?? 'Delete failed.'); return }
      showFlash('Deleted.')
      router.refresh()
    })
  }

  // ─── Today summary ──────────────────────────────────────────────────────
  const todaySummary = useMemo(() => {
    const today = gstDateKey(new Date().toISOString())
    const todays = initialMeals.filter((m) => gstDateKey(m.eaten_at) === today)
    const sum = (k: keyof MealRow): number => {
      let s = 0
      for (const m of todays) {
        const v = m[k]
        if (typeof v === 'number' && Number.isFinite(v)) s += v
      }
      return Math.round(s * 10) / 10
    }
    return {
      n: todays.length,
      carbs_g: sum('carbs_g'),
      protein_g: sum('protein_g'),
      fat_g: sum('fat_g'),
      fiber_g: sum('fiber_g'),
      sugar_g: sum('sugar_g'),
      sodium_mg: Math.round(sum('sodium_mg')),
      calories: Math.round(sum('calories')),
    }
  }, [initialMeals])

  return (
    <div className="food-page">
      {/* Entry */}
      <section className="food-card">
        <h2 className="food-section-title">Log a meal</h2>
        <p className="food-help">
          Type the meal in plain words + time. The estimate (Sonnet) is rough — review the items + totals before you commit. Sodium is included; this is a cardiac-relevant number, but still an estimate.
        </p>
        <form onSubmit={onEstimate} className="food-form">
          <label className="food-field full">
            <span>What did you eat?</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={'e.g. "2 rotis, chicken karahi, cucumber salad — about 9pm"'}
              disabled={pending}
            />
          </label>
          <label className="food-field">
            <span>When (GST)</span>
            <input
              type="datetime-local"
              value={eatenAtLocal}
              onChange={(e) => setEatenAtLocal(e.target.value)}
              disabled={pending}
            />
          </label>
          <div className="food-actions">
            <button type="submit" disabled={pending || !description.trim()} className="food-btn primary">
              <Sparkles size={14} /> {pending ? 'Estimating…' : 'Estimate macros'}
            </button>
            {!llmAvailable && (
              <button type="button" onClick={onManualLog} disabled={pending} className="food-btn">
                Manual entry
              </button>
            )}
          </div>
        </form>
        {!llmAvailable && (
          <p className="food-warn">
            ANTHROPIC_API_KEY not set on the server — auto-estimate is unavailable. Use Manual entry to log macros by hand.
          </p>
        )}
        {error && <div className="food-error">{error}</div>}
        {flash && <div className="food-ok"><CheckCircle2 size={14} /> {flash}</div>}
      </section>

      {/* Draft review */}
      {draft && (
        <section className="food-card food-draft">
          <div className="food-draft-head">
            <h2 className="food-section-title">Review</h2>
            <span className="food-est-pill">estimate · review before commit</span>
          </div>
          {draft.note && <p className="food-help">{draft.note}</p>}

          <div className="food-draft-meta">
            <label className="food-field">
              <span>Eaten at (GST)</span>
              <input
                type="datetime-local"
                value={toLocalInput(draft.eatenAt)}
                onChange={(e) => setDraft({ ...draft, eatenAt: fromLocalInput(e.target.value) })}
              />
            </label>
            <label className="food-field">
              <span>Meal</span>
              <select
                value={draft.mealLabel}
                onChange={(e) => setDraft({ ...draft, mealLabel: e.target.value as MealLabel })}
              >
                {LABEL_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>

          <h3 className="food-sub">Items</h3>
          <div className="food-items">
            {draft.items.map((it, i) => (
              <div key={i} className="food-item">
                <input
                  className="food-item-name"
                  type="text"
                  placeholder="Item (with assumed quantity)"
                  value={it.name}
                  onChange={(e) => updateDraftItem(i, { name: e.target.value })}
                />
                <input className="food-item-qty" type="text" placeholder="qty" value={it.qty ?? ''} onChange={(e) => updateDraftItem(i, { qty: e.target.value || null })} />
                <input className="food-item-num" type="number" step="0.1" placeholder="carbs g" value={it.carbs_g ?? ''} onChange={(e) => updateDraftItem(i, { carbs_g: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="food-item-num" type="number" step="0.1" placeholder="protein g" value={it.protein_g ?? ''} onChange={(e) => updateDraftItem(i, { protein_g: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="food-item-num" type="number" step="0.1" placeholder="fat g" value={it.fat_g ?? ''} onChange={(e) => updateDraftItem(i, { fat_g: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="food-item-num" type="number" step="0.1" placeholder="fiber g" value={it.fiber_g ?? ''} onChange={(e) => updateDraftItem(i, { fiber_g: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="food-item-num" type="number" step="0.1" placeholder="sugar g" value={it.sugar_g ?? ''} onChange={(e) => updateDraftItem(i, { sugar_g: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="food-item-num" type="number" step="1" placeholder="sodium mg" value={it.sodium_mg ?? ''} onChange={(e) => updateDraftItem(i, { sodium_mg: e.target.value === '' ? null : Number(e.target.value) })} />
                <input className="food-item-num" type="number" step="1" placeholder="kcal" value={it.calories ?? ''} onChange={(e) => updateDraftItem(i, { calories: e.target.value === '' ? null : Number(e.target.value) })} />
                <button type="button" className="food-icon-btn" onClick={() => removeDraftItem(i)} title="Remove item">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="food-btn ghost" onClick={addDraftItem}>+ Add item</button>
          </div>

          <h3 className="food-sub">Totals (auto-summed; editable)</h3>
          <div className="food-totals">
            <TotalsField label="Carbs (g)" value={draft.totals.carbs_g} onChange={(v) => updateDraftTotal('carbs_g', v)} />
            <TotalsField label="Protein (g)" value={draft.totals.protein_g} onChange={(v) => updateDraftTotal('protein_g', v)} />
            <TotalsField label="Fat (g)" value={draft.totals.fat_g} onChange={(v) => updateDraftTotal('fat_g', v)} />
            <TotalsField label="Fiber (g)" value={draft.totals.fiber_g} onChange={(v) => updateDraftTotal('fiber_g', v)} />
            <TotalsField label="Sugar (g)" value={draft.totals.sugar_g} onChange={(v) => updateDraftTotal('sugar_g', v)} />
            <TotalsField label="Sodium (mg)" value={draft.totals.sodium_mg} onChange={(v) => updateDraftTotal('sodium_mg', v)} integer />
            <TotalsField label="Calories" value={draft.totals.calories} onChange={(v) => updateDraftTotal('calories', v)} integer />
          </div>

          <div className="food-actions">
            <button type="button" disabled={pending} className="food-btn primary" onClick={onCommit}>
              {pending ? 'Saving…' : 'Commit meal'}
            </button>
            <button type="button" disabled={pending} className="food-btn ghost" onClick={onCancelDraft}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Today summary */}
      {todaySummary.n > 0 && (
        <section className="food-card">
          <h2 className="food-section-title">Today ({todaySummary.n} meal{todaySummary.n === 1 ? '' : 's'})</h2>
          <p className="food-help">Approximate totals — estimates, not clinical counts.</p>
          <div className="food-summary">
            <SummaryStat label="Carbs" value={`${todaySummary.carbs_g} g`} />
            <SummaryStat label="Protein" value={`${todaySummary.protein_g} g`} />
            <SummaryStat label="Fat" value={`${todaySummary.fat_g} g`} />
            <SummaryStat label="Fiber" value={`${todaySummary.fiber_g} g`} />
            <SummaryStat label="Sugar" value={`${todaySummary.sugar_g} g`} />
            <SummaryStat label="Sodium" value={`${todaySummary.sodium_mg} mg`} />
            <SummaryStat label="Calories" value={`${todaySummary.calories} kcal`} />
          </div>
        </section>
      )}

      {/* Diary */}
      <section className="food-card">
        <h2 className="food-section-title">Recent meals</h2>
        {initialMeals.length === 0 ? (
          <div className="food-empty">No meals logged in the last 7 days. Log one above to start tracking.</div>
        ) : (
          <ul className="food-diary">
            {initialMeals.map((m) => (
              <li key={m.id} className="food-meal">
                {editingId === m.id && editDraft ? (
                  <div className="food-edit">
                    <input type="datetime-local" value={toLocalInput(editDraft.eaten_at)} onChange={(e) => setEditDraft({ ...editDraft, eaten_at: fromLocalInput(e.target.value) })} />
                    <input type="text" value={editDraft.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} />
                    <select value={editDraft.meal_label ?? 'snack'} onChange={(e) => setEditDraft({ ...editDraft, meal_label: e.target.value as MealLabel })}>
                      {LABEL_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <input type="number" step="0.1" placeholder="carbs" value={editDraft.carbs_g ?? ''} onChange={(e) => setEditDraft({ ...editDraft, carbs_g: e.target.value === '' ? null : Number(e.target.value) })} />
                    <input type="number" step="1" placeholder="sodium" value={editDraft.sodium_mg ?? ''} onChange={(e) => setEditDraft({ ...editDraft, sodium_mg: e.target.value === '' ? null : Number(e.target.value) })} />
                    <input type="number" step="1" placeholder="kcal" value={editDraft.calories ?? ''} onChange={(e) => setEditDraft({ ...editDraft, calories: e.target.value === '' ? null : Number(e.target.value) })} />
                    <button type="button" className="food-btn primary" onClick={onSaveEdit} disabled={pending}>Save</button>
                    <button type="button" className="food-btn ghost" onClick={() => { setEditingId(null); setEditDraft(null) }} disabled={pending}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="food-meal-head">
                      <span className="food-meal-when">{fmtGst(m.eaten_at)}</span>
                      <span className="food-meal-label">{m.meal_label ?? 'meal'}</span>
                      {m.edited && <span className="food-meal-tag" title="You edited the LLM estimate">edited</span>}
                    </div>
                    <div className="food-meal-desc">{m.description}</div>
                    <div className="food-meal-macros">
                      <span>{m.carbs_g ?? '—'} C</span>
                      <span>{m.protein_g ?? '—'} P</span>
                      <span>{m.fat_g ?? '—'} F</span>
                      <span>{m.fiber_g ?? '—'} Fb</span>
                      <span>{m.sugar_g ?? '—'} S</span>
                      <span>{m.sodium_mg ?? '—'} Na (mg)</span>
                      <span>{m.calories ?? '—'} kcal</span>
                    </div>
                    <div className="food-meal-actions">
                      <button type="button" className="food-btn ghost" onClick={() => onStartEdit(m)}>
                        <Pencil size={12} /> Edit
                      </button>
                      <button type="button" className="food-btn ghost danger" onClick={() => onDelete(m.id)}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="food-foot">
          Macros are LLM estimates — for relative day-to-day patterns the correlation engine reads, not clinical macro-counting or insulin dosing. The engine surfaces patterns; it never tells you what to eat.
        </p>
      </section>
    </div>
  )
}

function TotalsField({
  label, value, onChange, integer = false,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  integer?: boolean
}) {
  return (
    <label className="food-total">
      <span>{label}</span>
      <input
        type="number"
        step={integer ? '1' : '0.1'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="food-summary-stat">
      <span className="food-summary-label">{label}</span>
      <span className="food-summary-val">{value}</span>
    </div>
  )
}

// `fmtGstDate` is exposed for the page; suppress unused-warning if unreferenced.
void fmtGstDate
