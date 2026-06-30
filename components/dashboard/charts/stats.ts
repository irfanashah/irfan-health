// Pure stats helpers used by the Correlations tab. Ported from
// prototype-src/06-charts.jsx::pearson + ::linReg, plus a non-null pairing
// helper that's the foundation of the Slice 7.2 honesty layer.

export interface PairedSeries {
  xs: number[]
  ys: number[]
  /** Index back into the original arrays for the surviving pairs (for label lookup). */
  idx: number[]
  n: number
}

/**
 * Take two parallel arrays of (number | null) and emit only the indices where
 * BOTH are finite numbers. This is the rule that makes every r/scatter in
 * Slice 7.2 honest: real data is gappy, and the prototype's r-on-everything
 * pretends gaps don't exist.
 */
export function pairedNonNull(
  xs: ReadonlyArray<number | null>,
  ys: ReadonlyArray<number | null>
): PairedSeries {
  const ox: number[] = []
  const oy: number[] = []
  const oi: number[] = []
  const n = Math.min(xs.length, ys.length)
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const y = ys[i]
    if (x === null || y === null) continue
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    ox.push(x as number)
    oy.push(y as number)
    oi.push(i)
  }
  return { xs: ox, ys: oy, idx: oi, n: ox.length }
}

/** Pearson r over two parallel arrays. Returns 0 on n<2 or zero variance. */
export function pearson(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number {
  const n = xs.length
  if (n < 2 || ys.length !== n) return 0
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]
    sxy += xs[i] * ys[i]
    sxx += xs[i] * xs[i]
    syy += ys[i] * ys[i]
  }
  const cov = sxy - (sx * sy) / n
  const vx = sxx - (sx * sx) / n
  const vy = syy - (sy * sy) / n
  if (vx <= 0 || vy <= 0) return 0
  return cov / Math.sqrt(vx * vy)
}

/** Simple OLS regression. Returns slope + intercept; defaults to (0, mean(y)) on degenerate input. */
export function linReg(
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>
): { slope: number; intercept: number } {
  const n = xs.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 }
  let sx = 0, sy = 0, sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]
    sxy += xs[i] * ys[i]
    sxx += xs[i] * xs[i]
  }
  const denom = n * sxx - sx * sx
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  return { slope, intercept }
}

/**
 * Minimum paired-point threshold for showing an r in Slice 7.2. Below this we
 * still render the scatter + overlay so the user sees the shape of the data,
 * but the r badge greys out and the insight slot says "keep logging". The
 * spec is explicit on this — don't show an r computed from a handful of
 * points on a cardiac patient's own data.
 */
export const MIN_PAIRED_N = 10

/**
 * Minimum EFFECTIVE n for the lagged-association engine (correlations engine
 * revamp 2026-06-30). Higher than MIN_PAIRED_N because lag-shifts + the
 * multiplicity of the discovery scan thin the data and inflate false
 * positives. The autocorrelation-corrected effective n (see `effectiveN`) is
 * compared against this floor — not the raw n. Discovery requires
 * `nEff ≥ MIN_EFFECTIVE_N AND q ≤ 0.10 AND |rSpearman| ≥ 0.3`. Below the gate
 * the engine emits "not enough evidence yet" — never a fake number.
 */
export const MIN_EFFECTIVE_N = 12

// ─── Spearman + rank helpers ───────────────────────────────────────────────

/** Tie-averaged fractional 1-based ranks (Spearman mid-rank). Pure. */
export function ranks(xs: ReadonlyArray<number>): number[] {
  const n = xs.length
  if (n === 0) return []
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
  const r = new Array<number>(n)
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && xs[order[j + 1]] === xs[order[i]]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[order[k]] = avg
    i = j + 1
  }
  return r
}

/**
 * Spearman's rho — Pearson on rank-transformed series. Robust to outliers +
 * monotonic-nonlinear relationships (which health data routinely is).
 * Primary metric in the engine; Pearson is shown alongside as the linear
 * comparison.
 */
export function spearman(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number {
  if (xs.length !== ys.length || xs.length < 2) return 0
  return pearson(ranks(xs), ranks(ys))
}

// ─── Autocorrelation + effective sample size ───────────────────────────────

/**
 * Lag-1 autocorrelation. Clamped to [-0.99, 0.99]. Used by `effectiveN`:
 * serially-correlated days (today's HRV ≈ yesterday's) violate independence;
 * the discovery gate compensates by shrinking n rather than pretending each
 * day is independent.
 */
export function lag1Autocorr(xs: ReadonlyArray<number>): number {
  const n = xs.length
  if (n < 3) return 0
  let mean = 0
  for (let i = 0; i < n; i++) mean += xs[i]
  mean /= n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    const d = xs[i] - mean
    den += d * d
    if (i > 0) num += d * (xs[i - 1] - mean)
  }
  if (den <= 0) return 0
  const rho = num / den
  if (!Number.isFinite(rho)) return 0
  return Math.max(-0.99, Math.min(0.99, rho))
}

/**
 * Autocorrelation-corrected effective sample size. Bartlett-style:
 * `n_eff = n · (1 − ρ1x·ρ1y) / (1 + ρ1x·ρ1y)`, floored at 4, capped at n.
 * Spec §1.8 measure 1 — used in `ciAndP` + BH-FDR so highly-autocorrelated
 * pairs don't inflate their own significance.
 */
export function effectiveN(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 4) return Math.max(0, n)
  const ax = lag1Autocorr(xs)
  const ay = lag1Autocorr(ys)
  const prod = ax * ay
  const ratio = (1 - prod) / (1 + prod)
  if (!Number.isFinite(ratio) || ratio <= 0) return 4
  return Math.max(4, Math.min(n, n * ratio))
}

// ─── Normal CDF + Fisher-z CI/p (on n_eff) ────────────────────────────────

/** Abramowitz–Stegun erf approximation (max error ~1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

/** Standard normal CDF Φ(z) via erf. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

export interface CorrSig {
  r: number
  ciLow: number
  ciHigh: number
  /** Two-sided p, on n_eff. */
  p: number
  /** Effective n used in the calculation. */
  nEff: number
}

/**
 * Fisher-z CI95 + two-sided p — computed on n_eff (NOT raw n).
 * `tanh(atanh(r) ± 1.96/√(n_eff − 3))` for CI;
 * `z = atanh(r)·√(n_eff − 3)` against Φ for p.
 */
export function ciAndP(r: number, nEff: number): CorrSig {
  if (!Number.isFinite(r) || nEff <= 3) return { r, ciLow: -1, ciHigh: 1, p: 1, nEff }
  const rc = Math.max(-0.9999, Math.min(0.9999, r))
  const z = Math.atanh(rc)
  const se = 1 / Math.sqrt(nEff - 3)
  const ciLow = Math.tanh(z - 1.96 * se)
  const ciHigh = Math.tanh(z + 1.96 * se)
  const zScore = z * Math.sqrt(nEff - 3)
  const p = 2 * (1 - normalCdf(Math.abs(zScore)))
  return { r, ciLow, ciHigh, p: Math.max(0, Math.min(1, p)), nEff }
}

// ─── Benjamini–Hochberg FDR ───────────────────────────────────────────────

export interface PValueEntry {
  /** Caller-supplied stable key (e.g. `${x}__${y}__lag${L}`). */
  key: string
  p: number
}

/**
 * Benjamini–Hochberg FDR across the entire test family. Sort p ascending,
 * `q_i = p_i · m / (i+1)`, enforce monotonicity from the top down. Returns a
 * key → q map. Without this the discovery scan would manufacture false
 * "findings" by sheer multiplicity.
 */
export function benjaminiHochberg(entries: PValueEntry[]): Record<string, number> {
  const m = entries.length
  if (m === 0) return {}
  const sorted = [...entries].sort((a, b) => a.p - b.p)
  const qs = sorted.map((e, i) => Math.min(1, e.p * m / (i + 1)))
  for (let i = m - 2; i >= 0; i--) qs[i] = Math.min(qs[i], qs[i + 1])
  const out: Record<string, number> = {}
  for (let i = 0; i < m; i++) out[sorted[i].key] = qs[i]
  return out
}

// ─── Partial correlation (semipartial via residualisation) ────────────────

function residualise(ys: ReadonlyArray<number>, cs: ReadonlyArray<number>): number[] {
  const { slope, intercept } = linReg(cs, ys)
  return ys.map((y, i) => y - (intercept + slope * cs[i]))
}

/**
 * Partial Spearman/Pearson between x and y, controlling for one or more
 * numeric covariates. Sequential OLS residualisation of both x and y against
 * each covariate, then correlate the residuals. Caller MUST n-gate (require
 * n ≥ 20 before showing — semipartial at low n is df-unstable, spec §1.8).
 * Categorical covariates (day-of-week) should be encoded as 0–6 integers —
 * crude but sufficient at the manual-Explorer scale.
 */
export function partialCorr(
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
  covariates: ReadonlyArray<ReadonlyArray<number>>,
  method: 'spearman' | 'pearson' = 'spearman'
): { r: number; n: number } {
  const n = xs.length
  if (n < 4 || ys.length !== n) return { r: 0, n }
  let xR: number[] = xs.slice()
  let yR: number[] = ys.slice()
  for (const cov of covariates) {
    if (cov.length !== n) continue
    xR = residualise(xR, cov)
    yR = residualise(yR, cov)
  }
  const r = method === 'spearman' ? spearman(xR, yR) : pearson(xR, yR)
  return { r, n }
}

export type RStrength = 'strong' | 'moderate' | 'mild' | 'weak'

export function strengthWord(r: number): RStrength {
  const a = Math.abs(r)
  if (a >= 0.6) return 'strong'
  if (a >= 0.4) return 'moderate'
  if (a >= 0.2) return 'mild'
  return 'weak'
}
