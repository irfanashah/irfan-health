// Oxylink overnight SpO2 CSV parser (Slice 4 v1).
//
// File shape (observed in the real export):
//   Header:  "Time,SpO2(%),Pulse Rate(bpm),Motion,SpO2 Reminder,PR Reminder,"
//            (case may drift; trailing column is empty by design)
//   Rows:    "10:38:13PM Jun 21, 2026",95,65,0,0,0,
//            ^ timestamp is QUOTED — the comma between "21," and "2026"
//              is INSIDE the quotes; need a quote-aware splitter (csv-parse).
//            ^ no space before AM/PM ("10:38:13PM") — explicit format parse.
//   Cadence: ~4 seconds; ~5,900 rows per overnight session.
//   GST:     timestamps are local GST (Asia/Dubai, fixed UTC+4). Treat as
//            such; convert to UTC ISO when writing.
//
// Sentinel + range filter (per spec):
//   SpO2 == 255 → sensor-off marker, drop.
//   Pulse == 65535 → sensor-off marker, drop.
//   SpO2 ∉ [70, 100] → physically implausible, drop.
//   Pulse ∉ [30, 220] → physically implausible, drop.
//
// Drift guard (per Irfan's refinement on decision #3): if parse_errors >
// rows_valid (more rows failed to parse than survived), FAIL the file with
// reason "majority of rows unparseable — possible format change". Catches a
// silent timestamp-format change where validate() (header) passes but most
// rows return nulls, so the summary would be computed off a tiny unrepresentative
// handful and look like a clean ingest.

import { parse as csvParse } from 'csv-parse/sync'
import type { FileDropParser, ParseResult, ObservationRow, ParsedFileSummary } from '../types'

const SOURCE_SLUG = 'oxylink_csv'
const SOURCE_FOLDER = 'oxylink'

// Sentinel + range constants
const SPO2_SENTINEL = 255
const PULSE_SENTINEL = 65535
const SPO2_MIN = 70
const SPO2_MAX = 100
const PULSE_MIN = 30
const PULSE_MAX = 220

// GST is fixed UTC+4 (no DST).
const GST_OFFSET_HOURS = 4
const GST_OFFSET_MS = GST_OFFSET_HOURS * 60 * 60 * 1000

// Header signature — case-insensitive, prefix match against the first 4
// columns. Tolerates trailing-column drift (e.g. Oxylink adding a column);
// anything missing core SpO2/Pulse columns → reject.
const HEADER_PREFIX_LOWER = 'time,spo2(%),pulse rate(bpm),motion'

interface ParsedRow {
  ts: Date          // UTC instant (timestamp was GST-local before conversion)
  spo2: number
  pulse: number
  motion: number
}

// ─── validate() ────────────────────────────────────────────────────────────

export function validateOxylink(bytes: Buffer): boolean {
  // First line only — cheap header sniff.
  const headerLine = bytes
    .toString('utf8', 0, Math.min(bytes.length, 512))
    .split(/\r?\n/, 1)[0]
    ?.trim()
    ?.toLowerCase() ?? ''
  return headerLine.startsWith(HEADER_PREFIX_LOWER)
}

// ─── Timestamp parse ──────────────────────────────────────────────────────
//
// Input form: "10:38:13PM Jun 21, 2026"  (no space before AM/PM)
// Returns a UTC Date for the GST-local instant the timestamp represents.

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

const TS_RE = /^(\d{1,2}):(\d{2}):(\d{2})(AM|PM)\s+([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/

export function parseOxylinkTimestamp(raw: string): Date | null {
  const m = TS_RE.exec(raw.trim())
  if (!m) return null
  let hour = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const sec = parseInt(m[3], 10)
  const ampm = m[4].toUpperCase()
  const mon = MONTHS[m[5].toLowerCase()]
  const day = parseInt(m[6], 10)
  const year = parseInt(m[7], 10)
  if (mon === undefined) return null
  if (hour === 12) hour = 0
  if (ampm === 'PM') hour += 12
  if (
    hour < 0 || hour > 23 || min < 0 || min > 59 || sec < 0 || sec > 59 ||
    day < 1 || day > 31 || year < 2000 || year > 2100
  ) return null

  // Treat as GST local → convert to UTC by subtracting the GST offset.
  // Build the "GST clock" instant as if it were UTC, then shift.
  const asIfUtc = Date.UTC(year, mon, day, hour, min, sec)
  return new Date(asIfUtc - GST_OFFSET_MS)
}

/** Format an instant as the GST calendar date (YYYY-MM-DD). */
function gstDate(d: Date): string {
  return new Date(d.getTime() + GST_OFFSET_MS).toISOString().slice(0, 10)
}

// ─── parse() ──────────────────────────────────────────────────────────────

export function parseOxylink(
  bytes: Buffer,
  fileMeta: { name: string; driveFileId: string }
): ParseResult {
  const text = bytes.toString('utf8')

  // csv-parse handles quoted fields with internal commas robustly — required
  // because the Oxylink timestamp is "10:38:13PM Jun 21, 2026" with the comma
  // inside the quotes. trim:true strips whitespace; skip_empty_lines drops
  // blank tails; relax_column_count tolerates rows with the trailing empty
  // column (or its absence).
  let records: string[][]
  try {
    records = csvParse(text, {
      from_line: 2, // skip header
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][]
  } catch (err) {
    return { kind: 'fail', reason: `CSV parse failed at top level: ${(err as Error).message}` }
  }

  const rows: ParsedRow[] = []
  let sentinelSkips = 0
  let outOfRangeSkips = 0
  let parseErrors = 0

  for (const r of records) {
    if (r.length < 4) { parseErrors++; continue }
    const tsRaw = r[0] ?? ''
    const spo2Raw = r[1]
    const pulseRaw = r[2]
    const motionRaw = r[3]

    const ts = parseOxylinkTimestamp(tsRaw)
    const spo2 = Number(spo2Raw)
    const pulse = Number(pulseRaw)
    const motion = Number(motionRaw)

    if (!ts || !Number.isFinite(spo2) || !Number.isFinite(pulse) || !Number.isFinite(motion)) {
      parseErrors++
      continue
    }

    // Sentinel filter (sensor off / null encoding).
    if (spo2 === SPO2_SENTINEL || pulse === PULSE_SENTINEL) {
      sentinelSkips++
      continue
    }

    // Range filter (physically implausible).
    if (spo2 < SPO2_MIN || spo2 > SPO2_MAX || pulse < PULSE_MIN || pulse > PULSE_MAX) {
      outOfRangeSkips++
      continue
    }

    rows.push({ ts, spo2, pulse, motion })
  }

  const rowsSeen = records.length
  const rowsValid = rows.length
  const skip_breakdown = { sentinel: sentinelSkips, out_of_range: outOfRangeSkips, parse_errors: parseErrors }

  // Drift guard: if more rows failed to parse than survived, the file is
  // probably the wrong format (timestamp format drift, garbled export).
  // Fail loudly rather than write a summary off a handful of survivors.
  if (parseErrors > rowsValid) {
    return {
      kind: 'fail',
      reason: `Majority of rows unparseable (parse_errors=${parseErrors} > rows_valid=${rowsValid}) — possible format change`,
    }
  }

  if (rowsValid === 0) {
    return {
      kind: 'fail',
      reason: `No valid rows after sentinel + range filter (seen=${rowsSeen}, sentinel=${sentinelSkips}, out_of_range=${outOfRangeSkips}, parse_errors=${parseErrors}). Sensor may have been off the whole session.`,
    }
  }

  // Sort by timestamp so first/last are deterministic regardless of source ordering.
  rows.sort((a, b) => a.ts.getTime() - b.ts.getTime())
  const firstTs = rows[0].ts
  const lastTs = rows[rows.length - 1].ts

  // Aggregates
  let spo2Sum = 0
  let spo2Min = rows[0].spo2
  let pulseSum = 0
  let motionEvents = 0
  for (const r of rows) {
    spo2Sum += r.spo2
    if (r.spo2 < spo2Min) spo2Min = r.spo2
    pulseSum += r.pulse
    if (r.motion > 0) motionEvents++
  }
  const spo2Avg = round1(spo2Sum / rowsValid)
  const pulseAvg = round1(pulseSum / rowsValid)
  const sessionDurationMin = Math.round((lastTs.getTime() - firstTs.getTime()) / 60000)

  const wakeDate = gstDate(lastTs) // wake-day attribution (period_end GST date)

  const extras = {
    session_duration_min: sessionDurationMin,
    movement_events: motionEvents,
    pulse_avg_bpm: pulseAvg,
  }

  const periodStartISO = firstTs.toISOString()
  const periodEndISO = lastTs.toISOString()

  const obsRows: ObservationRow[] = [
    {
      source_slug: SOURCE_SLUG,
      source_record_id: `oxylink_${wakeDate}_spo2_overnight_avg`,
      data_shape: 'daily_summary',
      metric_type: 'spo2_overnight_avg',
      recorded_at: null,
      period_start: periodStartISO,
      period_end: periodEndISO,
      numeric_value: spo2Avg,
      unit: '%',
      canonical_value: spo2Avg,
      canonical_unit: '%',
      extras,
    },
    {
      source_slug: SOURCE_SLUG,
      source_record_id: `oxylink_${wakeDate}_spo2_overnight_min`,
      data_shape: 'daily_summary',
      metric_type: 'spo2_overnight_min',
      recorded_at: null,
      period_start: periodStartISO,
      period_end: periodEndISO,
      numeric_value: spo2Min,
      unit: '%',
      canonical_value: spo2Min,
      canonical_unit: '%',
      extras,
    },
  ]

  const summary: ParsedFileSummary = {
    period_start: periodStartISO,
    period_end: periodEndISO,
    skip_breakdown,
    rows_seen: rowsSeen,
    rows_valid: rowsValid,
    meta: {
      filename: fileMeta.name,
      drive_file_id: fileMeta.driveFileId,
      wake_date: wakeDate,
      spo2_avg: spo2Avg,
      spo2_min: spo2Min,
      pulse_avg_bpm: pulseAvg,
      session_duration_min: sessionDurationMin,
      movement_events: motionEvents,
    },
  }

  return { kind: 'ok', rows: obsRows, summary }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

// ─── Exported parser ──────────────────────────────────────────────────────

export const oxylinkParser: FileDropParser = {
  sourceSlug: SOURCE_SLUG,
  sourceFolder: SOURCE_FOLDER,
  validate: validateOxylink,
  parse: parseOxylink,
}
