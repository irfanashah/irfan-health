// Unit tests locking in the clinical-low breach precedence invariant
// (backlog H5 / gotcha #153): a hard clinical-floor breach must ALWAYS
// surface as `state: 'safety'` — never hidden behind `establishing` and
// never demoted by alert suppression. These are the two exact scenarios
// the backlog found broken; both are asserted directly, not inferred.

import { describe, it, expect } from 'vitest'
import { buildSignal, type PerSignalInput } from './present'
import { DRIFT_CONFIG } from '../drift-config'
import type { DriftVerdict } from './evaluate'
import type { MetricDriftRow } from '@/app/lib/dashboard/baselines'

function mkRow(overrides: Partial<MetricDriftRow> = {}): MetricDriftRow {
  return {
    date: '2026-07-01',
    metric: 'sys',
    today_value: 84,
    rolling_median: 120,
    rolling_mad: 5,
    rolling_n: 20,
    today_z: null,
    short_median: 100,
    short_n: 3,
    prior_median: 120,
    prior_mad: 5,
    prior_n: 8,
    short_vs_prior_delta: -20,
    short_vs_prior_z: -4,
    anchor_median: null,
    anchor_mad: null,
    anchor_n: null,
    short_vs_anchor_delta: null,
    short_vs_anchor_z: null,
    ...overrides,
  }
}

function mkVerdict(overrides: Partial<DriftVerdict> = {}): DriftVerdict {
  const row = mkRow()
  return {
    metric: 'sys',
    config: DRIFT_CONFIG.sys,
    state: 'active',
    tier: 'stable',
    baselineUsed: 'rolling',
    latest: row,
    heldDays: 0,
    shiftConcerning: null,
    shiftDelta: null,
    shiftZ: null,
    clinicalLow: 'normal',
    alertsSuppressed: false,
    suppressedBy: null,
    medReset: null,
    callout: null,
    ...overrides,
  }
}

function buildInput(overrides: Partial<DriftVerdict> = {}): PerSignalInput {
  return { verdict: mkVerdict(overrides), rows: [mkRow()], daysBack: 30 }
}

describe('buildSignal — clinical-low breach precedence (H5)', () => {
  it('a breach during a normal active state surfaces as safety (sanity baseline)', () => {
    const signal = buildSignal(buildInput({ state: 'active', clinicalLow: 'breach' }))
    expect(signal.state).toBe('safety')
  })

  it('BUG SCENARIO 1 — a breach during `establishing` must still surface as safety, not settling', () => {
    // sys LOW_FLOORS.floor = 90; today_value=84 in mkRow() is a real breach.
    // evaluate.ts computes clinicalLow from the real value even while
    // establishing (verified against evaluate.ts:169) — present.ts must not
    // discard that by checking `establishing` first.
    const signal = buildSignal(buildInput({ state: 'establishing', clinicalLow: 'breach' }))
    expect(signal.state).toBe('safety')
    expect(signal.state).not.toBe('settling')
  })

  it('BUG SCENARIO 2 — a breach while alerts are suppressed must still surface as safety, not steady', () => {
    const signal = buildSignal(buildInput({ state: 'active', clinicalLow: 'breach', alertsSuppressed: true }))
    expect(signal.state).toBe('safety')
    expect(signal.state).not.toBe('steady')
    // `paused` is still tracked (for other tiers' "paused" chip) — breach
    // just doesn't let it demote the tier itself.
    expect(signal.paused).toBe(true)
  })

  it('combined worst case — establishing AND suppressed AND breach — safety still wins', () => {
    const signal = buildSignal(
      buildInput({ state: 'establishing', clinicalLow: 'breach', alertsSuppressed: true }),
    )
    expect(signal.state).toBe('safety')
  })

  it('no-recent-data never actually produces a breach (evaluate.ts hardcodes clinicalLow=normal there) — regression guard', () => {
    const signal = buildSignal(buildInput({ state: 'no-recent-data', clinicalLow: 'normal', latest: null }))
    expect(signal.state).toBe('nodata')
  })

  it('non-breach caution handling is unchanged: still demoted to steady when suppressed', () => {
    const signal = buildSignal(buildInput({ state: 'active', clinicalLow: 'caution', alertsSuppressed: true }))
    expect(signal.state).toBe('steady')
  })

  it('non-breach caution handling is unchanged: surfaces as drift+caution when not suppressed', () => {
    const signal = buildSignal(buildInput({ state: 'active', clinicalLow: 'caution', alertsSuppressed: false }))
    expect(signal.state).toBe('drift')
    expect(signal.caution).toBe(true)
  })
})
