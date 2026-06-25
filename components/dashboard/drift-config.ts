// Per-metric drift configuration for Slice 7.3.
//
// This is the SINGLE SOURCE OF TRUTH for the threshold gate, direction,
// and good-drift acknowledgement that drive the Baselines & Drift panel.
// The `metric_drift` Postgres view (migration_004) emits stats only; this
// file says what to do with them.
//
// Numbers are conservative starting defaults flagged for tuning once real
// variability is visible (per spec §Threshold model). Loose for v1; if
// real readings ever get filtered, surface in the panel and tune here.

export type DriftMetricId =
  | 'rhr' | 'hrv'
  | 'sys' | 'dia'
  | 'fasting' | 'glucose_var' | 'tir'
  | 'weight'
  | 'spo2_avg' | 'spo2_min'
  | 'spo2_odi' | 'spo2_time_below_90'
  | 'skin_temp'

export type ConcerningDirection = 'up' | 'down'

export interface DriftMetricConfig {
  id: DriftMetricId
  label: string
  short: string
  unit: string

  /** Direction of the concerning move (i.e. the side that fires "Drift"). */
  concerning: ConcerningDirection

  /**
   * True iff a sustained move in the OPPOSITE direction is celebrated as a
   * "Win". RHR-down is intentionally FALSE — for a beta-blocked post-MI
   * patient, RHR-down can be over-beta-blockade not fitness. Per spec
   * §Direction (fix #4), provisional pending Dr. Jose.
   */
  acknowledgeGood: boolean

  /** Absolute centre-shift floor (|short_median − prior_median|), in metric units. */
  absFloor: number

  /** Robust-z floor (|short_vs_prior_z|, MAD units). */
  zFloor: number

  /** Min data-days required in the short (7d) window to be `active`. */
  minNShort: number

  /** Min data-days required in the prior (disjoint 21d) window to be `active`. */
  minNPrior: number

  /** Short window length in days. Override only if a metric needs it. */
  shortWindowDays: number

  /** Rolling/z-reference window length in days. */
  rollingWindowDays: number

  /**
   * Held data-days required to confirm drift. Counted within a bounded
   * look-back span = 2 × shortWindowDays, NEVER as a calendar run-length.
   * No carry-forward across no-data gaps.
   */
  M: number
}

// ─── 8 daily-cadence metrics (per the spec's config table) ──────────────────
//
// Spec table → config:
//   RHR          ↑  no   |  ≥ 4 bpm     ≥ 0.8  | 5 / 12
//   HRV          ↓  yes  |  ≥ 6 ms      ≥ 1.0  | 5 / 12
//   sys          ↑  yes  |  ≥ 6 mmHg    ≥ 0.8  | 3 / 8
//   dia          ↑  yes  |  ≥ 4 mmHg    ≥ 0.8  | 3 / 8
//   fasting      ↑  yes  |  ≥ 0.6 mmol  ≥ 0.8  | 3 / 7
//   glucose_var  ↑  yes  |  ≥ 0.4 mmol  ≥ 0.8  | 3 / 7
//   tir          ↓  yes  |  ≥ 8 pts     ≥ 0.8  | 3 / 7
//   weight       ↑  yes  |  ≥ 1.2 kg    ≥ 1.0  | 5 / 10
//   spo2_avg     ↓  no   |  ≥ 1.5 %     ≥ 1.0  | 5 / 12
//   spo2_min     ↓  no   |  ≥ 3.0 %     ≥ 1.0  | 5 / 12
//   spo2_odi          ↑  yes  |  ≥ 2.0 /h    ≥ 1.0  | 5 / 12   (more desat = worse; sustained drop = real win)
//   spo2_time_below_90 ↑ yes  |  ≥ 1.5 %     ≥ 1.0  | 5 / 12   (same)
//
// HRV/weight/spo2 carry the higher z-floor (HRV noisy; weight low-variance;
// spo2_min in particular has nightly variability from sensor contact).
// Weight min-n short = 5 reconciles to the ~5-of-7 weigh-in cadence; until
// the Withings-weight extension lands + you weigh ~5/7 days it stays
// `establishing` (expected).
//
// SpO2 acknowledgeGood=false (provisional, pending Dr. Jose): SpO2 is bounded
// at 100 and Irfan already sits high — upward drift near the ceiling isn't a
// physiological "win" the way HRV-up or weight-down is. The signal that
// matters is downward (nocturnal desaturation). RHR-down is the same class of
// "not a fitness win for this patient" call.

export const DRIFT_CONFIG: Record<DriftMetricId, DriftMetricConfig> = {
  rhr:         { id: 'rhr',         label: 'Resting HR',           short: 'RHR',        unit: 'bpm',    concerning: 'up',   acknowledgeGood: false, absFloor: 4,   zFloor: 0.8, minNShort: 5, minNPrior: 12, shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  hrv:         { id: 'hrv',         label: 'HRV',                  short: 'HRV',        unit: 'ms',     concerning: 'down', acknowledgeGood: true,  absFloor: 6,   zFloor: 1.0, minNShort: 5, minNPrior: 12, shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  sys:         { id: 'sys',         label: 'Systolic BP',          short: 'Systolic',   unit: 'mmHg',   concerning: 'up',   acknowledgeGood: true,  absFloor: 6,   zFloor: 0.8, minNShort: 3, minNPrior: 8,  shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  dia:         { id: 'dia',         label: 'Diastolic BP',         short: 'Diastolic',  unit: 'mmHg',   concerning: 'up',   acknowledgeGood: true,  absFloor: 4,   zFloor: 0.8, minNShort: 3, minNPrior: 8,  shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  fasting:     { id: 'fasting',     label: 'Fasting glucose',      short: 'Fasting',    unit: 'mmol/L', concerning: 'up',   acknowledgeGood: true,  absFloor: 0.6, zFloor: 0.8, minNShort: 3, minNPrior: 7,  shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  glucose_var: { id: 'glucose_var', label: 'Glucose variability',  short: 'Glucose var',unit: 'mmol/L', concerning: 'up',   acknowledgeGood: true,  absFloor: 0.4, zFloor: 0.8, minNShort: 3, minNPrior: 7,  shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  tir:         { id: 'tir',         label: 'Time-in-range',        short: 'TIR',        unit: '%',      concerning: 'down', acknowledgeGood: true,  absFloor: 8,   zFloor: 0.8, minNShort: 3, minNPrior: 7,  shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  weight:      { id: 'weight',      label: 'Weight',               short: 'Weight',     unit: 'kg',     concerning: 'up',   acknowledgeGood: true,  absFloor: 1.2, zFloor: 1.0, minNShort: 5, minNPrior: 10, shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  spo2_avg:    { id: 'spo2_avg',    label: 'Overnight SpO2 (avg)', short: 'SpO2 avg',   unit: '%',      concerning: 'down', acknowledgeGood: false, absFloor: 1.5, zFloor: 1.0, minNShort: 5, minNPrior: 12, shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  spo2_min:    { id: 'spo2_min',    label: 'Overnight SpO2 (min)', short: 'SpO2 min',   unit: '%',      concerning: 'down', acknowledgeGood: false, absFloor: 3.0, zFloor: 1.0, minNShort: 5, minNPrior: 12, shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  // ODI + time-below-90: more desaturation = worse (concerning='up'); a
  // sustained drop in either is a real win (acknowledgeGood=true) — distinct
  // from the avg/min calls because the desaturation metrics are uncapped
  // from below (zero is the floor and that's the good direction).
  spo2_odi:           { id: 'spo2_odi',           label: 'Desaturations / hour',     short: 'ODI',          unit: '/h', concerning: 'up', acknowledgeGood: true, absFloor: 2.0, zFloor: 1.0, minNShort: 5, minNPrior: 12, shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  spo2_time_below_90: { id: 'spo2_time_below_90', label: 'Time below 90% SpO2',      short: 'Time <90%',    unit: '%',  concerning: 'up', acknowledgeGood: true, absFloor: 1.5, zFloor: 1.0, minNShort: 5, minNPrior: 12, shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
  // Whoop skin temperature — sustained rise = possible illness / inflammation
  // / fever (the early-warning signal that matters for a post-MI patient).
  // acknowledgeGood=false: a dip below normal isn't a "win" worth celebrating;
  // the panel just renders 'stable' silence. No fixed clinical band (no
  // st.skinTemp / no LOW_FLOORS) — skin temp is a personal-baseline
  // deviation signal; the drift engine watches movement from his own normal.
  // All thresholds provisional pending Dr. Jose.
  skin_temp:          { id: 'skin_temp',          label: 'Skin temperature',         short: 'Skin temp',    unit: '°C', concerning: 'up', acknowledgeGood: false, absFloor: 0.4, zFloor: 1.0, minNShort: 5, minNPrior: 12, shortWindowDays: 7, rollingWindowDays: 28, M: 7 },
}

export const DRIFT_METRICS: readonly DriftMetricId[] = [
  'rhr', 'hrv', 'sys', 'dia', 'fasting', 'glucose_var', 'tir', 'weight',
  'spo2_avg', 'spo2_min', 'spo2_odi', 'spo2_time_below_90', 'skin_temp',
]

/**
 * Look-back span (calendar days) over which the TS layer counts held
 * data-days for the ≥M persistence check. Per spec, "~2 × the short
 * window" — 14 calendar days for the v1 default. Carry-forward across
 * no-data days inside this span is forbidden; only data-days where the
 * gate held count.
 */
export const PERSISTENCE_LOOKBACK_DAYS = 14

/**
 * Recency-against-today guard. Per spec (v1.3 clarification): a metric is
 * eligible for `active` only if its latest data-day is within this many
 * calendar days of today. Without this, a stale block of CGM readings
 * from 10 days ago would render as a "live" verdict.
 */
export const RECENCY_GUARD_DAYS = 6
