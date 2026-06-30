// Curated unmeasured-confounder map. Spec §1.9.
//
// The hardest confounders are the ones NOT in the dataset — diet, alcohol,
// stress, hydration, meal timing, illness, newborn night-wakings. No
// statistic can adjust for a variable that was never measured. The engine
// can't *remove* them, but it must make them VISIBLE. Surfacing ≠
// adjusting — and the UI says so explicitly.
//
// This module is deterministic, zero-cost, no LLM, works with no API key.
// Each entry is keyed by the outcome metric (Y) with optional pair-specific
// overrides. Each plausible explanation is flagged measured (tracked → can
// be controlled via the Explorer's partial-corr toggle) vs unmeasured
// (flag-only + "consider logging" pointer).
//
// LLM expand is OPTIONAL + lazy (confounder-llm.ts) — this curated layer
// always renders even when the API key is unset.

export interface ConfounderItem {
  /** Short plain-English label. */
  label: string
  /** measured = a tracked metric → covariate-adjustable in the Explorer. */
  kind: 'measured' | 'unmeasured'
  /**
   * For `measured` items: the engine metric id of the covariate (so the
   * Explorer can pre-fill the partial-corr toggle).
   */
  covariate?: string
  /**
   * For `unmeasured` items: a hint at where logging this would live ("/log"
   * for the manual entry path; "meal-log" for the future meal-tracking
   * slice referenced in the spec).
   */
  logHref?: string
  logHint?: string
}

export interface ConfounderEntry {
  /** General confounders for any pair where this metric is the outcome (Y). */
  general: ConfounderItem[]
  /** Pair-specific additions, keyed by the predictor (X) metric id. */
  pair?: Record<string, ConfounderItem[]>
}

/**
 * Outcome-keyed map. Seeded from spec §1.9. Append-only — add a metric or
 * a pair-specific override as the platform grows. If a Y has no entry the
 * UI falls back to a generic "consider what else changed that day" note.
 */
export const CONFOUNDERS: Record<string, ConfounderEntry> = {
  fasting: {
    general: [
      // Evening meal — was unmeasured; flipped to measured-adjustable once
      // the food diary slice landed (carbs_g + evening_carbs_g track it).
      { label: 'Evening meal carbs', kind: 'measured', covariate: 'evening_carbs_g' },
      { label: 'Total day carbs', kind: 'measured', covariate: 'carbs_g' },
      { label: 'Sugar load', kind: 'measured', covariate: 'sugar_g' },
      { label: 'Alcohol with dinner', kind: 'unmeasured', logHref: '/log', logHint: 'log as a note' },
      { label: 'Late snacking', kind: 'measured', covariate: 'last_meal_to_sleep_min' },
      { label: 'Illness / inflammation', kind: 'unmeasured', logHref: '/log', logHint: 'log as a symptom' },
      { label: 'Dawn phenomenon (circadian cortisol)', kind: 'unmeasured' },
      { label: 'Medication timing (statin / beta-blocker dose hour)', kind: 'unmeasured', logHref: '/medications', logHint: 'frequency field' },
      { label: 'Strain the prior day', kind: 'measured', covariate: 'strain' },
    ],
  },
  glucose_var: {
    general: [
      { label: 'Meal composition + timing across the day', kind: 'measured', covariate: 'carbs_g' },
      { label: 'Sugar load', kind: 'measured', covariate: 'sugar_g' },
      { label: 'Evening carbs (close to bed)', kind: 'measured', covariate: 'evening_carbs_g' },
      { label: 'Alcohol', kind: 'unmeasured', logHref: '/log', logHint: 'log as a note' },
      { label: 'Illness', kind: 'unmeasured', logHref: '/log', logHint: 'log as a symptom' },
      { label: 'Strain spikes', kind: 'measured', covariate: 'strain' },
    ],
  },
  tir: {
    general: [
      { label: 'Meal composition + timing', kind: 'measured', covariate: 'carbs_g' },
      { label: 'Sugar load', kind: 'measured', covariate: 'sugar_g' },
      { label: 'Evening carbs', kind: 'measured', covariate: 'evening_carbs_g' },
      { label: 'Alcohol', kind: 'unmeasured' },
      { label: 'Illness', kind: 'unmeasured', logHref: '/log' },
      { label: 'Strain (next-day insulin sensitivity)', kind: 'measured', covariate: 'strain' },
    ],
  },
  sys: {
    general: [
      { label: 'Salt / dietary sodium', kind: 'measured', covariate: 'sodium_mg' },
      { label: 'Caffeine intake + timing', kind: 'unmeasured', logHref: '/log', logHint: 'log as a note' },
      { label: 'Alcohol the prior evening', kind: 'unmeasured' },
      { label: 'Acute stress', kind: 'unmeasured' },
      { label: 'Measurement context (time of day, posture, recent activity)', kind: 'unmeasured' },
      { label: 'Strain the prior day', kind: 'measured', covariate: 'strain' },
    ],
  },
  dia: {
    general: [
      { label: 'Salt / dietary sodium', kind: 'measured', covariate: 'sodium_mg' },
      { label: 'Caffeine intake', kind: 'unmeasured', logHref: '/log' },
      { label: 'Alcohol the prior evening', kind: 'unmeasured' },
      { label: 'Acute stress', kind: 'unmeasured' },
      { label: 'Measurement context', kind: 'unmeasured' },
    ],
  },
  pulse: {
    general: [
      { label: 'Caffeine', kind: 'unmeasured', logHref: '/log' },
      { label: 'Acute stress', kind: 'unmeasured' },
      { label: 'Recent activity before BP cuff', kind: 'unmeasured' },
      { label: 'Strain', kind: 'measured', covariate: 'strain' },
    ],
  },
  hrv: {
    general: [
      { label: 'Alcohol the prior evening', kind: 'unmeasured' },
      { label: 'Late meals', kind: 'unmeasured', logHref: '/log', logHint: 'meal logging — backlog' },
      { label: 'Caffeine after midday', kind: 'unmeasured' },
      { label: 'Acute stress / illness', kind: 'unmeasured', logHref: '/log' },
      { label: 'Room temperature overnight', kind: 'unmeasured' },
      { label: 'Strain the prior day', kind: 'measured', covariate: 'strain' },
    ],
  },
  recovery: {
    general: [
      { label: 'Alcohol the prior evening', kind: 'unmeasured' },
      { label: 'Late meals', kind: 'unmeasured', logHref: '/log', logHint: 'meal logging — backlog' },
      { label: 'Illness / stress', kind: 'unmeasured', logHref: '/log' },
      { label: 'Strain the prior day', kind: 'measured', covariate: 'strain' },
    ],
  },
  rhr: {
    general: [
      { label: 'Alcohol the prior evening', kind: 'unmeasured' },
      { label: 'Caffeine', kind: 'unmeasured' },
      { label: 'Illness / fever', kind: 'unmeasured', logHref: '/log' },
      { label: 'Strain', kind: 'measured', covariate: 'strain' },
      { label: 'Room temperature overnight', kind: 'unmeasured' },
    ],
  },
  sleepHours: {
    general: [
      { label: 'Caffeine after midday', kind: 'unmeasured' },
      { label: 'Alcohol', kind: 'unmeasured' },
      { label: 'Screen time before bed', kind: 'unmeasured' },
      { label: 'Late meals', kind: 'measured', covariate: 'last_meal_to_sleep_min' },
      { label: 'Heavy evening carbs', kind: 'measured', covariate: 'evening_carbs_g' },
      { label: 'Acute stress / work load', kind: 'unmeasured' },
      { label: 'Newborn night-wakings (Haya)', kind: 'unmeasured', logHint: 'household context — flag, not a fix' },
    ],
  },
  sleepQuality: {
    general: [
      { label: 'Caffeine / alcohol the prior evening', kind: 'unmeasured' },
      { label: 'Late meals (close to bedtime)', kind: 'measured', covariate: 'last_meal_to_sleep_min' },
      { label: 'Heavy evening carbs', kind: 'measured', covariate: 'evening_carbs_g' },
      { label: 'Newborn night-wakings (Haya)', kind: 'unmeasured' },
      { label: 'Room temperature', kind: 'unmeasured' },
      { label: 'Stress', kind: 'unmeasured' },
    ],
  },
  weight: {
    general: [
      { label: 'Hydration on weigh-in morning', kind: 'unmeasured' },
      { label: 'Sodium load the day before', kind: 'unmeasured' },
      { label: 'Meal timing relative to weigh-in', kind: 'unmeasured' },
      { label: 'Time-of-day of weigh-in', kind: 'unmeasured' },
    ],
  },
  spo2_avg: {
    general: [
      { label: 'Sleep position (supine vs side)', kind: 'unmeasured' },
      { label: 'Nasal congestion / cold / allergy', kind: 'unmeasured', logHref: '/log', logHint: 'log as a symptom' },
      { label: 'Alcohol the prior evening (suppresses respiratory drive)', kind: 'unmeasured' },
      { label: 'Sensor fit (Oxylink finger placement)', kind: 'unmeasured' },
    ],
  },
  spo2_min: {
    general: [
      { label: 'Sleep position', kind: 'unmeasured' },
      { label: 'Nasal congestion / illness', kind: 'unmeasured', logHref: '/log' },
      { label: 'Alcohol', kind: 'unmeasured' },
      { label: 'Sensor fit', kind: 'unmeasured' },
    ],
  },
  spo2_odi: {
    general: [
      { label: 'Sleep position (more events when supine)', kind: 'unmeasured' },
      { label: 'Alcohol / sedative effect', kind: 'unmeasured' },
      { label: 'Nasal congestion', kind: 'unmeasured' },
      { label: 'Weight (chronic, not nightly)', kind: 'measured', covariate: 'weight' },
    ],
  },
  spo2_time_below_90: {
    general: [
      { label: 'Sleep position', kind: 'unmeasured' },
      { label: 'Alcohol', kind: 'unmeasured' },
      { label: 'Illness / congestion', kind: 'unmeasured' },
    ],
  },
  skin_temp: {
    general: [
      { label: 'Room temperature overnight', kind: 'unmeasured' },
      { label: 'Illness / fever', kind: 'unmeasured', logHref: '/log', logHint: 'log as a symptom' },
      { label: 'Alcohol the prior evening', kind: 'unmeasured' },
      { label: 'Heavy blanket / sleepwear', kind: 'unmeasured' },
    ],
  },
  strain: {
    general: [
      { label: 'Workout type + intensity', kind: 'unmeasured' },
      { label: 'Heat / humidity', kind: 'unmeasured' },
      { label: 'Hydration', kind: 'unmeasured' },
    ],
  },
  sleep_deep: { general: [{ label: 'Alcohol / late meals suppress deep stages', kind: 'unmeasured' }, { label: 'Room temperature', kind: 'unmeasured' }] },
  sleep_rem:  { general: [{ label: 'Alcohol suppresses REM', kind: 'unmeasured' }, { label: 'Sleep-cycle interruption (newborn)', kind: 'unmeasured' }] },
}

/** Lookup for a pair: outcome's general list + any pair-specific additions. */
export function confoundersFor(y: string, x?: string): ConfounderItem[] {
  const entry = CONFOUNDERS[y]
  if (!entry) return []
  const out = [...entry.general]
  if (x && entry.pair && entry.pair[x]) out.push(...entry.pair[x])
  return out
}

/** Two-bucket split for the UI. */
export function splitConfounders(items: ConfounderItem[]): {
  measured: ConfounderItem[]
  unmeasured: ConfounderItem[]
} {
  return {
    measured: items.filter((i) => i.kind === 'measured'),
    unmeasured: items.filter((i) => i.kind === 'unmeasured'),
  }
}
