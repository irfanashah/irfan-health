// Unit tests for the lagged-association discovery engine
// (components/dashboard/connections/engine.ts).
//
// `discoverConnections` runs over the full ENGINE_METRIC_IDS catalog (27
// metrics -> ~2,450 pair x direction x lag tests after BH-FDR), so the
// "synthetic dataset" tests below build a full 27-column DailyMetricRow[]
// series using a deterministic PRNG (mulberry32, fixed seed) for the noise
// metrics — deterministic so the test never flakes, "noisy" so it actually
// exercises the FDR gate rather than testing on suspiciously clean data.
// Expected values for the noise case (zero survivors) and the signal case
// (the exact lag/strength of the one real relationship) were verified by
// running this exact synthetic data through the engine once, then locked in
// as fixed expectations — i.e. the assertions encode "this specific
// independently-constructed signal must be found, and nothing else may be,"
// not "whatever today's code returns."

import { describe, it, expect } from 'vitest'
import {
  detrendRollingMedian,
  buildExclusionMask,
  applyExclusionsToSeries,
  laggedProfile,
  discoverConnections,
  DERIVED_PAIRS,
  pairKey,
} from './engine'
import { ENGINE_METRIC_IDS } from './metrics'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

// ─── Deterministic PRNG (mulberry32) — fixed seed, reproducible noise ──────
function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function noiseSeries(n: number, rnd: () => number, scale = 10, base = 50): number[] {
  return Array.from({ length: n }, () => base + (rnd() - 0.5) * scale)
}

/** Build a full synthetic DailyMetricRow[] from per-metric column overrides. */
function buildRows(n: number, cols: Partial<Record<string, (number | null)[]>>): DailyMetricRow[] {
  const dates = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000)
    return d.toISOString().slice(0, 10)
  })
  const get = (id: string): (number | null)[] => cols[id] ?? new Array(n).fill(null)
  return Array.from({ length: n }, (_, i) => ({
    date: dates[i],
    sys: get('sys')[i], dia: get('dia')[i], pulse: get('pulse')[i], weight: get('weight')[i],
    recovery: get('recovery')[i], hrv: get('hrv')[i], rhr: get('rhr')[i], strain: get('strain')[i],
    sleep_total: get('sleepHours')[i], sleep_performance: get('sleepQuality')[i],
    sleep_deep: get('sleep_deep')[i], sleep_light: null, sleep_rem: get('sleep_rem')[i], sleep_awake: null,
    fasting: get('fasting')[i], glucose_var: get('glucose_var')[i], tir: get('tir')[i], cgm_count: null,
    spo2_avg: get('spo2_avg')[i], spo2_min: get('spo2_min')[i], spo2_odi: get('spo2_odi')[i],
    spo2_time_below_90: get('spo2_time_below_90')[i], spo2_whoop: null, skin_temp: get('skin_temp')[i],
    carbs_g: get('carbs_g')[i], protein_g: null, fat_g: null, fiber_g: get('fiber_g')[i],
    sugar_g: get('sugar_g')[i], sodium_mg: get('sodium_mg')[i], calories: get('calories')[i],
    evening_carbs_g: get('evening_carbs_g')[i], last_meal_to_sleep_min: get('last_meal_to_sleep_min')[i],
  }))
}

describe('detrendRollingMedian', () => {
  it('flat series => residuals exactly 0 everywhere', () => {
    const out = detrendRollingMedian(new Array(8).fill(5))
    expect(out).toEqual(new Array(8).fill(0))
  })
  it('pure linear ramp => residual ~0 across the interior where the window is fully symmetric', () => {
    // n=41, window=21 (default), half=10. For i in [10,30] the window [i-10,i+10]
    // is fully inside the array, and the median of a symmetric window centred on
    // a linear sequence is exactly the centre value itself => residual 0.
    const ramp = Array.from({ length: 41 }, (_, i) => i)
    const out = detrendRollingMedian(ramp)
    for (let i = 10; i <= 30; i++) expect(out[i]).toBe(0)
  })
  it('nulls are preserved as gaps (never filled, never contribute to the bucket)', () => {
    // [1,null,3,4,5,6,7,8]: bucket at every index = the 7 non-null values [1,3,4,5,6,7,8]
    // (n=8 < window, so start=0/end=7 for all i); median of 7 sorted values = 5.
    const out = detrendRollingMedian([1, null, 3, 4, 5, 6, 7, 8])
    expect(out[1]).toBeNull()
    expect(out[0]).toBe(-4) // 1-5
    expect(out[4]).toBe(0) // 5-5
    expect(out[7]).toBe(3) // 8-5
  })
  it('bucket below minPeriods stays null (insufficient data to detrend)', () => {
    const out = detrendRollingMedian([1, 2, 3], 21, 7)
    expect(out).toEqual([null, null, null])
  })
})

describe('buildExclusionMask / applyExclusionsToSeries', () => {
  const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']
  it('metric-scoped range excludes only the listed metric, on the listed days', () => {
    const mask = buildExclusionMask(
      dates,
      [{ start: '2026-01-02', end: '2026-01-03', metrics: ['rhr'] }],
      ['rhr', 'hrv'],
    )
    expect(mask.rhr).toEqual([false, true, true, false, false])
    expect(mask.hrv).toEqual([false, false, false, false, false]) // not in `metrics` => untouched
  })
  it('global range (no metrics list) excludes every metric', () => {
    const mask = buildExclusionMask(dates, [{ start: '2026-01-01', end: '2026-01-01' }], ['rhr', 'hrv'])
    expect(mask.rhr).toEqual([true, false, false, false, false])
    expect(mask.hrv).toEqual([true, false, false, false, false])
  })
  it('excluded days become null before any downstream computation', () => {
    const mask = buildExclusionMask(dates, [{ start: '2026-01-02', end: '2026-01-03' }], ['rhr'])
    const applied = applyExclusionsToSeries([10, 20, 30, 40, 50], mask.rhr)
    expect(applied).toEqual([10, null, null, 40, 50])
  })
})

describe('laggedProfile (X[t] paired with Y[t+lag])', () => {
  it('correlation peaks exactly at the lag where the relationship was constructed', () => {
    // y[t] = x[t-2] for t>=2 (else null). So pairing x[t] with y[t+L] is a
    // perfect match (x[t] vs x[t]) only at L=2; other lags pair x[t] against
    // an unrelated shift of x and should be weak.
    const x = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8]
    const y: (number | null)[] = [null, null, ...x.slice(0, 10)]
    const profile = laggedProfile(x, y, 3)
    const byLag = new Map(profile.map((p) => [p.lag, p]))
    expect(byLag.get(2)!.rSpearman).toBeCloseTo(1, 10)
    expect(byLag.get(2)!.rPearson).toBeCloseTo(1, 10)
    expect(byLag.get(2)!.n).toBe(10)
    // Every other scanned lag is markedly weaker than the true lag.
    for (const L of [0, 1, 3]) {
      expect(Math.abs(byLag.get(L)!.rSpearman)).toBeLessThan(0.3)
    }
  })
})

describe('discoverConnections — synthetic dataset', () => {
  const N = 120

  it('pure noise on every metric => the gate holds (zero survivors)', () => {
    const rnd = mulberry32(42)
    const cols: Record<string, number[]> = {}
    for (const id of ENGINE_METRIC_IDS) cols[id] = noiseSeries(N, rnd, 10, 50)
    const rows = buildRows(N, cols)
    const result = discoverConnections(rows, [])
    expect(result.connections).toEqual([])
    expect(result.survivors).toBe(0)
    expect(result.totalTests).toBeGreaterThan(2000) // sanity: the full family really ran
  })

  it('one real lag-1 relationship surfaces; a DERIVED_PAIRS pair never does, even when it clears the same gate', () => {
    const rnd = mulberry32(7)
    const cols: Record<string, number[]> = {}
    for (const id of ENGINE_METRIC_IDS) cols[id] = noiseSeries(N, rnd, 10, 50)

    // carbs_g: a periodic wave (no slow trend, so detrending doesn't erase it).
    const carbs = Array.from({ length: N }, (_, t) => 150 + 80 * Math.sin((2 * Math.PI * t) / 14) + (rnd() - 0.5) * 5)
    cols.carbs_g = carbs
    // rhr[t] depends on carbs_g[t-1] (carbs precedes rhr by one day), small noise.
    const rhr = new Array(N).fill(0).map((_, t) => 60 + (t >= 1 ? 0.08 * (carbs[t - 1] - 150) : 0) + (rnd() - 0.5) * 3)
    cols.rhr = rhr
    // sys/dia: a genuinely strong SAME-DAY linear relationship — the natural
    // cuff-derived pair the engine must suppress regardless of strength.
    const sys = Array.from({ length: N }, () => 120 + (rnd() - 0.5) * 20)
    const dia = sys.map((v) => 0.6 * v + (rnd() - 0.5) * 3)
    cols.sys = sys
    cols.dia = dia

    const rows = buildRows(N, cols)
    const result = discoverConnections(rows, [])

    expect(result.survivors).toBe(1)
    const found = result.connections[0]
    expect(new Set([found.x, found.y])).toEqual(new Set(['carbs_g', 'rhr']))
    expect(found.x).toBe('carbs_g') // carbs precedes rhr, not the reverse
    expect(found.y).toBe('rhr')
    expect(found.lag).toBe(1)
    expect(found.direction).toBe('precedes')
    expect(found.rSpearman).toBeGreaterThan(0.9)
    expect(found.q).toBeLessThanOrEqual(0.10)
    expect(found.suppressed).toBe(false)

    // sys/dia is in DERIVED_PAIRS and must never appear in default output...
    expect(DERIVED_PAIRS.has(pairKey('sys', 'dia'))).toBe(true)
    expect(result.connections.some((c) => pairKey(c.x, c.y) === pairKey('sys', 'dia'))).toBe(false)
    // ...even though, checked with includeSuppressed, it genuinely clears the
    // same statistical gate (proving it's suppressed by the derived-pair rule,
    // not just failing on its own merits).
    const withSuppressed = discoverConnections(rows, [], { includeSuppressed: true })
    const sysDia = withSuppressed.connections.find((c) => pairKey(c.x, c.y) === pairKey('sys', 'dia'))
    expect(sysDia).toBeDefined()
    expect(sysDia!.suppressed).toBe(true)
    expect(Math.abs(sysDia!.rSpearman)).toBeGreaterThan(0.3)

    // Associational-language discipline: every surfaced sentence uses only
    // associational verbs, never causal ones (gotcha #38 / #129 family).
    for (const c of result.connections) {
      expect(c.sentence.toLowerCase()).not.toMatch(/caused|led to|because|drove|triggered/)
    }
  })
})
