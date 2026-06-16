/**
 * Normalise a numeric value from one unit to the canonical unit.
 * Pure function — throws if the conversion pair is not in the table.
 * If fromUnit === toUnit, returns value unchanged.
 */
export function normaliseUnit(
  value: number,
  fromUnit: string,
  toUnit: string
): number {
  if (fromUnit === toUnit) return value

  const key = `${fromUnit}→${toUnit}`

  const conversions: Record<string, (v: number) => number> = {
    // Sleep durations — Whoop sends milliseconds
    'milliseconds→min': (v) => v / 60_000,
    // Other sleep duration conversions (future sources)
    'seconds→min': (v) => v / 60,
    'hours→min': (v) => v * 60,
    // Weight
    'lbs→kg': (v) => v / 2.2046,
    'g→kg': (v) => v / 1000,
    // Glucose
    'mg/dL→mmol/L': (v) => v / 18.018,
    // Lipids — cholesterol (per data-model spec §4)
    'mg/dL→mmol/L_lipid': (v) => v / 38.67,
    // Lipids — triglycerides
    'mg/dL→mmol/L_trig': (v) => v / 88.57,
    // Lp(a) — approximate conversion, note in docs
    'mg/dL→nmol/L': (v) => v * 2.5,
    // Temperature
    '°F→°C': (v) => (v - 32) * (5 / 9),
    // Blood pressure (future-proofing)
    'kPa→mmHg': (v) => v * 7.50062,
  }

  const fn = conversions[key]
  if (!fn) {
    throw new Error(
      `normaliseUnit: no conversion defined for '${fromUnit}' → '${toUnit}'`
    )
  }

  return fn(value)
}
