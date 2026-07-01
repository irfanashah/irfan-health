// Unit tests for the Contour Next One fingerstick parser — fixed CSV byte
// strings including a real UTF-8 BOM, no Drive/DB. Expected counts and
// converted values are hand-derived, then cross-checked by one execution
// before being locked in as literal assertions.

import { describe, it, expect } from 'vitest'
import { validateContour, parseContourTimestamp, parseContour } from './parser'

const HEADER =
  '#,Date and Time,BGValue [mg/dL],Meal Marker,Data Source,Notes,Activity,Meal  [g],Medication,Location'
const BOM = Buffer.from([0xef, 0xbb, 0xbf])

// 6 rows: 3 valid (108, 90, 95 mg/dL), 1 "HI" sentinel, 1 out-of-range
// (600 mg/dL => 33.3 mmol/L > GLUCOSE_MMOL_MAX=30), 1 unparseable timestamp.
const ROWS = [
  '1,05/04/2026 7:18 AM,108,Fasting,Meter,,,,,',
  '2,05/04/2026 12:30 PM,90,,Meter,,,,,',
  '3,05/05/2026 8:00 AM,HI,Fasting,Meter,,,,,',
  '4,05/05/2026 9:00 AM,600,,Meter,,,,,',
  '5,bad-date,120,,Meter,,,,,',
  '6,05/06/2026 6:45 AM,95,Fasting,Meter,,,,,',
]

function csvWithBom(rows: string[]): Buffer {
  return Buffer.concat([BOM, Buffer.from([HEADER, ...rows].join('\n'), 'utf8')])
}

describe('validateContour', () => {
  it('strips the UTF-8 BOM before matching the header', () => {
    expect(validateContour(csvWithBom([]))).toBe(true)
  })
  it('also matches without a BOM (tolerant)', () => {
    expect(validateContour(Buffer.from(HEADER))).toBe(true)
  })
  it('rejects an unrelated header', () => {
    expect(validateContour(Buffer.from('foo,bar'))).toBe(false)
  })
})

describe('parseContourTimestamp', () => {
  it('parses US "MM/DD/YYYY h:mm AM/PM" (no leading-zero hour) as GST-local, converted to UTC', () => {
    // 7:18 AM GST on 2026-05-04 = 03:18 UTC (GST is UTC+4).
    expect(parseContourTimestamp('05/04/2026 7:18 AM')?.toISOString()).toBe('2026-05-04T03:18:00.000Z')
  })
  it('handles the 12 AM / 12 PM boundary correctly', () => {
    expect(parseContourTimestamp('05/04/2026 12:30 PM')?.toISOString()).toBe('2026-05-04T08:30:00.000Z')
    expect(parseContourTimestamp('05/04/2026 12:00 AM')?.toISOString()).toBe('2026-05-03T20:00:00.000Z')
  })
  it('returns null for an unparseable string', () => {
    expect(parseContourTimestamp('bad-date')).toBeNull()
  })
})

describe('parseContour', () => {
  it('produces the hand-derived row count and skip breakdown', () => {
    const result = parseContour(csvWithBom(ROWS), { name: 'bg.csv', driveFileId: 'xyz' })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.summary.rows_seen).toBe(6)
    expect(result.summary.rows_valid).toBe(3)
    expect(result.summary.skip_breakdown).toEqual({ sentinel: 1, out_of_range: 1, parse_errors: 1 })
  })
  it('converts mg/dL -> mmol/L via the shared helper and writes a manual-entry-identical row shape', () => {
    const result = parseContour(csvWithBom(ROWS), { name: 'bg.csv', driveFileId: 'xyz' })
    if (result.kind !== 'ok') throw new Error('expected ok')
    const r108 = result.rows.find((r) => r.numeric_value === 108)
    expect(r108?.canonical_value).toBe(6) // 108 / 18 = 6.0 exactly
    expect(r108?.canonical_unit).toBe('mmol/L')
    expect(r108?.data_shape).toBe('discrete')
    expect(r108?.metric_type).toBe('glucose_fingerstick')
    expect(r108?.unit).toBe('mg/dL')
    expect(r108?.extras).toEqual({ meal_marker: 'Fasting', data_source: 'Meter' })

    const r95 = result.rows.find((r) => r.numeric_value === 95)
    expect(r95?.canonical_value).toBeCloseTo(95 / 18, 1) // 5.2777... => 5.3

    const r90 = result.rows.find((r) => r.numeric_value === 90)
    expect(r90?.extras).toEqual({ data_source: 'Meter' }) // no meal marker => key omitted, not null
  })
  it('source_record_id is timestamp+value keyed for idempotent re-drop', () => {
    const result = parseContour(csvWithBom(ROWS), { name: 'bg.csv', driveFileId: 'xyz' })
    if (result.kind !== 'ok') throw new Error('expected ok')
    for (const row of result.rows) {
      expect(row.source_record_id).toMatch(/^contour_\d+_\d+$/)
    }
    // Re-parsing the identical file produces IDENTICAL ids (deterministic, not time-of-parse-dependent).
    const second = parseContour(csvWithBom(ROWS), { name: 'bg.csv', driveFileId: 'xyz' })
    if (second.kind !== 'ok') throw new Error('expected ok')
    expect(second.rows.map((r) => r.source_record_id)).toEqual(result.rows.map((r) => r.source_record_id))
  })
  it('drift guard: more parse errors than valid rows fails loudly', () => {
    const driftRows = [
      '1,bad-date-1,100,,Meter,,,,,',
      '2,bad-date-2,100,,Meter,,,,,',
      '3,bad-date-3,100,,Meter,,,,,',
      '4,05/04/2026 7:18 AM,100,,Meter,,,,,', // only 1 valid vs 3 parse errors
    ]
    const result = parseContour(csvWithBom(driftRows), { name: 'd.csv', driveFileId: 'd' })
    expect(result.kind).toBe('fail')
    if (result.kind === 'fail') expect(result.reason).toMatch(/possible format change/)
  })
  it('zero valid rows after filtering fails loudly', () => {
    const zeroRows = ['1,05/04/2026 7:18 AM,HI,,Meter,,,,,', '2,05/04/2026 8:00 AM,LO,,Meter,,,,,']
    const result = parseContour(csvWithBom(zeroRows), { name: 'z.csv', driveFileId: 'z' })
    expect(result.kind).toBe('fail')
    if (result.kind === 'fail') expect(result.reason).toMatch(/No valid rows/)
  })
})
