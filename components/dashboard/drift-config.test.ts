// L14 — med_changes.affected_metrics is free text; a typo (e.g. 'spo2avg')
// used to persist and then silently no-op the baseline reset. These lock in
// the runtime validator that rejects unknown ids at write time.

import { describe, it, expect } from 'vitest'
import { isDriftMetricId, partitionDriftMetricIds, DRIFT_METRICS } from './drift-config'

describe('isDriftMetricId (L14)', () => {
  it('accepts every real drift metric id', () => {
    for (const m of DRIFT_METRICS) expect(isDriftMetricId(m)).toBe(true)
  })
  it('rejects a plausible typo', () => {
    expect(isDriftMetricId('spo2avg')).toBe(false) // real id is spo2_avg
    expect(isDriftMetricId('')).toBe(false)
    expect(isDriftMetricId('SYS')).toBe(false) // case-sensitive
  })
})

describe('partitionDriftMetricIds (L14)', () => {
  it('all-valid input → no invalids', () => {
    expect(partitionDriftMetricIds(['rhr', 'sys'])).toEqual({
      valid: ['rhr', 'sys'],
      invalid: [],
    })
  })
  it('separates the unknown id from the known ones', () => {
    expect(partitionDriftMetricIds(['rhr', 'spo2avg', 'tir'])).toEqual({
      valid: ['rhr', 'tir'],
      invalid: ['spo2avg'],
    })
  })
  it('all-unknown input → all invalid (the write must be rejected)', () => {
    expect(partitionDriftMetricIds(['nope', 'zzz'])).toEqual({
      valid: [],
      invalid: ['nope', 'zzz'],
    })
  })
})
