// Presentation/mapping layer for the Baselines & Drift tab redesign.
//
// Pure TS — takes the existing DriftVerdict[] (from evaluate.ts) plus each
// metric's MetricDriftRow[] (from the metric_drift view) and produces the
// `drift` data shape the Claude Design components consume. NO SQL change;
// the engine (view + thresholds + gate/persistence/recency) is untouched.
//
// Decisions baked in (RESOLVED 2026-06-22 per the build spec):
//   1. "Your normal" band = rolling_median ± 2·rolling_mad  (k = 2).
//   2. `watch` → tier "drift" + early flag (the SignalCard renders an
//      "early — not yet confirmed" tag). Counted as emerging in the
//      overall-read copy, never as confirmed.
//   3. `caution` (low-floor approach, not breached) → tier "drift" + caution
//      flag, with a distinct lead ("approaching your low line").
//   4. magWord from |short_vs_prior_z|:  < 1.2 → "a little",
//      1.2–2.5 → "noticeably",  > 2.5 → "well".
//   5. Plain-language copy kept verbatim from the design where it ports
//      cleanly.

import type { DriftVerdict } from './evaluate'
import type { DriftMetricId, ConcerningDirection } from '../drift-config'
import { DRIFT_CONFIG } from '../drift-config'
import type { MetricDriftRow } from '@/app/lib/dashboard/baselines'

// ─── Source label map ──────────────────────────────────────────────────────

const SOURCE_LABEL: Record<DriftMetricId, string> = {
  rhr: 'Whoop',
  hrv: 'Whoop',
  sys: 'Withings',
  dia: 'Withings',
  fasting: 'CGM',
  glucose_var: 'CGM',
  tir: 'CGM',
  weight: 'Withings',          // BP-only adapter today; weight extension upcoming. Label is still Withings once it lands; manual entries also flow under this metric.
  spo2_avg: 'Oxylink',
  spo2_min: 'Oxylink',
  spo2_odi: 'Oxylink',
  spo2_time_below_90: 'Oxylink',
  skin_temp: 'Whoop',
}

// ─── Public types ──────────────────────────────────────────────────────────

export type DesignState =
  | 'safety'        // clinical-low breach — overrides tier
  | 'drift'         // tier=drift OR watch OR caution-low — renders in "Worth a look"
  | 'improvement'   // tier=win
  | 'steady'        // tier=stable (active) OR suppressed-and-quiet
  | 'settling'      // sufficiency=establishing
  | 'nodata'        // sufficiency=no-recent-data

export type DirWord = 'higher' | 'lower'
export type MagWord = 'a little' | 'noticeably' | 'well'

export interface SeriesPoint {
  v: number | null            // null = no data on that day (gap, NOT zero — gotcha #34)
}

export interface DesignSignal {
  id: DriftMetricId
  label: string               // "Resting HR"
  short: string               // "RHR"
  source: string              // "Whoop" / "Withings" / "CGM" / "Oxylink"
  unit: string                // "bpm" / "mmol/L" / "%" / "kg" / "ms" / "mmHg"
  fmt: (v: number | null | undefined) => string
  /** State the design renders against. */
  state: DesignState
  /** Watch tier surfaced as drift — render the "early — not yet confirmed" tag. */
  early: boolean
  /** Clinical-low caution (not breached) — render with the "approaching your low line" lead. */
  caution: boolean
  /** Suppression (active context window) — render with "paused" treatment in the steady tier. */
  paused: boolean
  /** "Concerning" direction from drift-config — drives band-edge logic. */
  concern: ConcerningDirection
  /** Latest reading. Always present for active/establishing states; null only when no-data. */
  latest: number | null
  /** Personal-normal band, lo–hi (median ± 2·MAD). null when the rolling stats aren't ready yet. */
  lo: number | null
  hi: number | null
  rMed: number | null
  /** "higher" / "lower" vs rMed — drives the trend arrow. null on steady. */
  dirWord: DirWord | null
  /** Plain-English magnitude word. null on steady. */
  magWord: MagWord | null
  /** Plain lead sentence shown at the top of the card. */
  lead: string
  /** Calendar-day series (oldest first), nulls = gaps. */
  series: SeriesPoint[]
  /** Recent-emphasis window in days (the last N points get out-of-band highlights). */
  windowDays: number
  /** Pattern stats — counted over the last 14 calendar days (data-days only). */
  total14: number
  concernSideDays: number
  goodSideDays: number
  /** Confidence stat — rolling_n (≥22 → "solid", else "still building"). */
  totalData: number
  /** Settling — how many readings so far. */
  dataNights: number
  /** No-data — days since the last reading. */
  lastSeen: number | null
}

export interface DriftPanelData {
  tone: 'calm' | 'attention' | 'safety'
  title: string
  body: string
  safety: DesignSignal[]
  drift: DesignSignal[]
  improvement: DesignSignal[]
  steady: DesignSignal[]
  settling: DesignSignal[]
  nodata: DesignSignal[]
}

// ─── Formatters ────────────────────────────────────────────────────────────

function unitDp(unit: string): number {
  // Matches the existing panel's convention; mmol/L is 1dp, everything else
  // 0dp once the value is ≥ 100, otherwise 1dp for sub-100 readings except
  // unitless counts (bpm, ms, mmHg, %, kg — all whole-number friendly).
  if (unit === 'mmol/L') return 1
  return 0
}

function makeFmt(unit: string): (v: number | null | undefined) => string {
  const dp = unitDp(unit)
  return (v) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—'
    return Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(dp)
  }
}

// ─── Pure helpers ──────────────────────────────────────────────────────────

function todayISO(): string {
  // GST-anchored today (Asia/Dubai = +04:00, no DST). Same convention as
  // evaluate.ts and the daily_metrics view.
  const now = new Date()
  const gst = new Date(now.getTime() + 4 * 60 * 60 * 1000)
  return gst.toISOString().slice(0, 10)
}

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + 'T00:00:00Z')
  const b = new Date(bISO + 'T00:00:00Z')
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function addDaysISO(dateISO: string, n: number): string {
  const d = new Date(dateISO + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Build a calendar-day series for the band sparkline. Aligns the rows to a
 * fixed daysBack window ending today; days with no row become nulls (gaps),
 * which the SVG path skips (gotcha #34 — never zero-fill).
 */
function buildSeries(rows: MetricDriftRow[], daysBack: number): SeriesPoint[] {
  const end = todayISO()
  const start = addDaysISO(end, -(daysBack - 1))
  const byDate = new Map<string, MetricDriftRow>()
  for (const r of rows) byDate.set(r.date, r)
  const out: SeriesPoint[] = []
  for (let i = 0; i < daysBack; i++) {
    const d = addDaysISO(start, i)
    const r = byDate.get(d)
    out.push({ v: r ? r.today_value : null })
  }
  return out
}

/**
 * Pattern counts over the last 14 calendar days. Counts data-days only; days
 * outside the rolling band edges count toward concern-side / good-side based
 * on the metric's concerning direction.
 */
function buildPatternCounts(
  rows: MetricDriftRow[],
  concern: ConcerningDirection,
  lo: number | null,
  hi: number | null
): { total14: number; concernSideDays: number; goodSideDays: number } {
  const today = todayISO()
  const cutoff = addDaysISO(today, -13) // inclusive 14-day window
  let total14 = 0
  let concernSide = 0
  let goodSide = 0
  for (const r of rows) {
    if (r.date < cutoff || r.date > today) continue
    total14++
    if (lo === null || hi === null) continue
    if (concern === 'up') {
      if (r.today_value > hi) concernSide++
      if (r.today_value < lo) goodSide++
    } else {
      if (r.today_value < lo) concernSide++
      if (r.today_value > hi) goodSide++
    }
  }
  return { total14, concernSideDays: concernSide, goodSideDays: goodSide }
}

/** magWord from |short_vs_prior_z|. */
function magWordFromZ(z: number | null): MagWord {
  if (z === null || !Number.isFinite(z)) return 'a little'
  const az = Math.abs(z)
  if (az > 2.5) return 'well'
  if (az >= 1.2) return 'noticeably'
  return 'a little'
}

function dirWordFromVsMedian(latest: number, median: number | null): DirWord | null {
  if (median === null || latest === median) return null
  return latest > median ? 'higher' : 'lower'
}

// ─── Lead sentences (plain-language, associational) ────────────────────────
//
// Verbs allowed: "running", "has moved", "edged toward", "tends to". Causal
// verbs ("caused", "led to") never appear — same audit rule as the rest of
// the dashboard prose (gotcha #38 / Slice 7.2 convention).

function buildLead(
  state: DesignState,
  caution: boolean,
  early: boolean,
  dirWord: DirWord | null,
  magWord: MagWord | null
): string {
  if (state === 'safety') {
    return 'Has dropped below the low line you set with Dr. Jose — worth a call.'
  }
  if (state === 'drift') {
    if (caution) {
      // Distinct from drift's "running higher/lower" framing — a floor-approach
      // is a different kind of concern.
      return 'Has been edging toward your low line over the last couple of weeks.'
    }
    const dir = dirWord ?? 'higher'
    const mag = magWord ?? 'a little'
    const trailing = early
      ? 'over the last few days — early, not yet a confirmed pattern.'
      : 'than your normal for about two weeks.'
    return `Has been running ${mag} ${dir} ${trailing}`
  }
  if (state === 'improvement') {
    const dir = dirWord ?? 'lower'
    return `Has moved ${dir} the right way — a sustained, encouraging shift.`
  }
  return ''
}

// ─── Per-signal build ──────────────────────────────────────────────────────

interface PerSignalInput {
  verdict: DriftVerdict
  rows: MetricDriftRow[]
  daysBack: number
}

function buildSignal({ verdict, rows, daysBack }: PerSignalInput): DesignSignal {
  const cfg = DRIFT_CONFIG[verdict.metric]
  const fmt = makeFmt(cfg.unit)
  const latestRow = verdict.latest
  const latest = latestRow ? latestRow.today_value : null

  // Band: rolling_median ± 2·rolling_mad. Display-only — the gate still
  // uses the real thresholds from drift-config.
  let lo: number | null = null
  let hi: number | null = null
  let rMed: number | null = null
  if (latestRow) {
    rMed = latestRow.rolling_median
    if (rMed !== null && latestRow.rolling_mad !== null) {
      lo = rMed - 2 * latestRow.rolling_mad
      hi = rMed + 2 * latestRow.rolling_mad
    }
  }

  const dirWord: DirWord | null = latest !== null
    ? dirWordFromVsMedian(latest, rMed)
    : null
  const magWord: MagWord = magWordFromZ(latestRow ? latestRow.short_vs_prior_z : null)

  // State remap. The order matters: breach overrides any tier; caution
  // overrides win/stable; suppression overrides drift/watch (never silently
  // upgraded above steady).
  let state: DesignState
  let early = false
  let caution = false
  const paused = verdict.alertsSuppressed

  if (verdict.state === 'no-recent-data') {
    state = 'nodata'
  } else if (verdict.state === 'establishing') {
    state = 'settling'
  } else if (verdict.clinicalLow === 'breach') {
    // Clinical-low precedence — breach always wins over Win/Drift/anything else.
    state = paused ? 'steady' : 'safety'
  } else if (verdict.clinicalLow === 'caution') {
    // Approaching the low floor. Surface as Worth-a-look with a distinct lead,
    // unless suppressed (then quiet in steady — never silently fake-stable but
    // the design has no caution chip; "paused" surfacing applies).
    state = paused ? 'steady' : 'drift'
    caution = !paused
  } else if (verdict.tier === 'drift') {
    state = paused ? 'steady' : 'drift'
  } else if (verdict.tier === 'watch') {
    state = paused ? 'steady' : 'drift'
    early = !paused
  } else if (verdict.tier === 'win') {
    state = paused ? 'steady' : 'improvement'
  } else {
    state = 'steady'
  }

  // Steady cards have no directional prose — null out dir/mag for those.
  const finalDir = state === 'drift' || state === 'improvement' || state === 'safety' ? dirWord : null
  const finalMag: MagWord | null = state === 'drift' || state === 'improvement' ? magWord : null

  const lead = buildLead(state, caution, early, finalDir, finalMag)

  const series = buildSeries(rows, daysBack)
  const { total14, concernSideDays, goodSideDays } =
    buildPatternCounts(rows, cfg.concerning, lo, hi)

  const today = todayISO()
  const lastSeen = latestRow ? Math.max(0, daysBetween(latestRow.date, today)) : null
  const dataNights = rows.length

  return {
    id: cfg.id,
    label: cfg.label,
    short: cfg.short,
    source: SOURCE_LABEL[cfg.id],
    unit: cfg.unit,
    fmt,
    state,
    early,
    caution,
    paused,
    concern: cfg.concerning,
    latest,
    lo,
    hi,
    rMed,
    dirWord: finalDir,
    magWord: finalMag,
    lead,
    series,
    windowDays: cfg.shortWindowDays,
    total14,
    concernSideDays,
    goodSideDays,
    totalData: latestRow ? latestRow.rolling_n : 0,
    dataNights,
    lastSeen,
  }
}

// ─── Overall read (tone / title / body) ────────────────────────────────────

function listAnd(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function buildOverall(
  signals: DesignSignal[]
): { tone: 'calm' | 'attention' | 'safety'; title: string; body: string } {
  const safety = signals.filter((s) => s.state === 'safety')
  const driftBucket = signals.filter((s) => s.state === 'drift')
  const confirmed = driftBucket.filter((s) => !s.early)   // drift + caution (both are confirmed concerns)
  const emerging = driftBucket.filter((s) => s.early)
  const improvement = signals.filter((s) => s.state === 'improvement')
  const settling = signals.filter((s) => s.state === 'settling')
  const total = signals.length

  if (safety.length > 0) {
    const names = safety.map((s) => s.short)
    const subject = names.length === 1 ? `${listAnd(names)} is` : `${listAnd(names)} are`
    return {
      tone: 'safety',
      title: `Something's dropped below a safe line`,
      body: `${subject} below your low line — worth a call to Dr. Jose. Acute symptoms still go through the Quick log red-flag route.`,
    }
  }

  if (confirmed.length === 0 && emerging.length === 0) {
    if (improvement.length > 0) {
      return {
        tone: 'calm',
        title: 'Holding steady — and a few good shifts',
        body: `Nothing's drifting from your normal right now. ${listAnd(improvement.map((s) => s.short))} ${improvement.length === 1 ? 'is' : 'are'} moving the right way.`,
      }
    }
    if (settling.length === total && total > 0) {
      return {
        tone: 'calm',
        title: 'Still learning your normal',
        body: `All ${total} tracked signals are still settling in — you need a couple more weeks of readings before the personal-normal lines mean much.`,
      }
    }
    return {
      tone: 'calm',
      title: 'Holding steady',
      body: `Nothing's drifting from your normal right now — all ${total} tracked signals are sitting in their usual range.`,
    }
  }

  // Attention. Decide phrasing based on confirmed vs emerging mix.
  const cNames = listAnd(confirmed.map((s) => s.short))
  const eNames = listAnd(emerging.map((s) => s.short))

  if (confirmed.length > 0 && emerging.length === 0) {
    const title = confirmed.length === 1 ? 'One thing worth a look' : `${confirmed.length} things worth a look`
    return {
      tone: 'attention',
      title,
      body: `${cNames} ${confirmed.length === 1 ? 'has been' : 'have been'} drifting from your normal — worth raising with Dr. Jose. Nothing alarming on its own.`,
    }
  }

  if (confirmed.length === 0 && emerging.length > 0) {
    const title = emerging.length === 1 ? `Something's starting to move` : `${emerging.length} things starting to move`
    return {
      tone: 'attention',
      title,
      body: `${eNames} ${emerging.length === 1 ? 'has' : 'have'} just begun to move from your normal — too early to confirm, worth watching over the next week.`,
    }
  }

  // Both buckets non-empty.
  const confPart = confirmed.length === 1
    ? `One thing worth a look (${cNames})`
    : `${confirmed.length} worth a look (${cNames})`
  const emergPart = emerging.length === 1
    ? `one just starting to move (${eNames})`
    : `${emerging.length} just starting to move (${eNames})`
  return {
    tone: 'attention',
    title: `${confPart}, ${emergPart}`,
    body: `Confirmed drift on ${cNames}; ${eNames} ${emerging.length === 1 ? 'is' : 'are'} too early to call yet. Worth raising the confirmed ones with Dr. Jose.`,
  }
}

// ─── Top-level builder ─────────────────────────────────────────────────────

export function buildDriftPanelData(
  verdicts: DriftVerdict[],
  rowsByMetric: Record<DriftMetricId, MetricDriftRow[]>,
  daysBack: number = 30
): DriftPanelData {
  const signals = verdicts.map((v) =>
    buildSignal({ verdict: v, rows: rowsByMetric[v.metric] ?? [], daysBack })
  )

  // Bucket — order within each bucket: most-severe / most-recent first.
  // Drift bucket: confirmed first, then emerging (so the eye lands on the
  // already-confirmed cards before the "early" tags).
  const safety = signals.filter((s) => s.state === 'safety')
  const driftAll = signals.filter((s) => s.state === 'drift')
  const drift = [
    ...driftAll.filter((s) => !s.early),
    ...driftAll.filter((s) => s.early),
  ]
  const improvement = signals.filter((s) => s.state === 'improvement')
  const steady = signals.filter((s) => s.state === 'steady')
  const settling = signals.filter((s) => s.state === 'settling')
  const nodata = signals.filter((s) => s.state === 'nodata')

  const overall = buildOverall(signals)

  return {
    tone: overall.tone,
    title: overall.title,
    body: overall.body,
    safety,
    drift,
    improvement,
    steady,
    settling,
    nodata,
  }
}
