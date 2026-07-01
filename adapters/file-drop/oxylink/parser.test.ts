// Unit tests for the Oxylink overnight SpO2 parser — fed fixed, known CSV
// byte strings (no Drive, no DB). Expected row counts/skip-breakdowns/
// aggregates are computed by hand from the fixture below, then cross-checked
// by running this exact fixture once before locking the numbers in.

import { describe, it, expect } from 'vitest'
import { validateOxylink, parseOxylinkTimestamp, parseOxylink } from './parser'

const HEADER = 'Time,SpO2(%),Pulse Rate(bpm),Motion,SpO2 Reminder,PR Reminder,'

// 10 rows: 6 valid (spo2 96,95,94,93,92,91 / pulse 65,64,63,62,61,60),
// 1 sentinel (spo2=255 AND pulse=65535 — counted once), 2 out-of-range
// (spo2=50 too low; pulse=250 too high), 1 unparseable timestamp.
const ROWS = [
  '"10:00:00PM Jun 21, 2026",96,65,0,0,0,',
  '"10:00:04PM Jun 21, 2026",95,64,0,0,0,',
  '"10:00:08PM Jun 21, 2026",94,63,0,0,0,',
  '"10:00:12PM Jun 21, 2026",255,65535,0,0,0,', // sentinel
  '"10:00:16PM Jun 21, 2026",50,65,0,0,0,', // out of range (spo2 < 70)
  '"10:00:20PM Jun 21, 2026",95,250,0,0,0,', // out of range (pulse > 220)
  '"10:00:24PM Jun 21, 2026",93,62,1,0,0,',
  'garbled,95,65,0,0,0,', // unparseable timestamp
  '"10:00:32PM Jun 21, 2026",92,61,0,0,0,',
  '"10:00:36PM Jun 21, 2026",91,60,0,0,0,',
]

function csvBytes(rows: string[]): Buffer {
  return Buffer.from([HEADER, ...rows].join('\n'), 'utf8')
}

describe('validateOxylink', () => {
  it('accepts the real header (case-insensitive prefix match)', () => {
    expect(validateOxylink(Buffer.from(HEADER))).toBe(true)
    expect(validateOxylink(Buffer.from(HEADER.toUpperCase()))).toBe(true)
  })
  it('rejects an unrelated header', () => {
    expect(validateOxylink(Buffer.from('Foo,Bar,Baz'))).toBe(false)
  })
})

describe('parseOxylinkTimestamp', () => {
  it('parses "hh:mm:ssAM/PM Mon DD, YYYY" (no space before AM/PM) as GST-local, converted to UTC', () => {
    // 10:38:13 PM GST on 2026-06-21 = 22:38:13 local = 18:38:13 UTC (GST is UTC+4).
    const ts = parseOxylinkTimestamp('10:38:13PM Jun 21, 2026')
    expect(ts?.toISOString()).toBe('2026-06-21T18:38:13.000Z')
  })
  it('handles the 12 AM / 12 PM boundary correctly', () => {
    expect(parseOxylinkTimestamp('12:00:00AM Jan 1, 2026')?.toISOString()).toBe('2025-12-31T20:00:00.000Z')
    expect(parseOxylinkTimestamp('12:00:00PM Jan 1, 2026')?.toISOString()).toBe('2026-01-01T08:00:00.000Z')
  })
  it('returns null for an unparseable string', () => {
    expect(parseOxylinkTimestamp('not a timestamp')).toBeNull()
  })
})

describe('parseOxylink', () => {
  it('produces the hand-derived row count, skip breakdown, and aggregates', () => {
    const result = parseOxylink(csvBytes(ROWS), { name: 'test.csv', driveFileId: 'abc' })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.summary.rows_seen).toBe(10)
    expect(result.summary.rows_valid).toBe(6)
    expect(result.summary.skip_breakdown).toEqual({ sentinel: 1, out_of_range: 2, parse_errors: 1 })
    // avg of [96,95,94,93,92,91] = 561/6 = 93.5; min = 91.
    expect(result.summary.meta?.spo2_avg).toBe(93.5)
    expect(result.summary.meta?.spo2_min).toBe(91)
  })
  it('writes the avg/min rows with the wake-date-keyed source_record_id and matching values', () => {
    const result = parseOxylink(csvBytes(ROWS), { name: 'test.csv', driveFileId: 'abc' })
    if (result.kind !== 'ok') throw new Error('expected ok')
    const avgRow = result.rows.find((r) => r.metric_type === 'spo2_overnight_avg')
    const minRow = result.rows.find((r) => r.metric_type === 'spo2_overnight_min')
    expect(avgRow?.source_record_id).toBe('oxylink_2026-06-21_spo2_overnight_avg')
    expect(avgRow?.numeric_value).toBe(93.5)
    expect(minRow?.numeric_value).toBe(91)
    expect(avgRow?.source_slug).toBe('oxylink_csv')
  })
  it('drift guard: more parse errors than valid rows fails loudly (possible format change)', () => {
    const driftRows = [
      'garbled1,1,1,0,0,0,',
      'garbled2,1,1,0,0,0,',
      'garbled3,1,1,0,0,0,',
      '"10:00:00PM Jun 21, 2026",95,65,0,0,0,', // only 1 valid row vs 3 parse errors
    ]
    const result = parseOxylink(csvBytes(driftRows), { name: 'd.csv', driveFileId: 'd' })
    expect(result.kind).toBe('fail')
    if (result.kind === 'fail') expect(result.reason).toMatch(/possible format change/)
  })
  it('zero valid rows after filtering fails loudly (not a silent records_written=0 success)', () => {
    const zeroRows = [
      '"10:00:00PM Jun 21, 2026",255,65535,0,0,0,', // sentinel
      '"10:00:04PM Jun 21, 2026",50,65,0,0,0,', // out of range
    ]
    const result = parseOxylink(csvBytes(zeroRows), { name: 'z.csv', driveFileId: 'z' })
    expect(result.kind).toBe('fail')
    if (result.kind === 'fail') expect(result.reason).toMatch(/No valid rows/)
  })
})
