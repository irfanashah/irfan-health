// Unit tests locking in the H6 fix (backlog H6 / gotcha #156): a CGM
// reading must stop counting as "live" once it's old enough that treating
// it as current is misleading, and a 24h TIR donut built from too few
// readings must not present itself as full-day coverage. Expected values
// below are hand-derived from the constants, not copied from the
// implementation's own output.

import { describe, it, expect } from 'vitest'
import {
  computeCgmFreshness,
  computeCgmWear,
  computeCgmTrend,
  CGM_STALE_MINUTES,
  TIR_MIN_WEAR_HOURS,
  CGM_EXPECTED_INTERVAL_MIN,
  CGM_TREND_THRESHOLD_MMOL_PER_MIN,
} from './daily-metrics'

describe('computeCgmFreshness', () => {
  const NOW = new Date('2026-07-06T12:00:00.000Z').getTime()

  it('a 5-minute-old reading is live', () => {
    const lastTime = new Date(NOW - 5 * 60000).toISOString()
    const result = computeCgmFreshness(lastTime, NOW)
    expect(result.ageMin).toBe(5)
    expect(result.stale).toBe(false)
  })

  it('a reading exactly at the staleness boundary (30 min) is still live', () => {
    const lastTime = new Date(NOW - CGM_STALE_MINUTES * 60000).toISOString()
    const result = computeCgmFreshness(lastTime, NOW)
    expect(result.ageMin).toBe(30)
    expect(result.stale).toBe(false)
  })

  it('a reading 1 minute past the boundary (31 min) is stale', () => {
    const lastTime = new Date(NOW - 31 * 60000).toISOString()
    const result = computeCgmFreshness(lastTime, NOW)
    expect(result.ageMin).toBe(31)
    expect(result.stale).toBe(true)
  })

  it('a 20-hour-old reading (the exact bug scenario) is stale', () => {
    const lastTime = new Date(NOW - 20 * 60 * 60000).toISOString()
    const result = computeCgmFreshness(lastTime, NOW)
    expect(result.ageMin).toBe(1200)
    expect(result.stale).toBe(true)
  })
})

describe('computeCgmWear', () => {
  it('288 readings (5-min cadence over a full 24h day) is full wear, not partial', () => {
    const result = computeCgmWear(288)
    expect(result.wearHours).toBe(288 * (CGM_EXPECTED_INTERVAL_MIN / 60))
    expect(result.wearHours).toBe(24)
    expect(result.partial).toBe(false)
  })

  it('144 readings (exactly the 12h minimum) is not partial', () => {
    const result = computeCgmWear(144)
    expect(result.wearHours).toBe(TIR_MIN_WEAR_HOURS)
    expect(result.partial).toBe(false)
  })

  it('143 readings (1 short of the 12h minimum) is partial', () => {
    const result = computeCgmWear(143)
    expect(result.wearHours).toBeCloseTo(11.9167, 3)
    expect(result.partial).toBe(true)
  })

  it('0 readings is partial', () => {
    const result = computeCgmWear(0)
    expect(result.wearHours).toBe(0)
    expect(result.partial).toBe(true)
  })
})

describe('computeCgmTrend (L7 — slope from real timestamps, not a fixed index)', () => {
  // Threshold is 0.036 mmol/min (≈ the old 0.18-per-5min-interval sensitivity).
  it('flat/empty series → flat, slope 0', () => {
    expect(computeCgmTrend([])).toEqual({ trendDir: 'flat', slope: 0 })
    expect(computeCgmTrend([{ time: '2026-07-06T12:00:00.000Z', mmol: 5.5 }]))
      .toEqual({ trendDir: 'flat', slope: 0 })
  })

  it('uniform 5-min rising over 15 min → rising, slope in mmol/min', () => {
    const pts = [
      { time: '2026-07-06T12:00:00.000Z', mmol: 5.0 },
      { time: '2026-07-06T12:05:00.000Z', mmol: 5.3 },
      { time: '2026-07-06T12:10:00.000Z', mmol: 5.6 },
      { time: '2026-07-06T12:15:00.000Z', mmol: 6.0 },
    ]
    // ref = first point ≥15 min old = 12:00. slope = (6.0-5.0)/15 = 0.0667.
    const r = computeCgmTrend(pts)
    expect(r.slope).toBeCloseTo(1.0 / 15, 5)
    expect(r.trendDir).toBe('rising')
    expect(r.slope).toBeGreaterThan(CGM_TREND_THRESHOLD_MMOL_PER_MIN)
  })

  it('uniform falling → falling', () => {
    const pts = [
      { time: '2026-07-06T12:00:00.000Z', mmol: 7.0 },
      { time: '2026-07-06T12:05:00.000Z', mmol: 6.6 },
      { time: '2026-07-06T12:10:00.000Z', mmol: 6.2 },
      { time: '2026-07-06T12:15:00.000Z', mmol: 6.0 },
    ]
    // (6.0-7.0)/15 = -0.0667 < -0.036 → falling.
    const r = computeCgmTrend(pts)
    expect(r.slope).toBeCloseTo(-1.0 / 15, 5)
    expect(r.trendDir).toBe('falling')
  })

  it('small change over 15 min → flat (below threshold)', () => {
    const pts = [
      { time: '2026-07-06T12:00:00.000Z', mmol: 6.0 },
      { time: '2026-07-06T12:15:00.000Z', mmol: 6.3 },
    ]
    // (6.3-6.0)/15 = 0.02 mmol/min < 0.036 → flat.
    const r = computeCgmTrend(pts)
    expect(r.slope).toBeCloseTo(0.02, 5)
    expect(r.trendDir).toBe('flat')
  })

  it('after a gap: slope uses the REAL elapsed minutes, not a fixed /3 index', () => {
    // The old code did (last - points[len-4]) / 3, assuming 5-min spacing.
    // Here the reference point is 20 min before the last reading (a gap), so
    // the honest slope is Δ/20, not Δ/3. This is the L7 fix.
    const pts = [
      { time: '2026-07-06T10:00:00.000Z', mmol: 5.0 },
      { time: '2026-07-06T11:55:00.000Z', mmol: 5.0 },
      { time: '2026-07-06T12:15:00.000Z', mmol: 6.0 },
    ]
    // ref = first point ≥15 min old (walking newest→oldest) = 11:55 (20 min).
    // slope = (6.0-5.0)/20 = 0.05 mmol/min. The old /3 would have given 0.333.
    const r = computeCgmTrend(pts)
    expect(r.slope).toBeCloseTo(0.05, 5)
    expect(r.trendDir).toBe('rising') // 0.05 > 0.036
  })
})
