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

export type RStrength = 'strong' | 'moderate' | 'mild' | 'weak'

export function strengthWord(r: number): RStrength {
  const a = Math.abs(r)
  if (a >= 0.6) return 'strong'
  if (a >= 0.4) return 'moderate'
  if (a >= 0.2) return 'mild'
  return 'weak'
}
