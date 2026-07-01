// Unit tests for the GST (Asia/Dubai, fixed UTC+4) calendar-day helpers.
// Time is frozen with vi.setSystemTime so these are fully deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { gstTodayISO, gstDaysBack } from './gst'

describe('gstTodayISO', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('at UTC 21:59 the GST date is still the same UTC calendar day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-29T21:59:00.000Z')) // +4h = 2026-06-30T01:59 -> still 06-30? check below
    // 21:59 UTC + 4h = 01:59 next day -> GST date is already the next day at 21:59 UTC.
    expect(gstTodayISO()).toBe('2026-06-30')
  })

  it('at UTC 19:59 the GST date is still the SAME calendar day (below the +4h rollover)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-29T19:59:00.000Z')) // +4h = 23:59 same UTC day
    expect(gstTodayISO()).toBe('2026-06-29')
  })

  it('at UTC 22:00 the GST date has rolled over to the next day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-29T22:00:00.000Z')) // +4h = 2026-06-30T02:00:00Z
    expect(gstTodayISO()).toBe('2026-06-30')
  })

  it('rolls over correctly across a month boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T22:00:00.000Z')) // +4h = 2026-07-01T02:00:00Z
    expect(gstTodayISO()).toBe('2026-07-01')
  })
})

describe('gstDaysBack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-02T10:00:00.000Z')) // GST today = 2026-07-02
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('index 0 is today; walks backward one day at a time', () => {
    expect(gstDaysBack(3)).toEqual(['2026-07-02', '2026-07-01', '2026-06-30'])
  })
  it('crosses a month boundary correctly', () => {
    expect(gstDaysBack(5)).toEqual(['2026-07-02', '2026-07-01', '2026-06-30', '2026-06-29', '2026-06-28'])
  })
  it('n=0 returns an empty array; n=1 returns just today', () => {
    expect(gstDaysBack(0)).toEqual([])
    expect(gstDaysBack(1)).toEqual(['2026-07-02'])
  })
})
