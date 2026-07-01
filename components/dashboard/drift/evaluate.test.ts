// Unit tests for the drift gate/persistence/recency logic
// (components/dashboard/drift/evaluate.ts), exercised through the public
// `evaluateMetric` API since the gate/persistence/recency/date helpers are
// private. Dates are built relative to the REAL current GST date (computed
// independently here, via the same documented "+4h" rule, not by importing
// or calling anything from evaluate.ts) so the suite never needs to mock the
// clock and never goes stale. Config values (absFloor/zFloor/minN/M) are
// read from the real `drift-config.ts` — these tests assume that file's
// documented thresholds, which is also the surface code-review flagged as
// load-bearing.

import { describe, it, expect } from 'vitest'
import { evaluateMetric } from './evaluate'
import { DRIFT_CONFIG } from '../drift-config'
import type { MetricDriftRow } from '@/app/lib/dashboard/baselines'
import type { DriftMetricId } from '../drift-config'

function todayGST(): string {
  const gst = new Date(Date.now() + 4 * 60 * 60 * 1000)
  return gst.toISOString().slice(0, 10)
}

/** Calendar-day offset from a YYYY-MM-DD date, correct across month/year boundaries. */
function dateOffset(baseISO: string, deltaDays: number): string {
  const d = new Date(baseISO + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

const TODAY = todayGST()

function mkRow(date: string, metric: DriftMetricId, overrides: Partial<MetricDriftRow> = {}): MetricDriftRow {
  return {
    date,
    metric,
    today_value: 60,
    rolling_median: null,
    rolling_mad: null,
    rolling_n: 0,
    today_z: null,
    short_median: null,
    short_n: 0,
    prior_median: null,
    prior_mad: null,
    prior_n: 0,
    short_vs_prior_delta: null,
    short_vs_prior_z: null,
    anchor_median: null,
    anchor_mad: null,
    anchor_n: null,
    short_vs_anchor_delta: null,
    short_vs_anchor_z: null,
    ...overrides,
  }
}

const noCtx = { anchor: null, contextToday: [], medChanges: [] }

describe('evaluateMetric — abs+z AND-gate', () => {
  const rhr = DRIFT_CONFIG.rhr // absFloor=4, zFloor=0.8, minNShort=5, minNPrior=12, M=7

  it('abs passes but z fails => gate does not trip (no watch/drift)', () => {
    const row = mkRow(TODAY, 'rhr', { short_n: 5, prior_n: 12, short_vs_prior_delta: 5, short_vs_prior_z: 0.5 })
    const v = evaluateMetric('rhr', [row], noCtx)
    expect(v.state).toBe('active')
    expect(v.tier).toBe('stable')
    expect(v.heldDays).toBe(0)
  })

  it('z passes but abs fails => gate does not trip', () => {
    const row = mkRow(TODAY, 'rhr', { short_n: 5, prior_n: 12, short_vs_prior_delta: 2, short_vs_prior_z: 2.0 })
    const v = evaluateMetric('rhr', [row], noCtx)
    expect(v.state).toBe('active')
    expect(v.tier).toBe('stable')
    expect(v.heldDays).toBe(0)
  })

  it('both pass => gate trips (single day => forming "watch", not confirmed "drift")', () => {
    expect(rhr.absFloor).toBe(4)
    expect(rhr.zFloor).toBe(0.8)
    const row = mkRow(TODAY, 'rhr', { short_n: 5, prior_n: 12, short_vs_prior_delta: 5, short_vs_prior_z: 1.0 })
    const v = evaluateMetric('rhr', [row], noCtx)
    expect(v.tier).toBe('watch')
    expect(v.heldDays).toBe(1)
  })
})

describe('evaluateMetric — persistence (≥M held data-days in the 14-day look-back)', () => {
  it('exactly M=7 of 14 data-days tripping => confirmed drift', () => {
    expect(DRIFT_CONFIG.rhr.M).toBe(7)
    // Positions 0,2,4,...,12 (7 of 14) trip the gate; today (position 13)
    // does NOT individually cross the floor (delta=1 < absFloor=4) — it only
    // needs to carry the CONCERNING SIGN (delta>0) for `shiftConcerning`,
    // which is a separate check from whether today's own row trips the gate.
    // heldDays must come entirely from the other 7 historical data-days.
    const rows: MetricDriftRow[] = []
    for (let i = 13; i >= 0; i--) {
      const pos = 13 - i // 0 = oldest, 13 = today
      const tripping = pos % 2 === 0
      rows.push(
        mkRow(dateOffset(TODAY, -i), 'rhr', {
          short_n: 5,
          prior_n: 12,
          short_vs_prior_delta: tripping ? 5 : 1,
          short_vs_prior_z: tripping ? 1.0 : 0.1,
        }),
      )
    }
    const trippingCount = rows.filter((r) => Math.abs(r.short_vs_prior_delta ?? 0) >= 4 && Math.abs(r.short_vs_prior_z ?? 0) >= 0.8).length
    expect(trippingCount).toBe(7)
    expect(rows[rows.length - 1].date).toBe(TODAY)
    const v = evaluateMetric('rhr', rows, noCtx)
    expect(v.shiftConcerning).toBe(true) // today's delta=1 is still sign-positive (concerning)
    expect(v.heldDays).toBe(7)
    expect(v.tier).toBe('drift')
  })

  it('only 6 of 14 tripping (today included) => forming "watch", not yet confirmed drift', () => {
    const trippingPositions = new Set([13, 0, 2, 4, 6, 8]) // 6 positions, includes today (pos 13)
    const rows: MetricDriftRow[] = []
    for (let i = 13; i >= 0; i--) {
      const pos = 13 - i
      const tripping = trippingPositions.has(pos)
      rows.push(
        mkRow(dateOffset(TODAY, -i), 'rhr', {
          short_n: 5,
          prior_n: 12,
          short_vs_prior_delta: tripping ? 5 : 1,
          short_vs_prior_z: tripping ? 1.0 : 0.1,
        }),
      )
    }
    const v = evaluateMetric('rhr', rows, noCtx)
    expect(v.heldDays).toBe(6)
    expect(v.tier).toBe('watch')
  })

  it('no carry-forward: a tripping data-day outside the 14-day look-back does not count', () => {
    const rows: MetricDriftRow[] = []
    // 7 tripping rows inside the look-back (every other day, including today).
    for (let i = 6; i >= 0; i--) {
      rows.push(
        mkRow(dateOffset(TODAY, -i * 2), 'rhr', { short_n: 5, prior_n: 12, short_vs_prior_delta: 5, short_vs_prior_z: 1.0 }),
      )
    }
    // An 8th tripping row 20 days ago — outside PERSISTENCE_LOOKBACK_DAYS=14.
    rows.unshift(mkRow(dateOffset(TODAY, -20), 'rhr', { short_n: 5, prior_n: 12, short_vs_prior_delta: 5, short_vs_prior_z: 1.0 }))
    const v = evaluateMetric('rhr', rows, noCtx)
    expect(v.heldDays).toBe(7) // not 8 — the out-of-window row is excluded
    expect(v.tier).toBe('drift')
  })
})

describe('evaluateMetric — recency-to-today guard', () => {
  it('latest data-day > 6 days from today => no-recent-data regardless of stats', () => {
    const row = mkRow(dateOffset(TODAY, -7), 'rhr', { short_n: 1, prior_n: 1 })
    const v = evaluateMetric('rhr', [row], noCtx)
    expect(v.state).toBe('no-recent-data')
    expect(v.latest).not.toBeNull() // the stale row is still surfaced, just not "live"
  })

  it('no rows at all => no-recent-data with latest=null', () => {
    const v = evaluateMetric('rhr', [], noCtx)
    expect(v.state).toBe('no-recent-data')
    expect(v.latest).toBeNull()
  })

  it('exactly 6 days stale is the inclusive boundary — proceeds past the recency guard', () => {
    const row = mkRow(dateOffset(TODAY, -6), 'rhr', { short_n: 1, prior_n: 1 })
    const v = evaluateMetric('rhr', [row], noCtx)
    expect(v.state).not.toBe('no-recent-data')
    expect(v.state).toBe('establishing') // n too low to be active, but recency itself passed
  })

  it('the look-back/recency date math is correct across a calendar-month boundary', () => {
    // dateOffset is real Date.UTC arithmetic, not string slicing — verify the
    // exact case that breaks a naive "subtract from the day digits" approach.
    expect(dateOffset('2026-07-01', -5)).toBe('2026-06-26')
    expect(dateOffset('2026-03-01', -1)).toBe('2026-02-28') // non-leap Feb in 2026
  })
})

describe('evaluateMetric — Win / caution-buffer demotion', () => {
  it('acknowledgeGood=false (rhr) never returns a Win, even on a sustained "good-direction" move', () => {
    expect(DRIFT_CONFIG.rhr.acknowledgeGood).toBe(false)
    const rows: MetricDriftRow[] = []
    for (let i = 6; i >= 0; i--) {
      // concerning='up' for rhr, so delta<0 (RHR falling) is the "good" direction.
      rows.push(mkRow(dateOffset(TODAY, -i), 'rhr', { short_n: 5, prior_n: 12, short_vs_prior_delta: -5, short_vs_prior_z: -1.0 }))
    }
    const v = evaluateMetric('rhr', rows, noCtx)
    expect(v.heldDays).toBe(7)
    expect(v.shiftConcerning).toBe(false) // confirms this really is the "good" direction
    expect(v.tier).not.toBe('win')
    expect(v.tier).toBe('stable')
  })

  it('a value inside the low-floor caution buffer demotes what would otherwise be a Win to stable', () => {
    expect(DRIFT_CONFIG.sys.acknowledgeGood).toBe(true)
    // sys LOW_FLOORS: floor=90, cautionBuffer=5 => [90,95) is "caution".
    const rowsCaution: MetricDriftRow[] = []
    for (let i = 6; i >= 0; i--) {
      rowsCaution.push(
        mkRow(dateOffset(TODAY, -i), 'sys', { short_n: 3, prior_n: 8, short_vs_prior_delta: -6, short_vs_prior_z: -1.0, today_value: 92 }),
      )
    }
    const vCaution = evaluateMetric('sys', rowsCaution, noCtx)
    expect(vCaution.clinicalLow).toBe('caution')
    expect(vCaution.tier).toBe('stable') // demoted from what would be a Win

    // Identical shift, but today_value comfortably clear of the floor => genuine Win.
    const rowsNormal: MetricDriftRow[] = []
    for (let i = 6; i >= 0; i--) {
      rowsNormal.push(
        mkRow(dateOffset(TODAY, -i), 'sys', { short_n: 3, prior_n: 8, short_vs_prior_delta: -6, short_vs_prior_z: -1.0, today_value: 110 }),
      )
    }
    const vNormal = evaluateMetric('sys', rowsNormal, noCtx)
    expect(vNormal.clinicalLow).toBe('normal')
    expect(vNormal.tier).toBe('win')
  })
})
