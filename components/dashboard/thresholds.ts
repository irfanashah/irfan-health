// Calm status thresholds — ported VERBATIM from prototype-src/04-app.jsx `st.*`.
// Intentionally generous on the "watch" band; nothing here is medical advice.

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
    if (s === null || d === null) return 'neutral'
    return s < 130 && d < 85 ? 'good' : s < 140 && d < 90 ? 'watch' : 'concern'
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
 * Bradycardia / hypotension floors. ALL provisional pending Dr. Jose.
 * Buffer values are conservative first-pass defaults — wide enough to go
 * neutral before any genuine drift toward the floor reaches the cliff.
 */
export const LOW_FLOORS: Partial<Record<'rhr' | 'sys' | 'dia', LowFloor>> = {
  rhr: { floor: 50, cautionBuffer: 4, unit: 'bpm',  label: 'Resting HR low (bradycardia)' },   // textbook is <60; beta-blocked runs low — provisional <50
  sys: { floor: 90, cautionBuffer: 5, unit: 'mmHg', label: 'Systolic low (hypotension)' },     // provisional <90
  dia: { floor: 60, cautionBuffer: 4, unit: 'mmHg', label: 'Diastolic low' },                  // <60 dia compromises coronary perfusion — provisional pending Dr. Jose
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
