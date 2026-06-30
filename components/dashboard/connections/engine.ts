// Lagged-association engine — the core of the Correlations tab revamp.
//
// What this is: a robust n-of-1 lagged cross-correlation discovery scan
// over `daily_metrics`. Detrend → exclude regime days → scan all pairs ×
// directions × lags → score with Spearman (primary) + Pearson + Fisher-z
// CI/p on autocorrelation-corrected n_eff → BH-FDR across the whole test
// family → gate (`q ≤ 0.10 ∧ |rS| ≥ 0.3 ∧ nEff ≥ 12`) → suppress derived
// pairs → rank survivors.
//
// What this is NOT (and the engine should NEVER imply it is):
//   - causal — no observational n-of-1 method establishes causation;
//   - diagnostic — every surfaced sentence is a *hypothesis to discuss
//     with Dr. Jose*, never a finding;
//   - a model of the underlying dynamics — that's the documented Phase 2
//     (VAR / state-space / LMM, needs Python + a year+ of data).
//
// Honesty discipline (spec §4): every output sentence uses associational
// verbs only ("tended to / lined up with / preceded") — never causal
// ("caused / led to / because"). Lead/lag is *temporal ordering*,
// explicitly not causation. Raw-level correlations carry a shared-trend
// caveat. Below-gate pairs read "not enough evidence yet" — never a fake
// number.
//
// Out of the engine + into the data layer:
//   - `daily_metrics` series fetched at 365d window (NOT the dashboard's 90d);
//   - exclusions: med-change reset windows + context_periods(exclude_from_baseline)
//     overlapping the window, applied as `value → null` BEFORE pairing so
//     excluded days simply drop out of every pair.

import {
  spearman,
  pearson,
  effectiveN,
  ciAndP,
  benjaminiHochberg,
  MIN_EFFECTIVE_N,
  type CorrSig,
} from '@/components/dashboard/charts/stats'
import { METRIC_INDEX, ENGINE_METRIC_IDS, type MetricDef } from './metrics'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

// ─── Tunables ──────────────────────────────────────────────────────────────

/** Max lag scanned in either direction (days). Configurable up to 7. */
export const LMAX = 3

/** Centered rolling-median window for detrending (days). */
const DETREND_WINDOW = 21

/** Minimum non-null values inside the rolling window to compute a median. */
const DETREND_MIN_PERIODS = 7

/** Discovery gate. */
export const GATE_Q = 0.10
export const GATE_R = 0.30

/**
 * Known-derived / tautological pairs — symmetric, suppressed from
 * discovery. The Explorer still shows them, labelled "expected by design"
 * (the user might want to verify the relationship empirically). Adding a
 * pair here removes BOTH directions from the discovery results.
 *
 * NOTE: store as sorted-pair strings ("a|b" with a<b alphabetically) so
 * lookup is direction-independent and cheap.
 */
export const DERIVED_PAIRS: ReadonlySet<string> = new Set([
  pairKey('recovery', 'hrv'),
  pairKey('recovery', 'rhr'),
  pairKey('recovery', 'sleepHours'),
  pairKey('recovery', 'sleepQuality'),
  pairKey('recovery', 'sleep_deep'),
  pairKey('recovery', 'sleep_rem'),
  pairKey('sleepHours', 'sleepQuality'),
  pairKey('sleepHours', 'sleep_deep'),
  pairKey('sleepHours', 'sleep_rem'),
  pairKey('sleepQuality', 'sleep_deep'),
  pairKey('sleepQuality', 'sleep_rem'),
  pairKey('sleep_deep', 'sleep_rem'),
  pairKey('spo2_avg', 'spo2_min'),
  pairKey('spo2_odi', 'spo2_time_below_90'),
  pairKey('spo2_avg', 'spo2_odi'),
  pairKey('spo2_avg', 'spo2_time_below_90'),
  pairKey('spo2_min', 'spo2_odi'),
  pairKey('spo2_min', 'spo2_time_below_90'),
  pairKey('fasting', 'tir'),
  pairKey('fasting', 'glucose_var'),
  pairKey('tir', 'glucose_var'),
  pairKey('sys', 'dia'),
  pairKey('strain', 'pulse'), // strain is partly derived from HR
  // Food diary — totals + sub-macros all come from the same meal log,
  // so any in-family link is "by construction more carbs → more sugar /
  // more calories" not a discovery. Evening carbs ↔ total carbs is the
  // textbook tautology to keep out of the discovery surface.
  pairKey('carbs_g', 'sugar_g'),
  pairKey('carbs_g', 'calories'),
  pairKey('carbs_g', 'fiber_g'),
  pairKey('carbs_g', 'evening_carbs_g'),
  pairKey('sugar_g', 'calories'),
  pairKey('sugar_g', 'evening_carbs_g'),
])

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// ─── Detrend (rolling-median residual) ────────────────────────────────────

/**
 * Replace each value with the residual after subtracting a centred rolling
 * median. Window = DETREND_WINDOW days, minimum DETREND_MIN_PERIODS observed
 * values inside it; otherwise the residual stays null. Robust to outliers
 * and to gaps. Spec §1.3 — kills the shared-post-STEMI-trend confounding
 * that makes everything correlate during active recovery.
 */
export function detrendRollingMedian(
  series: ReadonlyArray<number | null>,
  window: number = DETREND_WINDOW,
  minPeriods: number = DETREND_MIN_PERIODS,
): (number | null)[] {
  const n = series.length
  const out = new Array<number | null>(n).fill(null)
  const half = Math.floor(window / 2)
  for (let i = 0; i < n; i++) {
    const v = series[i]
    if (v === null) continue
    const start = Math.max(0, i - half)
    const end = Math.min(n - 1, i + half)
    const bucket: number[] = []
    for (let j = start; j <= end; j++) {
      const w = series[j]
      if (w !== null) bucket.push(w)
    }
    if (bucket.length < minPeriods) continue
    bucket.sort((a, b) => a - b)
    const m = bucket.length
    const med = m % 2 === 1 ? bucket[(m - 1) >> 1] : 0.5 * (bucket[(m >> 1) - 1] + bucket[m >> 1])
    out[i] = v - med
  }
  return out
}

// ─── Exclusion mask (med-changes + context_periods) ────────────────────────

export interface DateRange {
  start: string // YYYY-MM-DD
  end: string   // YYYY-MM-DD (inclusive)
  /** When set, only the listed metric IDs are excluded (med-change reset). Empty/undefined = ALL metrics. */
  metrics?: readonly string[]
}

/**
 * Build a per-day per-metric mask. Returns `excluded[metricId][dayIndex]` =
 * true if that day should be dropped from the metric's series before
 * correlating. Med-change reset windows are metric-scoped (only the
 * affected metrics are nulled); context_periods(exclude_from_baseline=true)
 * are global (every metric is nulled on those days). Spec §1.2.
 */
export function buildExclusionMask(
  dates: ReadonlyArray<string>,
  ranges: ReadonlyArray<DateRange>,
  metricIds: ReadonlyArray<string>,
): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {}
  for (const m of metricIds) out[m] = new Array(dates.length).fill(false)
  for (const r of ranges) {
    const start = r.start
    const end = r.end
    const affected = r.metrics && r.metrics.length > 0 ? r.metrics : metricIds
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i]
      if (d >= start && d <= end) {
        for (const m of affected) {
          if (out[m] !== undefined) out[m][i] = true
        }
      }
    }
  }
  return out
}

/**
 * Apply the exclusion mask to a series: every excluded day becomes null.
 * Run BEFORE detrending so excluded days don't contribute to the rolling
 * median either.
 */
export function applyExclusionsToSeries(
  series: ReadonlyArray<number | null>,
  mask: ReadonlyArray<boolean>,
): (number | null)[] {
  const out = new Array<number | null>(series.length)
  for (let i = 0; i < series.length; i++) {
    out[i] = mask[i] ? null : series[i]
  }
  return out
}

// ─── Lagged cross-correlation ──────────────────────────────────────────────

export interface LagResult {
  lag: number
  rSpearman: number
  rPearson: number
  n: number
  nEff: number
  sig: CorrSig
}

/**
 * Pair (X[t], Y[t+L]) over every t where both values are present, compute
 * Spearman + Pearson + significance on n_eff. lag=0 is contemporaneous (the
 * X→Y and Y→X profiles are equal). lag≥1 means "X precedes Y by L days".
 */
function pairAtLag(
  xDet: ReadonlyArray<number | null>,
  yDet: ReadonlyArray<number | null>,
  lag: number,
): LagResult {
  const xs: number[] = []
  const ys: number[] = []
  const max = xDet.length
  for (let t = 0; t < max; t++) {
    const tLag = t + lag
    if (tLag < 0 || tLag >= max) continue
    const x = xDet[t]
    const y = yDet[tLag]
    if (x === null || y === null) continue
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    xs.push(x)
    ys.push(y)
  }
  const n = xs.length
  const rS = spearman(xs, ys)
  const rP = pearson(xs, ys)
  const nEff = effectiveN(xs, ys)
  const sig = ciAndP(rS, nEff)
  return { lag, rSpearman: rS, rPearson: rP, n, nEff, sig }
}

/**
 * Full lag profile for one ordered pair X → Y over lags 0..LMAX.
 * Returns one entry per lag. The Explorer plots this; the discovery scan
 * uses it to pick the best lag per direction.
 */
export function laggedProfile(
  xDet: ReadonlyArray<number | null>,
  yDet: ReadonlyArray<number | null>,
  lmax: number = LMAX,
): LagResult[] {
  const out: LagResult[] = []
  for (let L = 0; L <= lmax; L++) out.push(pairAtLag(xDet, yDet, L))
  return out
}

// ─── Discovery scan ────────────────────────────────────────────────────────

export interface EngineConnection {
  /** Source metric id (the "predictor" in the directed view). */
  x: string
  /** Outcome metric id. */
  y: string
  /** Best lag found in the X→Y direction (0..LMAX). */
  lag: number
  /** 'same' | 'precedes' — same-day (lag=0) is undirected. */
  direction: 'same' | 'precedes'
  rSpearman: number
  rPearson: number
  ci: { low: number; high: number }
  /** Two-sided p computed on n_eff. */
  p: number
  /** BH-FDR q across the whole test family. */
  q: number
  /** Raw paired-day count. */
  n: number
  /** Autocorrelation-corrected effective n used in significance. */
  nEff: number
  /** True iff detrended (always true for v1; raw is shown only via the Explorer toggle). */
  detrended: boolean
  /** Set when |rSpearman| − |rPearson| ≥ 0.15 — monotonic-but-not-linear hint. */
  nonlinear: boolean
  /** True iff this pair is in DERIVED_PAIRS (suppressed from discovery; available in Explorer). */
  suppressed: boolean
  /** Associational sentence (spec §3.1 / §4 wording). */
  sentence: string
}

export interface DiscoverOpts {
  lmax?: number
  /** Override gates for inspection / debug; default = production GATE_Q + GATE_R + MIN_EFFECTIVE_N. */
  qMax?: number
  rMin?: number
  nEffMin?: number
  /** When true, include suppressed (derived) pairs in the output, flagged. */
  includeSuppressed?: boolean
}

export interface DiscoverResult {
  /** Ranked survivors (gate-passing, non-suppressed by default), strongest first. */
  connections: EngineConnection[]
  /** Total tests run (for the "scanned N comparisons" honesty line). */
  totalTests: number
  /** How many survived the gate before ranking. */
  survivors: number
  /** Window length in days. */
  windowDays: number
}

/**
 * The discovery pass. Detrends every metric (post-exclusion), runs lagged
 * Spearman+Pearson over every unordered pair × direction × lag, computes
 * Fisher-z significance on n_eff, applies BH-FDR over the whole family,
 * gates on (q,r,nEff), suppresses derived pairs, picks the best lag per
 * directed pair, and ranks. Pure — no React, no fetch, fully unit-testable.
 *
 * Compute cost: ~20 engine metrics → 190 unordered pairs × 2 directions ×
 * (LMAX+1) lags ≈ ~1.5k tests. Trivial on-demand in TS; no precompute
 * needed. (If the metric set ever doubles, revisit — noted in spec §2.)
 */
export function discoverConnections(
  series: ReadonlyArray<DailyMetricRow>,
  exclusions: ReadonlyArray<DateRange>,
  opts: DiscoverOpts = {},
): DiscoverResult {
  const lmax = opts.lmax ?? LMAX
  const qMax = opts.qMax ?? GATE_Q
  const rMin = opts.rMin ?? GATE_R
  const nEffMin = opts.nEffMin ?? MIN_EFFECTIVE_N

  const dates = series.map((d) => d.date)
  const metricIds = ENGINE_METRIC_IDS.filter((id) => METRIC_INDEX[id] !== undefined)

  // Step 1: build per-metric raw series + apply exclusion mask + detrend.
  const mask = buildExclusionMask(dates, exclusions, metricIds)
  const detrended: Record<string, (number | null)[]> = {}
  for (const id of metricIds) {
    const def = METRIC_INDEX[id] as MetricDef
    const raw: (number | null)[] = series.map(def.acc)
    const masked = applyExclusionsToSeries(raw, mask[id])
    detrended[id] = detrendRollingMedian(masked)
  }

  // Step 2: enumerate every ordered pair × lag, score each. Same-day (L=0)
  // is symmetric — compute it once per unordered pair (X→Y at L=0 ≡ Y→X at
  // L=0, just with axes swapped). L≥1 is directional — compute both X→Y
  // and Y→X separately.
  interface RawTest {
    key: string
    x: string
    y: string
    lag: number
    direction: 'same' | 'precedes'
    rS: number
    rP: number
    n: number
    nEff: number
    sig: CorrSig
  }
  const tests: RawTest[] = []
  for (let i = 0; i < metricIds.length; i++) {
    const xId = metricIds[i]
    for (let j = i + 1; j < metricIds.length; j++) {
      const yId = metricIds[j]
      // L = 0 (symmetric)
      const r0 = pairAtLag(detrended[xId], detrended[yId], 0)
      tests.push({
        key: `${xId}__${yId}__lag0`,
        x: xId, y: yId, lag: 0, direction: 'same',
        rS: r0.rSpearman, rP: r0.rPearson, n: r0.n, nEff: r0.nEff, sig: r0.sig,
      })
      // L ≥ 1 (directional, both ways)
      for (let L = 1; L <= lmax; L++) {
        const fwd = pairAtLag(detrended[xId], detrended[yId], L)
        tests.push({
          key: `${xId}__${yId}__lag${L}_fwd`,
          x: xId, y: yId, lag: L, direction: 'precedes',
          rS: fwd.rSpearman, rP: fwd.rPearson, n: fwd.n, nEff: fwd.nEff, sig: fwd.sig,
        })
        const rev = pairAtLag(detrended[yId], detrended[xId], L)
        tests.push({
          key: `${yId}__${xId}__lag${L}_fwd`,
          x: yId, y: xId, lag: L, direction: 'precedes',
          rS: rev.rSpearman, rP: rev.rPearson, n: rev.n, nEff: rev.nEff, sig: rev.sig,
        })
      }
    }
  }

  // Step 3: BH-FDR across the whole test family.
  const qMap = benjaminiHochberg(tests.map((t) => ({ key: t.key, p: t.sig.p })))

  // Step 4: pick the best lag per (x, y) directed combination (max |rS|
  // among lags whose nEff ≥ nEffMin — so we don't pick a "best" with n=2).
  const bestByDirected = new Map<string, RawTest>()
  for (const t of tests) {
    if (t.nEff < nEffMin) continue
    const k = `${t.x}__${t.y}`
    const prev = bestByDirected.get(k)
    if (!prev || Math.abs(t.rS) > Math.abs(prev.rS)) bestByDirected.set(k, t)
  }

  // Step 5: collapse to one entry per unordered pair, preferring the
  // stronger of (X→Y, Y→X) — temporal-ordering hint. Same-day (lag=0)
  // counts as either direction's representative; if a directed lag wins,
  // that's the "X precedes Y" framing.
  const byPair = new Map<string, EngineConnection>()
  for (const t of bestByDirected.values()) {
    const k = pairKey(t.x, t.y)
    const suppressed = DERIVED_PAIRS.has(k)
    if (suppressed && !opts.includeSuppressed) continue
    const q = qMap[t.key] ?? 1
    const passesGate = q <= qMax && Math.abs(t.rS) >= rMin
    if (!passesGate) continue
    const nonlinear = Math.abs(t.rS) - Math.abs(t.rP) >= 0.15
    const conn: EngineConnection = {
      x: t.x,
      y: t.y,
      lag: t.lag,
      direction: t.direction,
      rSpearman: t.rS,
      rPearson: t.rP,
      ci: { low: t.sig.ciLow, high: t.sig.ciHigh },
      p: t.sig.p,
      q,
      n: t.n,
      nEff: t.nEff,
      detrended: true,
      nonlinear,
      suppressed,
      sentence: buildSentence(t.x, t.y, t.lag, t.direction, t.rS),
    }
    const prev = byPair.get(k)
    if (!prev || Math.abs(conn.rSpearman) > Math.abs(prev.rSpearman)) byPair.set(k, conn)
  }

  // Step 6: rank by |rS| × confidence proxy (1 − q). Strongest first.
  const survivors = Array.from(byPair.values()).sort(
    (a, b) => Math.abs(b.rSpearman) * (1 - b.q) - Math.abs(a.rSpearman) * (1 - a.q),
  )

  return {
    connections: survivors,
    totalTests: tests.length,
    survivors: survivors.length,
    windowDays: series.length,
  }
}

// ─── Associational sentence builder ────────────────────────────────────────

/** Strength → English. Same scale as `strengthWord` but exported here for sentence locality. */
function strengthFromR(r: number): 'strong' | 'moderate' | 'mild' {
  const a = Math.abs(r)
  if (a >= 0.6) return 'strong'
  if (a >= 0.4) return 'moderate'
  return 'mild'
}

/** "next-day", "2 days later", "same day". Never "after L days". */
export function lagInWords(lag: number): string {
  if (lag === 0) return 'same day'
  if (lag === 1) return 'next-day'
  return `${lag} days later`
}

/**
 * Build the headline associational sentence. STRICT discipline:
 *   - associational verbs ONLY: "tended to", "lined up with", "preceded";
 *   - never "caused", "led to", "because of";
 *   - lead/lag is temporal ordering, EXPLICITLY not causation;
 *   - direction word reflects observed pattern at the best lag.
 *
 * Patterns:
 *   lag 0, +r: "On days {X} was higher, {Y} tended to run higher too."
 *   lag 0, −r: "On days {X} was higher, {Y} tended to run lower."
 *   lag ≥1, +r: "Higher {X} tended to precede higher {Y} {lagWords}."
 *   lag ≥1, −r: "Higher {X} tended to precede lower {Y} {lagWords}."
 */
export function buildSentence(
  xId: string,
  yId: string,
  lag: number,
  direction: 'same' | 'precedes',
  rSpearman: number,
): string {
  const X = METRIC_INDEX[xId]
  const Y = METRIC_INDEX[yId]
  if (!X || !Y) return ''
  const positive = rSpearman > 0
  const strength = strengthFromR(rSpearman)
  const lagWords = lagInWords(lag)
  const xLabel = X.label.toLowerCase()
  const yLabel = Y.label.toLowerCase()
  if (direction === 'same' || lag === 0) {
    if (positive) {
      return `On days ${xLabel} ran higher, ${yLabel} tended to run higher too — a ${strength} link (${lagWords}).`
    }
    return `On days ${xLabel} ran higher, ${yLabel} tended to run lower — a ${strength} link (${lagWords}).`
  }
  if (positive) {
    return `Higher ${xLabel} tended to precede higher ${yLabel} ${lagWords} — a ${strength} link.`
  }
  return `Higher ${xLabel} tended to precede lower ${yLabel} ${lagWords} — a ${strength} link.`
}
