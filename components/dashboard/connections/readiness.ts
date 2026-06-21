// Cardiac Readiness composite — ported VERBATIM from
// prototype-src/02-data-layer.jsx::READINESS_WEIGHTS + ::subScores +
// ::computeReadiness, adapted to read a daily_metrics row and to return null
// when any of the five inputs is missing (per Slice 7.2 spec: "compute only
// on days where all 5 inputs are present; do NOT renormalise weights").

import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

// ---- Weights -------------------------------------------------------------
// Total = 1.00. Documented order matches the prototype.
export const READINESS_WEIGHTS = [
  { key: 'recovery' as const, label: 'Recovery',  weight: 0.28 },
  { key: 'hrv'      as const, label: 'HRV',        weight: 0.20 },
  { key: 'bp'       as const, label: 'Morning BP', weight: 0.20 },
  { key: 'rhr'      as const, label: 'Resting HR', weight: 0.17 },
  { key: 'sleep'    as const, label: 'Sleep',      weight: 0.15 },
] as const
export type ReadinessKey = (typeof READINESS_WEIGHTS)[number]['key']

// ---- Sub-score normalisation bounds --------------------------------------
// Each sub-score normalises one or more daily metrics to a 0–100 scale.
// Bounds are the prototype's chosen ranges (tunable later — keep here so
// changes are co-located with the formula they shape).
//
//   recovery (Whoop %):       30 → 0      ··· 86 → 100
//   hrv (ms):                 26 → 0      ··· 66 → 100
//   rhr (bpm) — INVERTED:     70 → 0      ··· 54 → 100   (lower is better)
//   bp (mmHg, composite):     sys 140 → 0 ··· 110 → 100 ; dia 90 → 0 ··· 68 → 100 ; averaged
//   sleep (hours):            5  → 0      ··· 8.5 → 100
const clamp01_100 = (v: number) => Math.max(0, Math.min(100, v))

function subRecovery(v: number): number {
  return clamp01_100(((v - 30) / (86 - 30)) * 100)
}
function subHrv(v: number): number {
  return clamp01_100(((v - 26) / (66 - 26)) * 100)
}
function subRhr(v: number): number {
  return clamp01_100(((70 - v) / (70 - 54)) * 100)
}
function subBp(sys: number, dia: number): number {
  const sysScore = (140 - sys) / (140 - 110)
  const diaScore = (90 - dia) / (90 - 68)
  return clamp01_100(((sysScore + diaScore) / 2) * 100)
}
function subSleep(hours: number): number {
  return clamp01_100(((hours - 5) / (8.5 - 5)) * 100)
}

export interface ReadinessInput {
  key: ReadinessKey
  label: string
  weight: number
  score: number              // 0–100
  /** +ve = lifting today's blended score, −ve = dragging. */
  delta: number
}

export interface ReadinessResult {
  score: number              // 0–100 (rounded)
  inputs: ReadinessInput[]   // sorted by delta desc — most lifting first
}

/**
 * Compute the readiness score for a single day. Returns null if ANY of the
 * five sub-scores is missing its inputs — the spec is explicit that we don't
 * renormalise over missing inputs (that would silently change what the score
 * means). The Readiness panel shows a gap for those days, and falls back to
 * the most recent fully-scored day for the headline "today" number with an
 * "as of <day>" note.
 */
export function computeReadiness(d: DailyMetricRow): ReadinessResult | null {
  // All 5 inputs required.
  if (
    d.recovery === null ||
    d.hrv === null ||
    d.rhr === null ||
    d.sys === null || d.dia === null ||
    d.sleep_total === null
  ) return null

  const sub = {
    recovery: subRecovery(d.recovery),
    hrv: subHrv(d.hrv),
    rhr: subRhr(d.rhr),
    bp: subBp(d.sys, d.dia),
    sleep: subSleep(d.sleep_total),
  }

  let blended = 0
  for (const w of READINESS_WEIGHTS) blended += sub[w.key] * w.weight
  const score = Math.round(blended)

  const inputs: ReadinessInput[] = READINESS_WEIGHTS.map((w) => ({
    key: w.key,
    label: w.label,
    weight: w.weight,
    score: Math.round(sub[w.key]),
    delta: Math.round(sub[w.key] - blended),
  })).sort((a, b) => b.delta - a.delta)

  return { score, inputs }
}

export interface ReadinessSeriesPoint {
  date: Date
  score: number
}

/** Compute the per-day score across a window; days with any missing input are absent. */
export function readinessSeries(rows: DailyMetricRow[]): ReadinessSeriesPoint[] {
  const out: ReadinessSeriesPoint[] = []
  for (const r of rows) {
    const v = computeReadiness(r)
    if (v) out.push({ date: new Date(r.date), score: v.score })
  }
  return out
}

export interface ReadinessTodaySnapshot {
  /** The row the headline number was computed from. */
  row: DailyMetricRow
  result: ReadinessResult
  /** The previous fully-scored day, for the delta-vs-yesterday display. */
  prev: { row: DailyMetricRow; result: ReadinessResult } | null
  /** True iff the row used is older than rows[rows.length - 1] — i.e. today is incomplete. */
  fallback: boolean
}

/**
 * Resolve the "today" snapshot used by the Readiness panel. Per spec/decision #3:
 * - If today's row is fully scored, use today + yesterday for the delta.
 * - If today is incomplete, fall back to the LATEST fully-scored day (older or
 *   equal) and label it with an "as of <day>" sub-note. Delta then compares
 *   the two most recent fully-scored days (which may both be days ago).
 * Returns null if no day in the window has all five inputs.
 */
export function resolveTodaySnapshot(rows: DailyMetricRow[]): ReadinessTodaySnapshot | null {
  // Walk newest → oldest, finding the most recent two fully-scored days.
  const recent: Array<{ row: DailyMetricRow; result: ReadinessResult }> = []
  for (let i = rows.length - 1; i >= 0 && recent.length < 2; i--) {
    const r = computeReadiness(rows[i])
    if (r) recent.push({ row: rows[i], result: r })
  }
  if (recent.length === 0) return null
  const today = recent[0]
  const prev = recent[1] ?? null
  const fallback = rows.length > 0 && rows[rows.length - 1].date !== today.row.date
  return {
    row: today.row,
    result: today.result,
    prev,
    fallback,
  }
}

export function readinessBand(score: number): { color: string; label: string } {
  if (score >= 70) return { color: 'var(--teal)',  label: 'Strong' }
  if (score >= 55) return { color: 'var(--amber)', label: 'Moderate' }
  return { color: 'var(--red)', label: 'Take it easy' }
}
