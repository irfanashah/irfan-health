// Unit tests for computeFlag — the single source of truth for lab H/L/HH/LL
// flags. The HH/LL rule is the highest-consequence boundary in the whole
// platform (a panic flag on a cardiac patient's potassium/sodium): it must
// fire ONLY from an explicit critical threshold, never inferred from "value
// further out than refHigh."

import { describe, it, expect } from 'vitest'
import { computeFlag } from './ranges'

const base = { value: 5, refLow: 3, refHigh: 10, criticalLow: null, criticalHigh: null, labFlag: null }

describe('computeFlag', () => {
  it('lab-printed flag wins, even if the computed flag would disagree', () => {
    expect(computeFlag({ ...base, value: 5, labFlag: 'H' })).toBe('H') // 5 is well inside [3,10] but lab said H
  })
  it('no value or no range at all => null (never a misleading "N")', () => {
    expect(computeFlag({ ...base, value: null })).toBeNull()
    expect(computeFlag({ ...base, refLow: null, refHigh: null })).toBeNull()
  })
  it('computes H/L/N from the reference range when no lab flag is present', () => {
    expect(computeFlag({ ...base, value: 12 })).toBe('H') // > refHigh
    expect(computeFlag({ ...base, value: 1 })).toBe('L') // < refLow
    expect(computeFlag({ ...base, value: 5 })).toBe('N') // inside range
  })
  it('one-sided ranges work (only refHigh or only refLow set)', () => {
    expect(computeFlag({ ...base, refLow: null, value: 12 })).toBe('H')
    expect(computeFlag({ ...base, refLow: null, value: 1 })).toBe('N') // no low bound => can't be L
    expect(computeFlag({ ...base, refHigh: null, value: 1 })).toBe('L')
  })
  it('HH/LL fire ONLY from an explicit critical threshold, never inferred from "far outside refHigh"', () => {
    // value=50 is WAY past refHigh=10, but with no criticalHigh configured
    // this must stay 'H', never auto-escalate to 'HH'.
    expect(computeFlag({ ...base, value: 50, criticalHigh: null })).toBe('H')
    // Same magnitude, but now a critical threshold is explicitly configured
    // and crossed => HH.
    expect(computeFlag({ ...base, value: 50, criticalHigh: 20 })).toBe('HH')
    expect(computeFlag({ ...base, value: 19, criticalHigh: 20 })).toBe('H') // above refHigh, below critical => H not HH
  })
  it('LL mirrors HH on the low side', () => {
    expect(computeFlag({ ...base, value: -5, criticalLow: null })).toBe('L')
    expect(computeFlag({ ...base, value: -5, criticalLow: 0 })).toBe('LL')
  })
})
