// Calm status thresholds — ported VERBATIM from prototype-src/04-app.jsx `st.*`.
// Intentionally generous on the "watch" band; nothing here is medical advice.

import type { DriftMetricId } from './drift-config'

export type Status = 'good' | 'watch' | 'concern' | 'neutral'

export const STATUS_COLOR: Record<Status, string> = {
  good: 'var(--teal)',
  watch: 'var(--amber)',
  concern: 'var(--red)',
  neutral: 'var(--text-muted)',
}

export const st = {
  recovery: (v: number | null): Status => {
    if (v === null) return 'neutral'
    return v >= 58 ? 'good' : v >= 45 ? 'watch' : 'concern'
  },
  bp: (s: number | null, d: number | null): Status => {
    // Single source of truth: delegate to bpCategory() so the KPI dot
    // and the Cardiac panel's category readout never drift apart.
    if (s === null || d === null) return 'neutral'
    return bpCategory(s, d).status
  },
  glucose: (v: number | null): Status => {
    if (v === null) return 'neutral'
    return v >= 3.9 && v <= 10
      ? 'good'
      : (v >= 3.3 && v < 3.9) || (v > 10 && v <= 12)
      ? 'watch'
      : 'concern'
  },
  sleep: (h: number | null): Status => {
    if (h === null) return 'neutral'
    return h >= 7 ? 'good' : h >= 6 ? 'watch' : 'concern'
  },
  rhr: (v: number | null): Status => {
    if (v === null) return 'neutral'
    return v <= 68 ? 'good' : v <= 75 ? 'watch' : 'concern'
  },
  /**
   * Overnight SpO2 display band (Recovery & Sleep card).
   * Calm display only; the drift panel's clinical pill uses LOW_FLOORS.
   * ≥ 94 good · 90–93 watch · < 90 concern. Provisional, not medical advice.
   */
  spo2: (v: number | null): Status => {
    if (v === null) return 'neutral'
    return v >= 94 ? 'good' : v >= 90 ? 'watch' : 'concern'
  },
  /**
   * ODI severity display band (Overnight Oxygen panel). Standard ODI/AHI
   * severity tiers, mapped onto the calm 4-state palette:
   *   < 5  normal      → good
   *   5–<15 mild       → watch
   *   ≥ 15 moderate+   → concern (15–30 moderate; >30 severe — both rendered
   *                       as concern in the dot; the readout shows the number)
   * SCREENING ONLY — provisional pending Dr. Jose. Not a diagnosis.
   */
  odi: (v: number | null): Status => {
    if (v === null) return 'neutral'
    return v < 5 ? 'good' : v < 15 ? 'watch' : 'concern'
  },
}

// ─── Blood pressure — ACC/AHA categories (standard, not provisional) ──────
//
// Source: ACC/AHA 2017 Guideline for High Blood Pressure in Adults.
// These are population-standard categories — labelled as such on the
// dashboard. The LOW-side floors below are provisional (Dr. Jose).
//
// Used by:
//   - `bpCategory(sys, dia)` → the single source of truth for BP status.
//   - The Cardiac panel's BP trend chart, which renders these as faint
//     territory bands (diastolic in the lower y-region, systolic in the
//     upper) on a shared y-axis so each line sits in its own clinically-
//     correct zones.

export interface BpBand {
  from: number
  to: number
  color: string
  opacity?: number
  /** Short label for the territory legend; not required for render. */
  label?: string
}

/** Systolic mmHg bands (ACC/AHA). */
export const BP_SYS_BANDS: readonly BpBand[] = [
  // Low (provisional via LOW_FLOORS) → represented in the chart by leaving
  // <90 unshaded; the bpCategory + readout call it out explicitly.
  { from: 90,  to: 119, color: 'var(--teal)',  opacity: 0.06, label: 'Normal' },
  { from: 120, to: 129, color: 'var(--amber)', opacity: 0.05, label: 'Elevated' },
  { from: 130, to: 139, color: 'var(--amber)', opacity: 0.10, label: 'Stage 1' },
  { from: 140, to: 179, color: 'var(--red)',   opacity: 0.07, label: 'Stage 2' },
  { from: 180, to: 220, color: 'var(--red)',   opacity: 0.14, label: 'Crisis' },
]

/** Diastolic mmHg bands (ACC/AHA — diastolic has NO "Elevated" band). */
export const BP_DIA_BANDS: readonly BpBand[] = [
  { from: 60,  to: 79,  color: 'var(--teal)',  opacity: 0.06, label: 'Normal' },
  { from: 80,  to: 89,  color: 'var(--amber)', opacity: 0.10, label: 'Stage 1' },
  { from: 90,  to: 119, color: 'var(--red)',   opacity: 0.07, label: 'Stage 2' },
  { from: 120, to: 140, color: 'var(--red)',   opacity: 0.14, label: 'Crisis' },
]

export type BpCategory = 'normal' | 'elevated' | 'stage1' | 'stage2' | 'crisis' | 'low'

export interface BpCategoryResult {
  category: BpCategory
  label: string
  /** Calm dashboard palette colour (var(--*)) for badges + status dots. */
  color: string
  /** Matching Status enum for st.bp delegation. */
  status: Status
}

const BP_CATEGORY_LABELS: Record<BpCategory, string> = {
  normal:   'Normal',
  elevated: 'Elevated',
  stage1:   'Stage 1 hypertension',
  stage2:   'Stage 2 hypertension',
  crisis:   'Hypertensive crisis',
  low:      'Low (hypotension)',
}

const BP_CATEGORY_COLOR: Record<BpCategory, string> = {
  normal:   'var(--teal)',
  elevated: 'var(--amber)',
  stage1:   'var(--amber)',
  stage2:   'var(--red)',
  crisis:   'var(--red)',
  low:      'var(--amber)',
}

const BP_CATEGORY_STATUS: Record<BpCategory, Status> = {
  normal:   'good',
  elevated: 'watch',
  stage1:   'watch',
  stage2:   'concern',
  crisis:   'concern',
  low:      'watch',
}

/**
 * Classify a sys/dia pair into the ACC/AHA category + the added Low state.
 *
 * "Higher-severity of the two numbers wins" (the OR-logic):
 *   - Low      if sys < LOW_FLOORS.sys.floor OR dia < LOW_FLOORS.dia.floor
 *              (provisional; the only category that uses LOW_FLOORS)
 *   - Crisis   if sys > 180 OR dia > 120
 *   - Stage 2  if sys ≥ 140 OR dia ≥ 90
 *   - Stage 1  if sys 130–139 OR dia 80–89
 *   - Elevated if sys 120–129 AND dia < 80 (Elevated needs BOTH per ACC/AHA —
 *              a sys 125 with dia 85 is Stage 1, not Elevated)
 *   - Normal   otherwise
 *
 * Low takes precedence (per spec): a reading can't be both Low and
 * hypertensive at the same systolic/diastolic.
 *
 * SOURCE: ACC/AHA 2017 high-side categories (standard); low-side floors
 * from LOW_FLOORS (provisional, pending Dr. Jose).
 */
export function bpCategory(sys: number, dia: number): BpCategoryResult {
  const sysFloor = LOW_FLOORS.sys?.floor ?? 90
  const diaFloor = LOW_FLOORS.dia?.floor ?? 60

  let category: BpCategory
  if (sys < sysFloor || dia < diaFloor) {
    category = 'low'
  } else if (sys > 180 || dia > 120) {
    category = 'crisis'
  } else if (sys >= 140 || dia >= 90) {
    category = 'stage2'
  } else if ((sys >= 130 && sys <= 139) || (dia >= 80 && dia <= 89)) {
    category = 'stage1'
  } else if (sys >= 120 && sys <= 129 && dia < 80) {
    category = 'elevated'
  } else {
    category = 'normal'
  }

  return {
    category,
    label: BP_CATEGORY_LABELS[category],
    color: BP_CATEGORY_COLOR[category],
    status: BP_CATEGORY_STATUS[category],
  }
}

export const MMOL_TO_MGDL = 18.0182

export const GLUCOSE_LO = 3.9   // mmol/L
export const GLUCOSE_HI = 10.0  // mmol/L

// STEMI day — used by the recovery-day counter in the header.
// 2026-04-28, GST. Prototype hard-coded April 5 (placeholder); CLAUDE.md is canonical.
export const STEMI_DATE = new Date('2026-04-28T00:00:00+04:00')

export const RANGES = [
  { id: 7 as const, label: '7d' },
  { id: 30 as const, label: '30d' },
  { id: 90 as const, label: '90d' },
]
export type RangeId = (typeof RANGES)[number]['id']


// ─── Low-side clinical floors (Slice 7.3) ──────────────────────────────────
//
// PROVISIONAL — pending Dr. Jose. Irfan is deliberately beta-blocked + runs
// low; textbook floors are wrong for him. Each floor has a conservative
// PROVISIONAL NUMBER on day one (not null — a null floor is a dormant
// guardrail), and a per-metric caution buffer that stops the good-drift
// "Win" framing once a down-trending value approaches the floor, so it
// goes neutral/quiet as it nears the cliff instead of celebrating up to it.
//
// The Slice 7.3 panel + drift logic read these; the existing st.* status
// thresholds above are untouched (they're the population bands).

export interface LowFloor {
  /** Hard low-side clinical bound — below this, surface "low" as a concern. */
  floor: number
  /** Caution buffer width (same units): Win framing stops once value < floor + buffer. */
  cautionBuffer: number
  /** Display unit for callouts. */
  unit: string
  /** Short label for the callout. */
  label: string
}

/**
 * Low-side clinical floors. ALL provisional pending Dr. Jose. Buffer values
 * are conservative first-pass defaults — wide enough to go neutral before any
 * genuine drift toward the floor reaches the cliff.
 *
 * Typed Partial<Record<DriftMetricId, LowFloor>> so the drift evaluator can
 * look up by any DriftMetricId without per-call casts. Used by both the
 * Baselines & Drift panel (clinical-low pill) and the win-demotion rule in
 * drift/evaluate.ts.
 */
export const LOW_FLOORS: Partial<Record<DriftMetricId, LowFloor>> = {
  rhr: { floor: 50, cautionBuffer: 4, unit: 'bpm',  label: 'Resting HR low (bradycardia)' },   // textbook is <60; beta-blocked runs low — provisional <50
  sys: { floor: 90, cautionBuffer: 5, unit: 'mmHg', label: 'Systolic low (hypotension)' },     // provisional <90
  dia: { floor: 60, cautionBuffer: 4, unit: 'mmHg', label: 'Diastolic low' },                  // <60 dia compromises coronary perfusion — provisional pending Dr. Jose
  // SpO2 floors — provisional pending Dr. Jose. SpO2 < 90% is the conventional
  // hypoxemia line; healthy overnight average sits ≥ 94–95%, and brief dips
  // into the high-80s on the nightly minimum are common in mild sleep-
  // disordered breathing. Conservative starting points.
  spo2_avg: { floor: 92, cautionBuffer: 2, unit: '%', label: 'Overnight SpO2 average low' },
  spo2_min: { floor: 88, cautionBuffer: 3, unit: '%', label: 'Overnight SpO2 min low (desaturation)' },
}

/** Footer label shown wherever the LOW_FLOORS render a verdict. */
export const LOW_FLOOR_PROVISIONAL_NOTE =
  'Low-side floors are provisional — pending confirmation with Dr. Jose.'

export type ClinicalLowState = 'normal' | 'caution' | 'breach'

/**
 * Where does a value sit vs the low floor + caution buffer?
 *   value >= floor + buffer  → 'normal'           (Win framing OK)
 *   floor <= value < floor+buffer → 'caution'    (Win goes neutral)
 *   value < floor             → 'breach'          (clinical-band warning;
 *                                                  takes precedence over Win)
 *
 * Per spec §Clinical-precedence: a good-drift Win NEVER suppresses a
 * fixed clinical-band warning. Both can co-surface, with the clinical
 * warning taking precedence.
 */
export function clinicalLowState(
  value: number | null,
  floor: LowFloor | undefined
): ClinicalLowState {
  if (value === null || floor === undefined) return 'normal'
  if (value < floor.floor) return 'breach'
  if (value < floor.floor + floor.cautionBuffer) return 'caution'
  return 'normal'
}
