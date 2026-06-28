// Clinical-target tracking for the cardiac-first lab markers.
//
// This is NOT the daily MAD drift engine (migration_004 / drift-config /
// evaluate.ts). Lab draws are episodic — quarterly LDL doesn't fit a
// 7-of-14-days persistence gate. Instead we ask the question a
// cardiologist actually asks: "are you at goal, and which way are you
// moving?"
//
// All targets here are GUIDELINE-BASED population goals for a very-high-
// risk secondary-prevention patient (post-STEMI, stented) — sourced from
// ESC/EAS 2019 dyslipidaemia + standard cardiology references. They are
// provisional pending Dr. Jose; render with the LAB_TARGET_PROVISIONAL_NOTE
// so they never read as a personal prescription. Informational, not
// diagnostic. (Same pattern as LOW_FLOOR_PROVISIONAL_NOTE in thresholds.ts.)
//
// Lp(a) + HDL are intentionally flagged `modifiable: false` — Lp(a) is a
// fixed genetic risk marker; HDL isn't a treatment target. An "off-goal"
// on those must not surface as an action item.

import type { MarkerTrend, MarkerTrendPoint } from '@/app/labs/actions'

export type GoalDirection = 'lower' | 'higher' | 'range'
export type LabGoalState = 'at-goal' | 'near' | 'off-goal'
export type LabTrendDir = 'improving' | 'worsening' | 'flat' | null

export interface LabTarget {
  slug: string
  goalDirection: GoalDirection
  /** Primary numeric target for 'lower' / 'higher'. */
  target?: number
  /** Range lower bound for 'range' (e.g. hba1c at-goal band lower; usually -Infinity isn't useful, so left undefined and the evaluator treats below targetLow as at-goal). */
  targetLow?: number
  /** Range upper bound for 'range' (e.g. hba1c at-goal upper = 5.7%). */
  targetHigh?: number
  /** Watch-band upper for 'range' (e.g. hba1c watch upper = 6.4%) — between targetHigh and watchHigh = "near". */
  watchHigh?: number
  /** Unit the primary `target` is expressed in (must match the value unit after norm()). */
  unit: string
  /**
   * Alternate-unit thresholds for markers that come in multiple reported
   * units (Lp(a): mg/dL ↔ nmol/L is assay-dependent). Keyed by normalised
   * unit. evaluateLabMarker picks the threshold whose key matches the
   * point's unit; if nothing matches, goalState stays null + a note.
   */
  targetByUnit?: Record<string, number>
  /** Width of the "near goal" zone — sensible per-marker (~10–15% of target). */
  nearBuffer: number
  /** When set, also compute % reduction from earliest draw + report meetsReductionGoal. */
  reductionGoalPct?: number
  /** Short clinical label, e.g. "< 1.4 mmol/L (very-high-risk)". */
  label: string
  /** false → Lp(a)/HDL: frame as informational, never as an action item. */
  modifiable: boolean
  provisional: true
}

export const LAB_TARGET_PROVISIONAL_NOTE =
  'Targets are guideline-based for very-high-risk secondary prevention (ESC/EAS 2019 + standard cardiology references). Provisional — confirm with Dr. Jose. Informational, not diagnostic.'

// Same lowercase-no-space normalisation markers.ts uses. Reused so unit
// matching in evaluateLabMarker is identical to the conversion layer.
const norm = (u: string): string => u.toLowerCase().replace(/\s+/g, '').replace('μ', 'u')

export const LAB_TARGETS: Record<string, LabTarget> = {
  ldl: {
    slug: 'ldl',
    goalDirection: 'lower',
    target: 1.4,
    unit: 'mmol/L',
    nearBuffer: 0.2,
    reductionGoalPct: 50,
    label: '< 1.4 mmol/L · ≥50% reduction from baseline',
    modifiable: true,
    provisional: true,
  },
  non_hdl: {
    slug: 'non_hdl',
    goalDirection: 'lower',
    target: 2.2,
    unit: 'mmol/L',
    nearBuffer: 0.3,
    label: '< 2.2 mmol/L (very-high-risk)',
    modifiable: true,
    provisional: true,
  },
  apob: {
    slug: 'apob',
    goalDirection: 'lower',
    target: 0.65,
    unit: 'g/L',
    nearBuffer: 0.08,
    label: '< 0.65 g/L (very-high-risk)',
    modifiable: true,
    provisional: true,
  },
  triglycerides: {
    slug: 'triglycerides',
    goalDirection: 'lower',
    target: 1.7,
    unit: 'mmol/L',
    nearBuffer: 0.2,
    label: '< 1.7 mmol/L (fasting)',
    modifiable: true,
    provisional: true,
  },
  lipoprotein_a: {
    slug: 'lipoprotein_a',
    goalDirection: 'lower',
    // Primary stored as mg/dL; nmol/L threshold held in targetByUnit.
    // Lp(a) mg/dL↔nmol/L is assay-dependent (gotcha #90) — never coerce;
    // the evaluator picks the threshold whose unit matches the reported
    // point's unit, else returns goalState=null + a "unit not matched" note.
    target: 50,
    unit: 'mg/dL',
    targetByUnit: {
      'mg/dl': 50,
      'nmol/l': 125,
    },
    nearBuffer: 10, // mg/dL — nmol/L "near" buffer roughly scales: see resolveTarget()
    label: '< 50 mg/dL (≈ < 125 nmol/L) — genetic risk threshold',
    modifiable: false,
    provisional: true,
  },
  hs_crp: {
    slug: 'hs_crp',
    goalDirection: 'lower',
    target: 2.0,
    unit: 'mg/L',
    nearBuffer: 0.5,
    label: '< 2.0 mg/L (< 1.0 optimal)',
    modifiable: true,
    provisional: true,
  },
  hba1c: {
    // Range banding: at-goal in [-∞, 5.7]; near in (5.7, 6.4]; off > 6.4.
    slug: 'hba1c',
    goalDirection: 'range',
    targetHigh: 5.7,
    watchHigh: 6.4,
    unit: '%',
    nearBuffer: 0,
    label: '< 5.7% optimal · 5.7–6.4 watch · ≥ 6.5 high',
    modifiable: true,
    provisional: true,
  },
  hdl: {
    slug: 'hdl',
    goalDirection: 'higher',
    target: 1.0,
    unit: 'mmol/L',
    nearBuffer: 0.1,
    label: '> 1.0 mmol/L (men) — informational',
    modifiable: false,
    provisional: true,
  },
}

export const CARDIAC_TARGET_SLUGS = Object.keys(LAB_TARGETS)

export interface LabMarkerStatus {
  slug: string
  display: string
  unit: string
  latest: number | null
  drawnAt: string | null
  /** Prior draw (chronologically second-to-last). */
  prior: number | null
  /** latest − prior. */
  delta: number | null
  /** % change vs prior. */
  deltaPct: number | null
  /** Toward-goal-aware: 'improving' if moving toward target, 'worsening' if away. */
  trend: LabTrendDir
  /** null when no target set, no latest, or unit doesn't match the target. */
  goalState: LabGoalState | null
  /** The target the latest was scored against, or null if no usable target. */
  target: LabTarget | null
  /** Numeric threshold actually used (after unit-match resolution) — for chart goal-line. */
  goalLine: number | null
  /** Signed distance to target (0 when at/past goal). */
  gapToGoal: number | null
  /** Earliest draw (used for LDL % reduction). */
  baseline: number | null
  /** (baseline − latest) / baseline × 100 — only set when reductionGoalPct is configured. */
  reductionPct: number | null
  meetsReductionGoal: boolean | null
  /** Human-readable note when goalState is null (e.g. unit not matched). */
  unmatchedReason: string | null
  /** Convenience: false for Lp(a)/HDL — informational only. */
  modifiable: boolean
}

interface ResolvedTarget {
  goalLine: number | null
  unit: string
  unmatchedReason: string | null
}

/**
 * Pick the right numeric threshold for a point's unit. Handles the Lp(a)
 * mg/dL↔nmol/L case via targetByUnit; otherwise checks the primary unit.
 * Returns goalLine=null when nothing matches — never coerces.
 */
function resolveTarget(t: LabTarget, pointUnit: string): ResolvedTarget {
  const p = norm(pointUnit)
  if (t.targetByUnit) {
    const v = t.targetByUnit[p]
    if (v !== undefined) return { goalLine: v, unit: pointUnit, unmatchedReason: null }
    return { goalLine: null, unit: pointUnit, unmatchedReason: `Lab reported in "${pointUnit}"; target thresholds known for ${Object.keys(t.targetByUnit).join(' / ')}.` }
  }
  if (t.target !== undefined && p === norm(t.unit)) {
    return { goalLine: t.target, unit: pointUnit, unmatchedReason: null }
  }
  if (t.goalDirection === 'range' && t.targetHigh !== undefined && p === norm(t.unit)) {
    return { goalLine: t.targetHigh, unit: pointUnit, unmatchedReason: null }
  }
  return { goalLine: null, unit: pointUnit, unmatchedReason: `Lab reported in "${pointUnit}"; target expressed in ${t.unit}.` }
}

/** Direction of movement toward the goal. Flat within ~2% of latest magnitude. */
function trendTowardGoal(
  latest: number,
  prior: number,
  direction: GoalDirection,
): LabTrendDir {
  const eps = Math.abs(latest) * 0.02 || 0.01
  if (Math.abs(latest - prior) < eps) return 'flat'
  if (direction === 'lower') return latest < prior ? 'improving' : 'worsening'
  if (direction === 'higher') return latest > prior ? 'improving' : 'worsening'
  // 'range' — for hba1c, getting LOWER toward / into the optimal band is improving.
  return latest < prior ? 'improving' : 'worsening'
}

function goalStateLower(value: number, goal: number, near: number): LabGoalState {
  if (value <= goal) return 'at-goal'
  if (value <= goal + near) return 'near'
  return 'off-goal'
}

function goalStateHigher(value: number, goal: number, near: number): LabGoalState {
  if (value >= goal) return 'at-goal'
  if (value >= goal - near) return 'near'
  return 'off-goal'
}

function goalStateRange(value: number, t: LabTarget): LabGoalState {
  // hba1c-style: at-goal ≤ targetHigh, near in (targetHigh, watchHigh], else off.
  if (t.targetHigh !== undefined && value <= t.targetHigh) {
    if (t.targetLow === undefined || value >= t.targetLow) return 'at-goal'
    return 'off-goal' // below an explicit floor
  }
  if (t.watchHigh !== undefined && value <= t.watchHigh) return 'near'
  return 'off-goal'
}

/**
 * Pure function. Evaluates a marker trend against its clinical target.
 *
 * Returns goalState=null (not a guess) when:
 *   - no target configured for the slug
 *   - no numeric latest value
 *   - the point's unit doesn't match any target threshold (see resolveTarget)
 *
 * Trend is toward-goal-aware: for a 'lower' marker a falling value is
 * 'improving'; needs ≥2 draws else trend stays null (sparse-safe, gotcha #76).
 */
export function evaluateLabMarker(trend: MarkerTrend): LabMarkerStatus {
  const t = LAB_TARGETS[trend.marker_slug]
  const points: MarkerTrendPoint[] = trend.points
  const last = points.length > 0 ? points[points.length - 1] : null
  const prior = points.length >= 2 ? points[points.length - 2] : null
  const baseline = points.length > 0 ? points[0] : null
  const latest = last ? last.value : null
  const drawnAt = last ? last.drawn_at : null

  // Δ / Δ% / trend — independent of target presence (still useful as a
  // direction signal even when no target is configured).
  let delta: number | null = null
  let deltaPct: number | null = null
  let trendDir: LabTrendDir = null
  if (latest !== null && prior !== null) {
    delta = latest - prior.value
    deltaPct = prior.value !== 0 ? (delta / prior.value) * 100 : null
    if (t) trendDir = trendTowardGoal(latest, prior.value, t.goalDirection)
  }

  // No target → return Δ/trend only, goalState null. Still useful as a
  // trend card for any non-cardiac marker that flows through this helper.
  if (!t || latest === null || !last) {
    return {
      slug: trend.marker_slug,
      display: trend.display,
      unit: last?.unit ?? trend.canonical_unit ?? '',
      latest,
      drawnAt,
      prior: prior?.value ?? null,
      delta,
      deltaPct,
      trend: trendDir,
      goalState: null,
      target: t ?? null,
      goalLine: null,
      gapToGoal: null,
      baseline: baseline?.value ?? null,
      reductionPct: null,
      meetsReductionGoal: null,
      unmatchedReason: !t ? null : 'No latest value.',
      modifiable: t?.modifiable ?? true,
    }
  }

  const resolved = resolveTarget(t, last.unit)
  let goalState: LabGoalState | null = null
  let gapToGoal: number | null = null

  if (resolved.goalLine !== null) {
    if (t.goalDirection === 'lower') {
      goalState = goalStateLower(latest, resolved.goalLine, t.nearBuffer)
      gapToGoal = Math.max(0, latest - resolved.goalLine)
    } else if (t.goalDirection === 'higher') {
      goalState = goalStateHigher(latest, resolved.goalLine, t.nearBuffer)
      gapToGoal = Math.max(0, resolved.goalLine - latest)
    } else {
      goalState = goalStateRange(latest, t)
      gapToGoal = t.targetHigh !== undefined ? Math.max(0, latest - t.targetHigh) : null
    }
  }

  // LDL ≥50% reduction from baseline. Caveat: baseline = earliest draw in
  // the data — if that draw is already on-statin, the % understates the
  // true pre-treatment-to-now reduction. Informational, not a pass/fail
  // gate. (Per spec §3.)
  let reductionPct: number | null = null
  let meetsReductionGoal: boolean | null = null
  if (t.reductionGoalPct !== undefined && baseline && baseline.value > 0 && latest !== null) {
    reductionPct = ((baseline.value - latest) / baseline.value) * 100
    meetsReductionGoal = reductionPct >= t.reductionGoalPct
  }

  return {
    slug: trend.marker_slug,
    display: trend.display,
    unit: last.unit,
    latest,
    drawnAt,
    prior: prior?.value ?? null,
    delta,
    deltaPct,
    trend: trendDir,
    goalState,
    target: t,
    goalLine: resolved.goalLine,
    gapToGoal,
    baseline: baseline?.value ?? null,
    reductionPct,
    meetsReductionGoal,
    unmatchedReason: resolved.unmatchedReason,
    modifiable: t.modifiable,
  }
}
