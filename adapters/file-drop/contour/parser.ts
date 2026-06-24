// Contour Next One fingerstick CSV parser.
//
// File shape (observed in the real Patient's_BG_data_*.csv export):
//   UTF-8 BOM precedes the header (csv-parse handles via `bom: true`).
//   Header (10 cols, NOTE the double-space in "Meal  [g]"):
//     #,Date and Time,BGValue [mg/dL],Meal Marker,Data Source,Notes,
//     Activity,Meal  [g],Medication,Location
//   Row:    1,05/04/2026 7:18 AM,108,Fasting,Meter,,,,,
//   `#`     non-stable row index — NOT used for source_record_id.
//   `Date and Time`  US format "MM/DD/YYYY h:mm AM/PM" (NO leading-zero hour);
//                    treat as GST local (Asia/Dubai, fixed UTC+4), convert
//                    to UTC instant (gotcha #31).
//   `BGValue [mg/dL]` integer. Contour CAN emit "HI" / "LO" strings as
//                     boundary readings; this file has none, but the
//                     parser handles them as skips.
//
// Writes glucose_fingerstick rows mirroring Slice 3 manual-entry shape
// EXACTLY (app/log/actions.ts::createGlucose is the reference), so Contour
// + manual fingersticks are indistinguishable downstream. Reuses the
// shared `mgdlToMmol`/`roundTo1dp` helpers + the Slice 3 glucose bounds
// (gotcha #28 — single helper across slices).
//
// source_record_id = 'contour_' + <epoch_ms> + '_' + <bg_mgdl>.
// Timestamp is minute-resolution, so we append the value to guard against
// the rare same-minute duplicate. Stable across exports → re-dropping the
// same (or an overlapping) export dedupes via (source_slug, source_record_id).
//
// Drift guard + 0-valid-fail mirror the Oxylink parser.

import { parse as csvParse } from 'csv-parse/sync'
import { mgdlToMmol, roundTo1dp } from '@/app/log/_lib/glucose'
import { GLUCOSE_MMOL_MIN, GLUCOSE_MMOL_MAX } from '@/app/log/_lib/ranges'
import type { FileDropParser, ParseResult, ObservationRow, ParsedFileSummary } from '../types'

const SOURCE_SLUG = 'contour'
const SOURCE_FOLDER = 'contour'

// GST is fixed UTC+4 (no DST).
const GST_OFFSET_MS = 4 * 60 * 60 * 1000

// Case-insensitive prefix match — tolerates trailing-column drift (Contour
// version updates could add columns) but rejects anything missing the four
// load-bearing front columns. The BOM is stripped before this check.
const HEADER_PREFIX_LOWER = '#,date and time,bgvalue [mg/dl],meal marker'

// ─── validate() ───────────────────────────────────────────────────────────

export function validateContour(bytes: Buffer): boolean {
  // Strip a leading UTF-8 BOM (EF BB BF) if present, then sniff the header.
  let start = 0
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3
  }
  const headerLine = bytes
    .toString('utf8', start, Math.min(bytes.length, start + 512))
    .split(/\r?\n/, 1)[0]
    ?.trim()
    ?.toLowerCase() ?? ''
  return headerLine.startsWith(HEADER_PREFIX_LOWER)
}

// ─── Timestamp parse ──────────────────────────────────────────────────────
//
// Input form: "MM/DD/YYYY h:mm AM/PM" — US, no leading-zero on the hour
// ("5/04/2026 7:18 AM" and "05/04/2026 12:30 PM" are both valid).
// Returns a UTC Date for the GST-local instant the timestamp represents.

const TS_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i

export function parseContourTimestamp(raw: string): Date | null {
  const m = TS_RE.exec(raw.trim())
  if (!m) return null
  const mon = parseInt(m[1], 10) - 1   // 0-indexed for Date.UTC
  const day = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  let hour = parseInt(m[4], 10)
  const min = parseInt(m[5], 10)
  const ampm = m[6].toUpperCase()
  if (hour === 12) hour = 0
  if (ampm === 'PM') hour += 12
  if (
    mon < 0 || mon > 11 || day < 1 || day > 31 || year < 2000 || year > 2100 ||
    hour < 0 || hour > 23 || min < 0 || min > 59
  ) return null

  // Treat the parsed clock as GST local → convert to UTC by subtracting the
  // GST offset. Build the GST-clock instant as if it were UTC, then shift.
  const asIfUtc = Date.UTC(year, mon, day, hour, min, 0)
  return new Date(asIfUtc - GST_OFFSET_MS)
}

// ─── parse() ──────────────────────────────────────────────────────────────

export function parseContour(
  bytes: Buffer,
  fileMeta: { name: string; driveFileId: string }
): ParseResult {
  // csv-parse with bom:true strips the leading UTF-8 BOM cleanly; columns:true
  // parses each row into an object keyed on the header names (handles the
  // odd double-space in "Meal  [g]" verbatim).
  let records: Array<Record<string, string>>
  try {
    records = csvParse(bytes, {
      bom: true,
      columns: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>
  } catch (err) {
    return { kind: 'fail', reason: `CSV parse failed at top level: ${(err as Error).message}` }
  }

  const obsRows: ObservationRow[] = []
  let sentinelSkips = 0      // HI / LO / blank BG value
  let outOfRangeSkips = 0    // converted mmol outside Slice 3 bounds
  let parseErrors = 0        // unparseable timestamp / row shape

  for (const r of records) {
    const tsRaw = r['Date and Time'] ?? ''
    const bgRaw = (r['BGValue [mg/dL]'] ?? '').trim()
    const mealMarker = (r['Meal Marker'] ?? '').trim()
    const dataSource = (r['Data Source'] ?? '').trim()
    const notes = (r['Notes'] ?? '').trim()

    if (!tsRaw || !bgRaw) { parseErrors++; continue }

    const ts = parseContourTimestamp(tsRaw)
    if (!ts) { parseErrors++; continue }

    // Contour can emit "HI" (>600 mg/dL) / "LO" (<20 mg/dL) as boundary
    // strings. Skip — they're not real values; storing them would pollute
    // trends. Count separately from parse errors so the diagnostics row
    // tells the right story.
    const bgMgdl = Number(bgRaw)
    if (!Number.isFinite(bgMgdl)) {
      sentinelSkips++
      continue
    }

    // Convert + plausibility filter using the SAME bounds Slice 3 manual
    // entry uses (gotcha #28 — one helper per concern).
    const mmol = mgdlToMmol(bgMgdl)
    if (mmol < GLUCOSE_MMOL_MIN || mmol > GLUCOSE_MMOL_MAX) {
      outOfRangeSkips++
      continue
    }

    // Build extras with only the populated keys (omit-missing pattern,
    // gotcha #30 — keeps JSONB compact for the bulk-import case).
    const extras: Record<string, unknown> = {}
    if (mealMarker) extras.meal_marker = mealMarker
    if (dataSource) extras.data_source = dataSource
    if (notes) extras.notes = notes

    obsRows.push({
      source_slug: SOURCE_SLUG,
      source_record_id: `contour_${ts.getTime()}_${bgMgdl}`,
      data_shape: 'discrete',
      metric_type: 'glucose_fingerstick',
      recorded_at: ts.toISOString(),
      period_start: null,
      period_end: null,
      numeric_value: bgMgdl,
      unit: 'mg/dL',
      canonical_value: roundTo1dp(mmol),
      canonical_unit: 'mmol/L',
      extras: Object.keys(extras).length > 0 ? extras : null,
    })
  }

  const rowsSeen = records.length
  const rowsValid = obsRows.length
  const skip_breakdown = { sentinel: sentinelSkips, out_of_range: outOfRangeSkips, parse_errors: parseErrors }

  // Drift guard — Oxylink-pattern. A format change (column rename, new
  // timestamp shape) where validate() (header) still passes but most rows
  // return nulls fails loudly rather than silently writing a tiny survivor
  // set off a partially-misread file.
  if (parseErrors > rowsValid) {
    return {
      kind: 'fail',
      reason: `Majority of rows unparseable (parse_errors=${parseErrors} > rows_valid=${rowsValid}) — possible format change`,
    }
  }

  if (rowsValid === 0) {
    return {
      kind: 'fail',
      reason: `No valid rows after sentinel + range filter (seen=${rowsSeen}, sentinel=${sentinelSkips}, out_of_range=${outOfRangeSkips}, parse_errors=${parseErrors}).`,
    }
  }

  // Sort by recorded_at so first/last are deterministic regardless of
  // source ordering (the export observed comes oldest-first, but don't
  // assume).
  obsRows.sort((a, b) =>
    (a.recorded_at ?? '').localeCompare(b.recorded_at ?? '')
  )

  const firstISO = obsRows[0].recorded_at!
  const lastISO = obsRows[obsRows.length - 1].recorded_at!

  const summary: ParsedFileSummary = {
    period_start: firstISO,
    period_end: lastISO,
    skip_breakdown,
    rows_seen: rowsSeen,
    rows_valid: rowsValid,
    meta: {
      filename: fileMeta.name,
      drive_file_id: fileMeta.driveFileId,
      first_reading: firstISO,
      last_reading: lastISO,
      reading_count: rowsValid,
    },
  }

  return { kind: 'ok', rows: obsRows, summary }
}

// ─── Exported parser ──────────────────────────────────────────────────────

export const contourParser: FileDropParser = {
  sourceSlug: SOURCE_SLUG,
  sourceFolder: SOURCE_FOLDER,
  validate: validateContour,
  parse: parseContour,
}
