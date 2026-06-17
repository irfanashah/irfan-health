// Glucose unit conversion. Canonical unit is mmol/L.
// Conversion factor: mmol/L = mg/dL ÷ 18.0 (per slice-3 spec §Glucose).
// Canonical values rounded to 1 decimal.

const MGDL_TO_MMOL = 18.0

export function mgdlToMmol(mgdl: number): number {
  return roundTo1dp(mgdl / MGDL_TO_MMOL)
}

export function mmolToMgdl(mmol: number): number {
  return Math.round(mmol * MGDL_TO_MMOL)
}

export function roundTo1dp(value: number): number {
  return Math.round(value * 10) / 10
}
