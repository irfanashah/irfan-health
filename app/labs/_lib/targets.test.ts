// Unit tests for evaluateLabMarker — the single-source-of-truth clinical
// goal-state classifier for cardiac lab markers. Expected values were
// hand-derived from the documented goal/near/off rules and the LAB_TARGETS
// table, then cross-checked by running this exact data through the
// function once before locking the assertions in (catching arithmetic
// slips, not deriving the expectation from the function's behavior).

import { describe, it, expect } from 'vitest'
import { evaluateLabMarker, LAB_TARGETS } from './targets'
import type { MarkerTrend, MarkerTrendPoint } from '@/app/labs/actions'

function pt(value: number, drawn_at: string, unit = 'mmol/L'): MarkerTrendPoint {
  return { drawn_at, value, ref_low: null, ref_high: null, ref_source: null, flag: null, unit, valueSource: 'canonical' } as MarkerTrendPoint
}
function trend(slug: string, points: MarkerTrendPoint[]): MarkerTrend {
  return { marker_slug: slug, display: slug, canonical_unit: 'mmol/L', points }
}

describe('evaluateLabMarker — LDL ("lower" direction)', () => {
  it('at-goal: latest <= target (1.4)', () => {
    expect(evaluateLabMarker(trend('ldl', [pt(1.2, '2026-01-01')])).goalState).toBe('at-goal')
    expect(evaluateLabMarker(trend('ldl', [pt(1.4, '2026-01-01')])).goalState).toBe('at-goal')
  })
  it('near: target < latest <= target+nearBuffer (1.4-1.6)', () => {
    expect(evaluateLabMarker(trend('ldl', [pt(1.5, '2026-01-01')])).goalState).toBe('near')
    expect(evaluateLabMarker(trend('ldl', [pt(1.59, '2026-01-01')])).goalState).toBe('near')
    // NB: latest===1.6 exactly is a known boundary bug, not asserted here —
    // see the code-review report filed alongside this suite. 1.4+0.2 is
    // 1.5999999999999999 in IEEE754, so goalStateLower's `value <= goal+near`
    // misclassifies the documented boundary value itself as 'off-goal'.
  })
  it('off-goal: latest > 1.6', () => {
    expect(evaluateLabMarker(trend('ldl', [pt(1.61, '2026-01-01')])).goalState).toBe('off-goal')
    expect(evaluateLabMarker(trend('ldl', [pt(2.0, '2026-01-01')])).goalState).toBe('off-goal')
  })
  it('reductionPct + meetsReductionGoal, hand-derived: (3.8-1.5)/3.8*100 = 60.5263...%, >=50 => true', () => {
    const r = evaluateLabMarker(
      trend('ldl', [pt(3.8, '2025-01-01'), pt(2.5, '2025-06-01'), pt(1.5, '2026-01-01')]),
    )
    expect(r.reductionPct).toBeCloseTo((2.3 / 3.8) * 100, 10)
    expect(r.meetsReductionGoal).toBe(true)
    expect(r.delta).toBeCloseTo(-1, 10) // 1.5 - 2.5
    expect(r.deltaPct).toBeCloseTo(-40, 10) // -1/2.5*100
    expect(r.trend).toBe('improving') // lower marker, latest < prior
  })
  it('reductionPct below the 50% goal => meetsReductionGoal=false: (3.8-2.0)/3.8*100=47.368...%', () => {
    const r = evaluateLabMarker(trend('ldl', [pt(3.8, '2025-01-01'), pt(2.0, '2026-01-01')]))
    expect(r.reductionPct).toBeCloseTo((1.8 / 3.8) * 100, 10)
    expect(r.meetsReductionGoal).toBe(false)
  })
  it('single draw => trend stays null (sparse-safe), but goalState still computes from latest alone', () => {
    const r = evaluateLabMarker(trend('ldl', [pt(1.4, '2026-01-01')]))
    expect(r.trend).toBeNull()
    expect(r.goalState).toBe('at-goal')
  })
  it('worsening + flat trend directions', () => {
    expect(evaluateLabMarker(trend('ldl', [pt(1.5, 'a'), pt(2.0, 'b')])).trend).toBe('worsening')
    // within ~2% of latest magnitude => flat
    expect(evaluateLabMarker(trend('ldl', [pt(1.5, 'a'), pt(1.501, 'b')])).trend).toBe('flat')
  })
  it('ldl is modifiable', () => {
    expect(evaluateLabMarker(trend('ldl', [pt(1.2, 'a')])).modifiable).toBe(true)
  })

  // KNOWN BUG (found while writing this suite, reported separately — not
  // patched here): goalStateLower's `value <= goal + near` boundary check is
  // floating-point-exact, and 1.4 + 0.2 === 1.5999999999999999 in IEEE754.
  // So a real LDL reading of EXACTLY 1.6 mmol/L — the documented edge of the
  // "near" band — is misclassified as 'off-goal'. `it.fails` keeps this
  // tracked without failing the suite; if it's fixed, this test starts
  // failing too, which is the prompt to delete the `.fails` marker.
  it.fails('1.6 mmol/L (the documented near-goal boundary) should classify as "near", not "off-goal"', () => {
    expect(evaluateLabMarker(trend('ldl', [pt(1.6, '2026-01-01')])).goalState).toBe('near')
  })
})

describe('evaluateLabMarker — Lp(a) unit-match (mg/dL vs nmol/L, assay-dependent)', () => {
  it('mg/dL point resolves against the 50 mg/dL threshold', () => {
    const r = evaluateLabMarker(trend('lipoprotein_a', [pt(40, '2026-01-01', 'mg/dL')]))
    expect(r.goalLine).toBe(50)
    expect(r.goalState).toBe('at-goal')
    expect(r.unmatchedReason).toBeNull()
  })
  it('nmol/L point resolves against the 125 nmol/L threshold, NOT the mg/dL number', () => {
    const r = evaluateLabMarker(trend('lipoprotein_a', [pt(100, '2026-01-01', 'nmol/L')]))
    expect(r.goalLine).toBe(125)
    expect(r.goalState).toBe('at-goal')
  })
  it('an unrecognised unit resolves to goalState=null + an explicit reason — never coerced', () => {
    const r = evaluateLabMarker(trend('lipoprotein_a', [pt(40, '2026-01-01', 'umol/L')]))
    expect(r.goalLine).toBeNull()
    expect(r.goalState).toBeNull()
    expect(r.unmatchedReason).toMatch(/umol\/L/)
  })
  it('Lp(a) and HDL are flagged non-modifiable (informational, never an action item)', () => {
    expect(evaluateLabMarker(trend('lipoprotein_a', [pt(40, 'a', 'mg/dL')])).modifiable).toBe(false)
    expect(evaluateLabMarker(trend('hdl', [pt(1.2, 'a')])).modifiable).toBe(false)
    expect(LAB_TARGETS.lipoprotein_a.modifiable).toBe(false)
  })
})

describe('evaluateLabMarker — "higher" direction (HDL) and "range" direction (HbA1c)', () => {
  it('HDL: at-goal >=1.0, near in [0.9,1.0), off-goal <0.9', () => {
    expect(evaluateLabMarker(trend('hdl', [pt(1.2, 'a')])).goalState).toBe('at-goal')
    expect(evaluateLabMarker(trend('hdl', [pt(0.95, 'a')])).goalState).toBe('near')
    expect(evaluateLabMarker(trend('hdl', [pt(0.7, 'a')])).goalState).toBe('off-goal')
  })
  it('HbA1c range: at-goal <=5.7, near (5.7,6.4], off-goal >6.4', () => {
    expect(evaluateLabMarker(trend('hba1c', [pt(5.5, 'a', '%')])).goalState).toBe('at-goal')
    expect(evaluateLabMarker(trend('hba1c', [pt(6.0, 'a', '%')])).goalState).toBe('near')
    expect(evaluateLabMarker(trend('hba1c', [pt(7.0, 'a', '%')])).goalState).toBe('off-goal')
  })
})

describe('evaluateLabMarker — no target configured', () => {
  it('delta/deltaPct still compute (useful direction signal), but trend and goalState stay null', () => {
    const r = evaluateLabMarker(trend('sodium_not_a_cardiac_target', [pt(140, 'a'), pt(142, 'b')]))
    expect(r.delta).toBeCloseTo(2, 10)
    expect(r.deltaPct).toBeCloseTo((2 / 140) * 100, 10)
    expect(r.trend).toBeNull()
    expect(r.goalState).toBeNull()
    expect(r.target).toBeNull()
  })
})
