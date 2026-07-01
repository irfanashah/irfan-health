// Unit tests for the statistical core (components/dashboard/charts/stats.ts).
//
// Every expected value here is derived independently of the implementation —
// either by hand from the textbook formula (Pearson sum-of-products form,
// Spearman tie-averaged ranks, the Bartlett effective-n closed form, the
// Benjamini-Hochberg step-up procedure) or against a published constant
// (erf(2), Φ(1.96)). Where the closed form is awkward to hand-verify to many
// digits (Fisher-z CI/p), the test builds an independent reference value from
// already-validated primitives (Math.atanh/tanh + this file's own normalCdf)
// rather than calling the function under test twice. None of these assertions
// are "whatever the function currently returns."

import { describe, it, expect } from 'vitest'
import {
  pearson,
  ranks,
  spearman,
  lag1Autocorr,
  effectiveN,
  erf,
  normalCdf,
  ciAndP,
  benjaminiHochberg,
  partialCorr,
  pairedNonNull,
} from './stats'

describe('pearson', () => {
  it('perfect positive correlation = 1', () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBe(1)
  })
  it('perfect negative correlation = -1', () => {
    expect(pearson([1, 2, 3], [3, 2, 1])).toBe(-1)
  })
  it('zero-variance series => 0 (not NaN/divide-by-zero)', () => {
    expect(pearson([2, 2, 2], [1, 2, 3])).toBe(0)
  })
  it('n<2 => 0', () => {
    expect(pearson([1], [1])).toBe(0)
    expect(pearson([], [])).toBe(0)
  })
  it('mismatched lengths => 0', () => {
    expect(pearson([1, 2, 3], [1, 2])).toBe(0)
  })
  it('monotone-nonlinear (x, x^3) is strong but NOT 1 — hand-derived via sum formula', () => {
    // sx=15 sy=225 n=5 sxy=979 sxx=55 syy=20515
    // cov = 979 - 15*225/5 = 304; vx = 55-225/5 = 10; vy = 20515-225^2/5 = 10390
    // r = 304 / sqrt(10*10390) = 304/sqrt(103900)
    const expected = 304 / Math.sqrt(103900)
    const r = pearson([1, 2, 3, 4, 5], [1, 8, 27, 64, 125])
    expect(r).toBeCloseTo(expected, 10)
    expect(r).toBeLessThan(1)
    expect(r).toBeGreaterThan(0.9) // still a strong linear approximation to a monotone curve
  })
})

describe('ranks (tie-averaged, 1-based)', () => {
  it('single tie pair at the bottom: [1,1,2] -> [1.5,1.5,3]', () => {
    expect(ranks([1, 1, 2])).toEqual([1.5, 1.5, 3])
  })
  it('tie pair mid-array with an untied high value: [5,3,3,1] -> [4,2.5,2.5,1]', () => {
    expect(ranks([5, 3, 3, 1])).toEqual([4, 2.5, 2.5, 1])
  })
  it('empty array -> empty', () => {
    expect(ranks([])).toEqual([])
  })
})

describe('spearman', () => {
  it('perfect monotone-nonlinear relationship => 1 even though pearson < 1', () => {
    const x = [1, 2, 3, 4, 5]
    const y = x.map((v) => v ** 3) // strictly increasing => identical rank order
    expect(spearman(x, y)).toBe(1)
    expect(pearson(x, y)).toBeLessThan(1)
  })
  it('n<2 or mismatched length => 0', () => {
    expect(spearman([1], [1])).toBe(0)
    expect(spearman([1, 2], [1])).toBe(0)
  })
})

describe('lag1Autocorr', () => {
  it('n<3 => 0', () => {
    expect(lag1Autocorr([1, 2])).toBe(0)
  })
  it('constant series => 0, never NaN (guards den<=0)', () => {
    const r = lag1Autocorr([5, 5, 5, 5, 5])
    expect(r).toBe(0)
    expect(Number.isNaN(r)).toBe(false)
  })
  it('un-clamped linear ramp of 10 matches the closed form n=10 (rho=0.7 exactly, below clamp)', () => {
    // For x_i = i (0-indexed), rho = 1 - [((n-1)/2)^2 + (n-1)/2] / [n(n^2-1)/12].
    // n=10: (4.5^2+4.5)/82.5 = 24.75/82.5 = 0.3 => rho = 0.7.
    const ramp = Array.from({ length: 10 }, (_, i) => i + 1)
    expect(lag1Autocorr(ramp)).toBeCloseTo(0.7, 10)
  })
  it('clamps to +0.99 when the true autocorrelation exceeds it (long ramp)', () => {
    const n = 500
    const ramp = Array.from({ length: n }, (_, i) => i)
    // Same closed form as above, evaluated independently of the function under test.
    const half = (n - 1) / 2
    const den = (n * (n * n - 1)) / 12
    const trueRho = 1 - (half * half + half) / den
    expect(trueRho).toBeGreaterThan(0.99) // confirms the clamp is actually exercised
    expect(lag1Autocorr(ramp)).toBe(0.99)
  })
  it('clamps to -0.99 when the true (anti-)autocorrelation exceeds it in magnitude (period-2 alternation)', () => {
    // For period-2 alternation 0,A,0,A,... of even length n, rho = -(n-1)/n exactly.
    const n = 200
    const alt = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0 : 10))
    const trueRho = -(n - 1) / n
    expect(Math.abs(trueRho)).toBeGreaterThan(0.99)
    expect(lag1Autocorr(alt)).toBe(-0.99)
  })
})

describe('effectiveN', () => {
  it('n<4 => max(0, n)', () => {
    expect(effectiveN([1, 2], [3, 4])).toBe(2)
    expect(effectiveN([], [])).toBe(0)
  })
  it('zero lag-1 autocorrelation on both sides => n_eff == n (no shrinkage)', () => {
    // [0,1,0,-1] has lag1Autocorr === 0 exactly (verified: den=2, num=0).
    const x = [0, 1, 0, -1]
    const y = [0, 2, 0, -2]
    expect(lag1Autocorr(x)).toBe(0)
    expect(lag1Autocorr(y)).toBe(0)
    expect(effectiveN(x, y)).toBe(4)
  })
  it('both strongly positively autocorrelated => n_eff shrinks below n, floored at 4', () => {
    // Two copies of the rho=0.7 ramp: prod=0.49, ratio=(1-0.49)/(1+0.49)=51/149≈0.3423.
    // n*ratio = 10*0.3423 ≈ 3.42 < 4 => floored to 4.
    const ramp = Array.from({ length: 10 }, (_, i) => i + 1)
    expect(effectiveN(ramp, ramp)).toBe(4)
    expect(effectiveN(ramp, ramp)).toBeLessThan(10)
  })
  it('anti-correlated lag-1 terms (product < 0) inflate the ratio but never exceed n', () => {
    // x has rho=-0.75 (period-2 alternation, n=4); y is a ramp with rho=0.25 (n=4).
    // product = -0.1875 < 0 => ratio = (1-(-0.1875))/(1+(-0.1875)) = 1.1875/0.8125 > 1,
    // but Math.min(n, n*ratio) caps the result at n.
    const x = [0, 10, 0, 10]
    const y = [1, 2, 3, 4]
    expect(effectiveN(x, y)).toBe(4) // === n, not exceeding it
  })
})

describe('erf / normalCdf (Abramowitz-Stegun approximation)', () => {
  it('erf(0) = 0', () => {
    expect(erf(0)).toBeCloseTo(0, 6)
  })
  it('odd symmetry: erf(-x) = -erf(x)', () => {
    for (const x of [0.1, 0.5, 1, 1.5, 2, 3]) {
      expect(erf(-x)).toBe(-erf(x))
    }
  })
  it('erf(2) matches the published constant within the documented ~1.5e-7 error', () => {
    expect(erf(2)).toBeCloseTo(0.9953222650189527, 6)
  })
  it('normalCdf(0) = 0.5', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
  })
  it('normalCdf(1.96) matches the published two-sided-95% constant 0.97500210...', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 6)
  })
})

describe('ciAndP', () => {
  it('nEff<=3 guards to the maximally-uninformative result regardless of r', () => {
    expect(ciAndP(0.5, 3)).toEqual({ r: 0.5, ciLow: -1, ciHigh: 1, p: 1, nEff: 3 })
    expect(ciAndP(0.9, 2)).toEqual({ r: 0.9, ciLow: -1, ciHigh: 1, p: 1, nEff: 2 })
  })
  it('r=0 => p=1 exactly (z=0, zScore=0, normalCdf(0)=0.5) and a symmetric CI around 0', () => {
    const sig = ciAndP(0, 20)
    expect(sig.p).toBeCloseTo(1, 6)
    expect(sig.ciLow).toBeCloseTo(-sig.ciHigh, 10)
    expect(sig.ciLow).toBeLessThan(0)
    expect(sig.ciHigh).toBeGreaterThan(0)
  })
  it('matches an independently-assembled Fisher-z reference built from validated primitives', () => {
    // Reference computed here via Math.atanh/tanh + this file's own (separately
    // validated above) normalCdf — NOT by calling ciAndP twice.
    const r = 0.45
    const nEff = 25
    const z = Math.atanh(r)
    const se = 1 / Math.sqrt(nEff - 3)
    const refCiLow = Math.tanh(z - 1.96 * se)
    const refCiHigh = Math.tanh(z + 1.96 * se)
    const refP = 2 * (1 - normalCdf(Math.abs(z * Math.sqrt(nEff - 3))))

    const sig = ciAndP(r, nEff)
    expect(sig.ciLow).toBeCloseTo(refCiLow, 10)
    expect(sig.ciHigh).toBeCloseTo(refCiHigh, 10)
    expect(sig.p).toBeCloseTo(refP, 10)
    // CI brackets r (sanity property any correct CI must satisfy).
    expect(sig.ciLow).toBeLessThan(r)
    expect(sig.ciHigh).toBeGreaterThan(r)
  })
  it('non-finite r is rejected by the same guard as low nEff', () => {
    expect(ciAndP(NaN, 20).p).toBe(1)
  })
})

describe('benjaminiHochberg', () => {
  it('hand-worked example: evenly-spaced p-values all collapse to the same q', () => {
    // p_i * m / rank: 0.01*5/1=.05, 0.02*5/2=.05, 0.03*5/3=.05, 0.04*5/4=.05, 0.05*5/5=.05
    // Already monotone non-increasing as rank increases (constant) -> no adjustment needed.
    const entries = [0.01, 0.02, 0.03, 0.04, 0.05].map((p, i) => ({ key: `k${i}`, p }))
    const q = benjaminiHochberg(entries)
    for (const e of entries) expect(q[e.key]).toBeCloseTo(0.05, 10)
  })
  it('all-equal p-values collapse (via monotonicity) to exactly p itself', () => {
    // Raw q for i=0,1,2 (m=3): 0.09, 0.045, 0.03. Enforcing monotone-non-decreasing
    // from the top down forces all three down to the last (smallest) raw q = 0.03.
    const entries = [0.03, 0.03, 0.03].map((p, i) => ({ key: `k${i}`, p }))
    const q = benjaminiHochberg(entries)
    expect(q.k0).toBeCloseTo(0.03, 10)
    expect(q.k1).toBeCloseTo(0.03, 10)
    expect(q.k2).toBeCloseTo(0.03, 10)
  })
  it('single entry: q = p', () => {
    expect(benjaminiHochberg([{ key: 'a', p: 0.2 }])).toEqual({ a: 0.2 })
  })
  it('empty input => empty map', () => {
    expect(benjaminiHochberg([])).toEqual({})
  })
  it('output q is monotone non-decreasing in p-order for an arbitrary unsorted family', () => {
    const ps = [0.5, 0.001, 0.2, 0.04, 0.03, 0.9, 0.12]
    const entries = ps.map((p, i) => ({ key: `k${i}`, p }))
    const q = benjaminiHochberg(entries)
    const sortedByP = [...entries].sort((a, b) => a.p - b.p)
    for (let i = 1; i < sortedByP.length; i++) {
      expect(q[sortedByP[i].key]).toBeGreaterThanOrEqual(q[sortedByP[i - 1].key] - 1e-12)
    }
  })
})

describe('partialCorr', () => {
  it('a covariate that fully (linearly, noiselessly) explains both X and Y drives partial r to exactly 0', () => {
    // c=1..10; x=2c; y=3c => raw pearson(x,y)=1, but x and y are EXACTLY linear in c
    // with exact-integer OLS coefficients (slope 2 and 3, intercept 0 — verified by
    // hand: e.g. for x, slope=(n*sxy-sx*sy)/(n*sxx-sx^2)=(10*770-55*110)/(10*385-55^2)
    // =1650/825=2 exactly), so residuals are exactly zero and the "link" disappears.
    const c = Array.from({ length: 10 }, (_, i) => i + 1)
    const x = c.map((v) => 2 * v)
    const y = c.map((v) => 3 * v)
    expect(pearson(x, y)).toBe(1) // confirm the raw link is real before controlling it away
    const result = partialCorr(x, y, [c], 'spearman')
    expect(result.r).toBe(0)
    expect(result.n).toBe(10)
  })
  it('controlling for a covariate that carries no information (constant) leaves r unchanged', () => {
    // Residualising against a constant covariate is pure mean-centering, which both
    // pearson and spearman are invariant to by construction (shift-invariance) —
    // so the partial r must equal the raw r exactly.
    const x = [1, 2, 3, 4, 5]
    const y = [2, 1, 4, 3, 5]
    const constCov = [9, 9, 9, 9, 9]
    const raw = pearson(x, y)
    const result = partialCorr(x, y, [constCov], 'pearson')
    expect(raw).not.toBe(0) // make sure this is a non-degenerate case
    expect(result.r).toBeCloseTo(raw, 10)
  })
  it('n<4 => r=0 guard', () => {
    expect(partialCorr([1, 2], [1, 2], [[1, 1]]).r).toBe(0)
  })
})

describe('pairedNonNull', () => {
  it('drops indices where either side is null or non-finite, preserving alignment', () => {
    const out = pairedNonNull([1, null, 3, NaN, 5], [10, 20, null, 40, 50])
    expect(out).toEqual({ xs: [1, 5], ys: [10, 50], idx: [0, 4], n: 2 })
  })
  it('all-null input => empty result', () => {
    expect(pairedNonNull([null, null], [null, null])).toEqual({ xs: [], ys: [], idx: [], n: 0 })
  })
})
