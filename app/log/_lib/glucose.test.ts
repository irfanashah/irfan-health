// Unit tests for the glucose unit conversion (mmol/L <-> mg/dL), shared
// across Slice 3 manual entry, Nightscout, and the Contour parser.

import { describe, it, expect } from 'vitest'
import { mgdlToMmol, mmolToMgdl, roundTo1dp } from './glucose'

describe('mgdlToMmol', () => {
  it('90 mg/dL => 5.0 mmol/L (90 / 18.0)', () => {
    expect(mgdlToMmol(90)).toBe(5.0)
  })
  it('180 mg/dL => 10.0 mmol/L', () => {
    expect(mgdlToMmol(180)).toBe(10.0)
  })
  it('rounds to 1 decimal place: 108 / 18 = 6.0 exactly; 100 / 18 = 5.555... => 5.6', () => {
    expect(mgdlToMmol(108)).toBe(6.0)
    expect(mgdlToMmol(100)).toBe(5.6)
  })
})

describe('mmolToMgdl', () => {
  it('5.0 mmol/L => 90 mg/dL (round-trips with mgdlToMmol)', () => {
    expect(mmolToMgdl(5.0)).toBe(90)
  })
  it('rounds to the nearest integer', () => {
    expect(mmolToMgdl(5.56)).toBe(Math.round(5.56 * 18.0))
  })
})

describe('roundTo1dp', () => {
  it('rounds half-up to 1 decimal', () => {
    expect(roundTo1dp(5.55)).toBe(5.6) // 55.5 rounds up under Math.round
    expect(roundTo1dp(5.04)).toBe(5.0)
    expect(roundTo1dp(5.0)).toBe(5.0)
  })
})
