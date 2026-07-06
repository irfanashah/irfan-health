// Unit tests locking in the H1 + H3 frontier fix (backlog H1/H3, gotcha
// #157/#158): the window must widen the lookback well beyond realistic
// device sync delay (H1), and must cap at MAX_LOOKBACK so a long outage
// can't produce an unbounded window (H3). Expected values are hand-derived
// from the constants and fixed timestamps, not copied from the
// implementation's own output.

import { describe, it, expect } from 'vitest'
import { computeIngestWindow, INGEST_WINDOW_CONFIG } from './ingestion-window'

const DAY_MS = 24 * 60 * 60 * 1000
const BACKFILL_START = new Date('2025-01-01T00:00:00.000Z')

describe('computeIngestWindow', () => {
  it('first run ever (no covered window yet) starts at the backfill date', () => {
    const now = new Date('2026-07-06T00:00:00.000Z').getTime()
    const result = computeIngestWindow(null, now, 4 * DAY_MS, 30 * DAY_MS, BACKFILL_START)
    expect(result.windowStart).toEqual(BACKFILL_START)
    expect(result.windowEnd).toEqual(new Date(now))
  })

  it('normal case: window starts LOOKBACK before the last covered end, not before the cap', () => {
    const lastCoveredEnd = new Date('2026-07-01T00:00:00.000Z')
    const now = new Date('2026-07-02T00:00:00.000Z').getTime() // 1 day after lastCoveredEnd
    const { lookbackMs, maxLookbackMs } = INGEST_WINDOW_CONFIG.whoop // 4d lookback, 30d cap
    const result = computeIngestWindow(lastCoveredEnd, now, lookbackMs, maxLookbackMs, BACKFILL_START)
    // naiveStart = 2026-07-01 - 4d = 2026-06-27; cap floor = now - 30d = 2026-06-02.
    // naiveStart is more recent than the cap floor, so it wins uncapped.
    expect(result.windowStart).toEqual(new Date('2026-06-27T00:00:00.000Z'))
    expect(result.windowEnd).toEqual(new Date(now))
  })

  it('long-outage case: window start is capped at now - MAX_LOOKBACK, not the uncapped naive start', () => {
    const now = new Date('2026-07-06T00:00:00.000Z').getTime()
    const lastCoveredEnd = new Date(now - 60 * DAY_MS) // 60-day-old outage, well past the 30d cap
    const { lookbackMs, maxLookbackMs } = INGEST_WINDOW_CONFIG.whoop // 4d lookback, 30d cap
    const result = computeIngestWindow(lastCoveredEnd, now, lookbackMs, maxLookbackMs, BACKFILL_START)
    // naiveStart = (now - 60d) - 4d = now - 64d, well before the cap floor of now - 30d.
    // The cap wins: windowStart = now - 30d exactly.
    expect(result.windowStart).toEqual(new Date(now - 30 * DAY_MS))
    expect(result.windowEnd).toEqual(new Date(now))
  })

  it('late-sync re-coverage case: a reading synced after the prior frontier is still inside the widened window', () => {
    // Frontier last advanced to cover through day 0. A device measurement from
    // day -2 (2 days before the frontier) only syncs now, on day +1. The old
    // fixed 24h-overlap logic (lastEnd - 1 day) would NOT reach back to day -2
    // and would lose it (the H1 bug). The widened lookback must.
    const lastCoveredEnd = new Date('2026-07-01T00:00:00.000Z') // "day 0"
    const lateSyncedReadingTime = new Date('2026-06-29T12:00:00.000Z') // "day -2", inside the window
    const now = new Date('2026-07-02T00:00:00.000Z').getTime() // "day +1"
    const { lookbackMs, maxLookbackMs } = INGEST_WINDOW_CONFIG.withings // 7d lookback, 30d cap
    const result = computeIngestWindow(lastCoveredEnd, now, lookbackMs, maxLookbackMs, BACKFILL_START)
    expect(result.windowStart.getTime()).toBeLessThanOrEqual(lateSyncedReadingTime.getTime())
    // Confirm the exact boundary too: 2026-07-01 - 7d = 2026-06-24.
    expect(result.windowStart).toEqual(new Date('2026-06-24T00:00:00.000Z'))
  })
})
