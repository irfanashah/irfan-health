// Metric catalog for the Correlation Explorer.
//
// Maps each prototype catalog entry (prototype-src/05-connections.jsx::METRICS)
// to its column in `daily_metrics`. The view's column names are the source of
// truth; the accessor is a typed reader that returns number | null. Sources
// + colours mirror the rest of the dashboard so the user learns a consistent
// visual vocabulary across tabs.

import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

export type SourceKey = 'whoop' | 'withings' | 'nightscout' | 'oxylink'

export interface MetricDef {
  id: string
  label: string
  short: string
  unit: string
  source: SourceKey
  color: string
  /** Reader from a daily_metrics row. null = "not recorded that day". */
  acc: (d: DailyMetricRow) => number | null
  /** Display formatter — accepts arbitrary number (incl. tick values). */
  fmt: (v: number) => string
  /** Is higher or lower the healthier direction? Drives later UI cues. */
  better: 'high' | 'low'
}

const intFmt = (v: number) => String(Math.round(v))
const oneDp  = (v: number) => v.toFixed(1)

export const METRICS: readonly MetricDef[] = [
  // Whoop
  { id: 'sleepHours',   label: 'Sleep hours',      short: 'Sleep',        unit: 'h',    source: 'whoop',      color: 'var(--purple)', acc: (d) => d.sleep_total,       fmt: oneDp, better: 'high' },
  { id: 'sleepQuality', label: 'Sleep quality',    short: 'Sleep qual.',  unit: '%',    source: 'whoop',      color: 'var(--purple)', acc: (d) => d.sleep_performance, fmt: intFmt, better: 'high' },
  { id: 'recovery',     label: 'Recovery',         short: 'Recovery',     unit: '%',    source: 'whoop',      color: 'var(--purple)', acc: (d) => d.recovery,          fmt: intFmt, better: 'high' },
  { id: 'hrv',          label: 'HRV',              short: 'HRV',          unit: 'ms',   source: 'whoop',      color: 'var(--teal)',   acc: (d) => d.hrv,               fmt: intFmt, better: 'high' },
  { id: 'rhr',          label: 'Resting HR',       short: 'Resting HR',   unit: 'bpm',  source: 'whoop',      color: 'var(--purple)', acc: (d) => d.rhr,               fmt: intFmt, better: 'low'  },
  { id: 'strain',       label: 'Strain',           short: 'Strain',       unit: '',     source: 'whoop',      color: 'var(--amber)',  acc: (d) => d.strain,            fmt: oneDp,  better: 'low'  },
  // Withings (BP comes from withings + manual; weight from manual until we extend Withings)
  { id: 'sys',          label: 'Systolic BP',      short: 'Systolic',     unit: 'mmHg', source: 'withings',   color: 'var(--red)',    acc: (d) => d.sys,               fmt: intFmt, better: 'low'  },
  { id: 'dia',          label: 'Diastolic BP',     short: 'Diastolic',    unit: 'mmHg', source: 'withings',   color: 'var(--teal)',   acc: (d) => d.dia,               fmt: intFmt, better: 'low'  },
  { id: 'pulse',        label: 'Pulse',            short: 'Pulse',        unit: 'bpm',  source: 'withings',   color: 'var(--teal)',   acc: (d) => d.pulse,             fmt: intFmt, better: 'low'  },
  { id: 'weight',       label: 'Weight',           short: 'Weight',       unit: 'kg',   source: 'withings',   color: 'var(--teal)',   acc: (d) => d.weight,            fmt: oneDp,  better: 'low'  },
  // Nightscout CGM
  { id: 'fasting',      label: 'Fasting glucose',  short: 'Fasting',      unit: 'mmol/L', source: 'nightscout', color: 'var(--purple)', acc: (d) => d.fasting,          fmt: oneDp,  better: 'low'  },
  { id: 'tir',          label: 'Glucose time-in-range', short: 'TIR',     unit: '%',    source: 'nightscout', color: 'var(--amber)',  acc: (d) => d.tir,               fmt: intFmt, better: 'high' },
  // Sleep stages — surfaced for the engine; not in the manual-Explorer
  // dropdown by default (kept off to avoid cluttering the picker — they're
  // available via the engine's discovery scan + can be selected if needed).
  { id: 'sleep_deep',         label: 'Deep sleep',        short: 'Deep sleep',  unit: 'h',  source: 'whoop',      color: 'var(--purple)', acc: (d) => d.sleep_deep,         fmt: oneDp, better: 'high' },
  { id: 'sleep_rem',          label: 'REM sleep',         short: 'REM sleep',   unit: 'h',  source: 'whoop',      color: 'var(--purple)', acc: (d) => d.sleep_rem,          fmt: oneDp, better: 'high' },
  { id: 'glucose_var',        label: 'Glucose variability', short: 'Glucose SD', unit: 'mmol/L', source: 'nightscout', color: 'var(--amber)', acc: (d) => d.glucose_var,      fmt: oneDp, better: 'low'  },
  { id: 'spo2_avg',           label: 'Overnight SpO2 avg', short: 'SpO2 avg',    unit: '%',  source: 'oxylink',    color: 'var(--teal)',   acc: (d) => d.spo2_avg,           fmt: intFmt, better: 'high' },
  { id: 'spo2_min',           label: 'Overnight SpO2 min', short: 'SpO2 min',    unit: '%',  source: 'oxylink',    color: 'var(--teal)',   acc: (d) => d.spo2_min,           fmt: intFmt, better: 'high' },
  { id: 'spo2_odi',           label: 'Desaturation index', short: 'ODI',         unit: '/h', source: 'oxylink',    color: 'var(--amber)',  acc: (d) => d.spo2_odi,           fmt: oneDp, better: 'low'  },
  { id: 'spo2_time_below_90', label: 'Time below 90% SpO2', short: 'T<90%',      unit: '%',  source: 'oxylink',    color: 'var(--red)',    acc: (d) => d.spo2_time_below_90, fmt: oneDp, better: 'low'  },
  { id: 'skin_temp',          label: 'Skin temperature',  short: 'Skin temp',   unit: '°C', source: 'whoop',      color: 'var(--amber)',  acc: (d) => d.skin_temp,          fmt: oneDp, better: 'low'  },
]

/**
 * Subset surfaced in the Explorer dropdown — keeps the picker uncluttered.
 * The full METRICS set (above) flows through the engine's auto-discovery
 * scan, which is where esoteric pairs (e.g. ODI ↔ HRV) are meant to surface.
 */
export const EXPLORER_METRIC_IDS: readonly string[] = [
  'sleepHours', 'sleepQuality', 'recovery', 'hrv', 'rhr', 'strain',
  'sys', 'dia', 'pulse', 'weight',
  'fasting', 'tir', 'glucose_var',
  'spo2_avg', 'spo2_min', 'spo2_odi', 'spo2_time_below_90',
  'skin_temp',
]

/**
 * Metric IDs the engine considers in its discovery scan. Excludes the
 * corroborating-duplicate `spo2_whoop` (Oxylink is authoritative — gotcha
 * #77). All other tracked daily metrics are in. Adding a metric to METRICS
 * + this list automatically surfaces it in discovery.
 */
export const ENGINE_METRIC_IDS: readonly string[] = [
  'sys', 'dia', 'pulse', 'weight',
  'recovery', 'hrv', 'rhr', 'strain',
  'sleepHours', 'sleepQuality', 'sleep_deep', 'sleep_rem',
  'fasting', 'glucose_var', 'tir',
  'spo2_avg', 'spo2_min', 'spo2_odi', 'spo2_time_below_90',
  'skin_temp',
]

export const METRIC_INDEX: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.id, m]))

export interface Preset {
  a: string
  b: string
  label: string
}

/** Common pairings — same as prototype-src/05-connections.jsx::PRESETS. */
export const PRESETS: readonly Preset[] = [
  { a: 'sleepHours', b: 'sys',      label: 'Sleep → systolic'  },
  { a: 'strain',     b: 'recovery', label: 'Strain → recovery' },
  { a: 'sleepHours', b: 'fasting',  label: 'Sleep → glucose'   },
  { a: 'weight',     b: 'sys',      label: 'Weight → BP'       },
  { a: 'hrv',        b: 'recovery', label: 'HRV → recovery'    },
]

export const SOURCE_LABELS: Record<SourceKey, string> = {
  whoop: 'Whoop',
  withings: 'Withings',
  nightscout: 'Nightscout CGM',
  oxylink: 'Oxylink',
}
