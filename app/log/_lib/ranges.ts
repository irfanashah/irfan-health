// Server-validated plausibility ranges. Out-of-range values are rejected,
// never clamped. Bounds match slice-3-manual-entry-spec.md §UI/UX.

export const WEIGHT_KG_MIN = 30
export const WEIGHT_KG_MAX = 250

export const GLUCOSE_MMOL_MIN = 2
export const GLUCOSE_MMOL_MAX = 30

export const BP_SYSTOLIC_MIN = 70
export const BP_SYSTOLIC_MAX = 260
export const BP_DIASTOLIC_MIN = 40
export const BP_DIASTOLIC_MAX = 160
export const BP_PULSE_MIN = 30
export const BP_PULSE_MAX = 220

export const SYMPTOM_SEVERITY_MIN = 1
export const SYMPTOM_SEVERITY_MAX = 5

export function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}
