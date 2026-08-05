// Tiny formatting + selection helpers shared across report sections.
// Print-context: nothing that depends on locale state at runtime
// (formatted dates use en-GB style so the doctor doesn't see a US date).

import type { MarkerTrend } from '@/app/labs/actions'
import { evaluateLabMarker, type LabGoalState, type LabTarget, type LabTrendDir } from '@/app/labs/_lib/targets'

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  // timeZone pinned to GST (L9): /report is server-rendered, so without it
  // the server formats in UTC and the client re-hydrates in GST — a visible
  // 4h/one-day shift until hydration. GST is the app's canonical day.
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Dubai' })
}

export function fmtNum(v: number | null | undefined, dp: number = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(dp)
}

/**
 * LDL reduction-from-baseline label with a SIGN-CORRECT arrow (L11). Pure +
 * exported so the arrow logic is unit-testable. `reductionPct` is signed:
 *   >= 0 → LDL fell (good): "↓ N% from baseline B"
 *   <  0 → LDL ROSE:        "↑ N% above baseline B"
 * The old inline code hard-coded ↓ and rendered a rise as "↓ +12% from
 * baseline" — a down arrow on a value that went up, with reduction framing.
 */
export function ldlReductionLabel(reductionPct: number, baseline: number): string {
  const b = fmtNum(baseline, 2)
  return reductionPct >= 0
    ? `↓ ${reductionPct.toFixed(0)}% from baseline ${b}`
    : `↑ ${Math.abs(reductionPct).toFixed(0)}% above baseline ${b}`
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return Math.round(v).toString()
}

/** Stable cardiac key markers, in the order they should appear on page 1. */
export const CARDIAC_KEY_MARKERS: readonly string[] = [
  'ldl',
  'hdl',
  'non_hdl',
  'triglycerides',
  'lipoprotein_a',
  'apob',
  'hs_crp',
  'hba1c',
]

export interface CardiacLabSummary {
  slug: string
  display: string
  latest: number | null
  unit: string
  drawnAt: string | null
  refLow: number | null
  refHigh: number | null
  refSource: 'reported' | 'standard' | null
  flag: 'H' | 'L' | 'HH' | 'LL' | 'N' | null
  /** Latest minus prior; null when there isn't a prior draw. */
  delta: number | null
  /** 'up' | 'down' | 'flat' | null — mini-direction indicator. */
  direction: 'up' | 'down' | 'flat' | null
  /** Clinical target (goal-based, provisional). Null when no target set or unit mismatch. */
  target: LabTarget | null
  goalState: LabGoalState | null
  /** Resolved numeric goal-line (handles Lp(a) mg/dL↔nmol/L). */
  goalLine: number | null
  /** Toward-goal trend; null for single-draw markers. */
  goalTrend: LabTrendDir
  /** LDL %-reduction-from-baseline (only set when target.reductionGoalPct configured). */
  reductionPct: number | null
  meetsReductionGoal: boolean | null
  /** Earliest draw (used to label the LDL reduction line). */
  baseline: number | null
  /** Lp(a) / HDL are non-modifiable; render "off-goal" as informational, not actionable. */
  modifiable: boolean
  /** Set when the lab's unit can't be unit-matched to the target. */
  unmatchedReason: string | null
}

/**
 * Build the cardiac-labs row set for the page-1 table. Pulls the latest
 * draw per key marker; computes a delta vs the prior draw for the
 * direction arrow. Returns null entries pruned — markers Irfan doesn't
 * have are omitted gracefully (per spec).
 */
export function buildCardiacLabSummary(trends: MarkerTrend[]): CardiacLabSummary[] {
  const bySlug = new Map(trends.map((t) => [t.marker_slug, t]))
  const out: CardiacLabSummary[] = []
  for (const slug of CARDIAC_KEY_MARKERS) {
    const t = bySlug.get(slug)
    if (!t || t.points.length === 0) continue
    const last = t.points[t.points.length - 1]
    const prior = t.points.length >= 2 ? t.points[t.points.length - 2] : null
    let delta: number | null = null
    let direction: 'up' | 'down' | 'flat' | null = null
    if (prior) {
      delta = last.value - prior.value
      const eps = Math.abs(last.value) * 0.02 || 0.01
      direction = Math.abs(delta) < eps ? 'flat' : delta > 0 ? 'up' : 'down'
    }
    // Clinical-target evaluation — single source of truth, same call the
    // dashboard's Labs tab makes, so report ↔ dashboard agree by construction.
    const status = evaluateLabMarker(t)
    out.push({
      slug,
      display: t.display,
      latest: last.value,
      unit: last.unit ?? t.canonical_unit ?? '',
      drawnAt: last.drawn_at,
      refLow: last.ref_low,
      refHigh: last.ref_high,
      refSource: last.ref_source,
      flag: last.flag,
      delta,
      direction,
      target: status.target,
      goalState: status.goalState,
      goalLine: status.goalLine,
      goalTrend: status.trend,
      reductionPct: status.reductionPct,
      meetsReductionGoal: status.meetsReductionGoal,
      baseline: status.baseline,
      modifiable: status.modifiable,
      unmatchedReason: status.unmatchedReason,
    })
  }
  return out
}

/** Direction word for cardiac labs — "up" / "down" / "stable" / "—". */
export function directionLabel(d: 'up' | 'down' | 'flat' | null): string {
  if (d === 'up') return '↑'
  if (d === 'down') return '↓'
  if (d === 'flat') return '→'
  return '—'
}

/** Pick the latest non-null entry from a series. */
export function latestNonNull<T>(rows: T[], pick: (r: T) => number | null): { value: number; at: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = pick(rows[i])
    if (v !== null && Number.isFinite(v)) return { value: v, at: i }
  }
  return null
}
