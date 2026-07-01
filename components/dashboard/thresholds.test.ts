// Unit tests for the single-source-of-truth BP classifier (bpCategory) and
// the low-floor clinical-caution state machine. Boundary values are taken
// directly from the ACC/AHA 2017 category table documented in the file's
// own comments and CLAUDE.md gotcha #81 — independently re-derived here,
// not copied from a prior run of the function.

import { describe, it, expect } from 'vitest'
import { bpCategory, clinicalLowState, LOW_FLOORS, st } from './thresholds'

describe('bpCategory — ACC/AHA 2017 boundary table', () => {
  it('119/79 => Normal', () => {
    expect(bpCategory(119, 79).category).toBe('normal')
  })
  it('125/78 => Elevated (sys 120-129 AND dia<80 — both conditions met)', () => {
    expect(bpCategory(125, 78).category).toBe('elevated')
  })
  it('125/85 => Stage 1, NOT Elevated — the both-conditions trap', () => {
    // sys=125 is in the 120-129 Elevated range, but dia=85 is in the 80-89
    // Stage-1 range. ACC/AHA requires sys 120-129 AND dia<80 for Elevated;
    // since dia fails that, the diastolic Stage-1 condition takes precedence.
    expect(bpCategory(125, 85).category).toBe('stage1')
  })
  it('135/85 => Stage 1 (sys in 130-139)', () => {
    expect(bpCategory(135, 85).category).toBe('stage1')
  })
  it('145/95 => Stage 2 (sys >= 140)', () => {
    expect(bpCategory(145, 95).category).toBe('stage2')
  })
  it('185/125 => Crisis (sys > 180 or dia > 120)', () => {
    expect(bpCategory(185, 125).category).toBe('crisis')
  })
  it('88/55 => Low (sys < 90 floor, takes precedence over any hypertensive read)', () => {
    expect(bpCategory(88, 55).category).toBe('low')
  })

  it('status mapping is consistent: normal=good, elevated/stage1/low=watch, stage2/crisis=concern', () => {
    expect(bpCategory(119, 79).status).toBe('good')
    expect(bpCategory(125, 78).status).toBe('watch')
    expect(bpCategory(135, 85).status).toBe('watch')
    expect(bpCategory(88, 55).status).toBe('watch')
    expect(bpCategory(145, 95).status).toBe('concern')
    expect(bpCategory(185, 125).status).toBe('concern')
  })

  it('st.bp delegates to bpCategory — cannot drift apart by construction', () => {
    expect(st.bp(145, 95)).toBe(bpCategory(145, 95).status)
    expect(st.bp(119, 79)).toBe(bpCategory(119, 79).status)
    expect(st.bp(null, 79)).toBe('neutral')
  })

  it('exact-boundary values land on the documented side of each line', () => {
    // sys=130 is the first Stage-1 value (129 would be Elevated-eligible).
    expect(bpCategory(130, 75).category).toBe('stage1')
    expect(bpCategory(129, 75).category).toBe('elevated')
    // sys=140 is the first Stage-2 value (139 is still Stage-1).
    expect(bpCategory(140, 75).category).toBe('stage2')
    expect(bpCategory(139, 75).category).toBe('stage1')
    // sys=180 is still Stage-2 (crisis requires STRICTLY > 180).
    expect(bpCategory(180, 75).category).toBe('stage2')
    expect(bpCategory(181, 75).category).toBe('crisis')
  })
})

describe('clinicalLowState (low-floor caution buffer)', () => {
  it('null value or no configured floor => normal (never a false alarm)', () => {
    expect(clinicalLowState(null, LOW_FLOORS.rhr)).toBe('normal')
    expect(clinicalLowState(55, undefined)).toBe('normal')
  })
  it('rhr floor=50, buffer=4: <50 breach, [50,54) caution, >=54 normal', () => {
    const floor = LOW_FLOORS.rhr!
    expect(clinicalLowState(49, floor)).toBe('breach')
    expect(clinicalLowState(50, floor)).toBe('caution')
    expect(clinicalLowState(53, floor)).toBe('caution')
    expect(clinicalLowState(54, floor)).toBe('normal')
  })
})
