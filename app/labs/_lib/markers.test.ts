// Echocardiogram marker support (gotcha #167): chamber/wall dimensions come
// in cm OR mm depending on the lab — canonical is cm, mm ÷ 10; a value already
// in cm passes through unchanged. Plus the EF-range→midpoint helper and echo
// slug resolution. Expected values hand-derived, not echoed from the code.

import { describe, it, expect } from 'vitest'
import {
  toCanonical,
  reportedRangeMidpoint,
  getMarker,
  markerCategory,
  ECHO_SLUGS,
  KEY_ECHO_SLUGS,
} from './markers'

describe('echo dimension convert (mm → cm; cm passthrough)', () => {
  it('AFIC mm normalises to cm (43 mm → 4.3 cm)', () => {
    expect(toCanonical('lvidd', 43, 'mm')).toEqual({ canonical_value: 4.3, canonical_unit: 'cm' })
  })
  it('Fakeeh cm passes through unchanged (4.6 cm → 4.6 cm)', () => {
    expect(toCanonical('lvidd', 4.6, 'cm')).toEqual({ canonical_value: 4.6, canonical_unit: 'cm' })
  })
  it('IVSd: 13 mm → 1.3 cm, 0.8 cm → 0.8 cm', () => {
    expect(toCanonical('ivsd', 13, 'mm').canonical_value).toBe(1.3)
    expect(toCanonical('ivsd', 0.8, 'cm').canonical_value).toBe(0.8)
  })
  it('unknown unit → null canonical (never guesses), keeps canonical unit label', () => {
    expect(toCanonical('lvidd', 4.6, 'in')).toEqual({ canonical_value: null, canonical_unit: 'cm' })
  })
  it('velocity cm/s → m/s (190 cm/s → 1.9 m/s); m/s passthrough', () => {
    expect(toCanonical('aortic_vel', 190, 'cm/s').canonical_value).toBe(1.9)
    expect(toCanonical('aortic_vel', 1.9, 'm/s').canonical_value).toBe(1.9)
  })
  it('EF is a %; identity, no dimension conversion', () => {
    expect(toCanonical('ef', 55, '%')).toEqual({ canonical_value: 55, canonical_unit: '%' })
  })
})

describe('reportedRangeMidpoint (EF "55–60%" → 57.5)', () => {
  it('hyphen range with % suffix', () => {
    expect(reportedRangeMidpoint('55-60%')).toBe(57.5)
  })
  it('en-dash range', () => {
    expect(reportedRangeMidpoint('55–60')).toBe(57.5)
  })
  it('"to" range', () => {
    expect(reportedRangeMidpoint('55 to 60')).toBe(57.5)
  })
  it('a single number is NOT a range → null', () => {
    expect(reportedRangeMidpoint('55')).toBeNull()
    expect(reportedRangeMidpoint('55%')).toBeNull()
  })
  it('non-numeric qualitative text → null (no misfire on "Negative")', () => {
    expect(reportedRangeMidpoint('Negative')).toBeNull()
    expect(reportedRangeMidpoint('trace MR')).toBeNull()
  })
})

describe('echo slugs resolve in the registry', () => {
  it('every key echo slug resolves with category echo', () => {
    for (const slug of KEY_ECHO_SLUGS) {
      const def = getMarker(slug)
      expect(def, slug).toBeDefined()
      expect(def!.category).toBe('echo')
      expect(def!.keyMarker).toBe(true)
    }
  })
  it('EF is first among the key echo slugs (the hero)', () => {
    expect(KEY_ECHO_SLUGS[0]).toBe('ef')
  })
  it('the both-report trend markers are all present + echo', () => {
    for (const slug of ['ef', 'ivsd', 'lvpwd', 'lvidd', 'lvids', 'la_diameter', 'aortic_root']) {
      expect(markerCategory(slug), slug).toBe('echo')
    }
  })
  it('markerCategory defaults blood markers to "blood"', () => {
    expect(markerCategory('ldl')).toBe('blood')
    expect(markerCategory('unmapped')).toBe('blood')
  })
  it('ECHO_SLUGS and blood markers are disjoint', () => {
    expect(ECHO_SLUGS).toContain('ef')
    expect(ECHO_SLUGS).not.toContain('ldl')
  })
})
