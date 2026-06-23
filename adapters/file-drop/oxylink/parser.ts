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

// ─── Desaturation algorithm constants (PROVISIONAL — pending Dr. Jose) ────
//
// ODI computed here is SCREENING-GRADE — a consumer-ring approximation, NOT
// a diagnostic PSG/HSAT ODI. The algorithm walks the full ~4 s in-memory
// series (accuracy preserved); only the *stored display curve* is later
// downsampled. Constants are centralised + named so they're trivial to
// tune once Dr. Jose lands on the right numbers — same pattern as
// thresholds.ts::LOW_FLOORS.
const ODI_DROP_PCT = 3                // Percentage-point drop from baseline → event (3% AASM-style primary).
const ODI_DROP_PCT_4 = 4              // Computed alongside, stored in extras (Medicare-style).
const ODI_BASELINE_WINDOW_S = 120     // Pre-event local baseline = max SpO2 over the trailing window.
const ODI_MIN_EVENT_DURATION_S = 10   // Ignore dips shorter than this (motion/noise filter).
const ODI_MIN_EVENT_SEPARATION_S = 10 // Enforce gap between event nadirs so one slow dip isn't double-counted.
const ODI_MIN_HOURS = 2               // Below this many valid recording hours → don't emit ODI (too little to rate).
const ODI_MAX_GAP_S = 60              // Inter-sample gap larger than this is sensor-off; don't count toward valid hours.

// Display-curve downsample bucket (curve stored as one JSONB-array row/night).
// ~5,900 raw points/night collapsed to ~700–1,200 (interval 15–30 s); plenty
// for a clean trace and survives ≥10 s desaturation events visually.
const CURVE_BUCKET_S = 20

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
  let pulseMin = rows[0].pulse
  let pulseMax = rows[0].pulse
  let motionEvents = 0
  for (const r of rows) {
    spo2Sum += r.spo2
    if (r.spo2 < spo2Min) spo2Min = r.spo2
    pulseSum += r.pulse
    if (r.pulse < pulseMin) pulseMin = r.pulse
    if (r.pulse > pulseMax) pulseMax = r.pulse
    if (r.motion > 0) motionEvents++
  }
  const spo2Avg = round1(spo2Sum / rowsValid)
  const pulseAvg = round1(pulseSum / rowsValid)
  const sessionDurationMin = Math.round((lastTs.getTime() - firstTs.getTime()) / 60000)

  const wakeDate = gstDate(lastTs) // wake-day attribution (period_end GST date)

  // ─── Desaturation pass over the FULL ~4 s in-memory series ──────────────
  //
  // Computes ODI (3% + 4%), time-below thresholds, valid recording hours,
  // and SpO2 distribution at FULL resolution. Storage of the per-reading
  // points is deliberately limited to a single display-downsampled curve
  // row (see below) — point-level analytics is out of scope (see
  // oxylink-desaturation-spec_2026-06-22.md §"Out of scope").
  const desat = computeDesaturation(rows)
  const baseExtras = {
    session_duration_min: sessionDurationMin,
    movement_events: motionEvents,
    pulse_avg_bpm: pulseAvg,
  }

  const periodStartISO = firstTs.toISOString()
  const periodEndISO = lastTs.toISOString()

  // ─── ODI-summary extras — every audit number needed to interpret the
  //    headline ODI lives here. `numeric_value: null` if ODI guarded
  //    below ODI_MIN_HOURS (too little to rate honestly).
  const odiExtras = {
    ...baseExtras,
    odi_pct_threshold: ODI_DROP_PCT,
    odi_4pct: desat.odi4Pct,
    desaturation_event_count: desat.eventCount3pct,
    desaturation_event_count_4pct: desat.eventCount4pct,
    valid_recording_hours: round1(desat.validRecordingHours),
    time_below_90_min: round1(desat.timeBelow90Min),
    time_below_88_min: round1(desat.timeBelow88Min),
    time_below_85_min: round1(desat.timeBelow85Min),
    spo2_distribution: {
      ge95: round1(desat.dist.ge95Min),
      b90_94: round1(desat.dist.b90_94Min),
      lt90: round1(desat.dist.lt90Min),
    },
    lowest_spo2: spo2Min,
    pulse_min: pulseMin,
    pulse_max: pulseMax,
    odi_constants_provisional: true,
  }

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
      extras: baseExtras,
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
      extras: baseExtras,
    },
    {
      source_slug: SOURCE_SLUG,
      source_record_id: `oxylink_${wakeDate}_spo2_odi`,
      data_shape: 'daily_summary',
      metric_type: 'spo2_odi',
      recorded_at: null,
      period_start: periodStartISO,
      period_end: periodEndISO,
      numeric_value: desat.odi3PctOrNull,
      unit: '/h',
      canonical_value: desat.odi3PctOrNull,
      canonical_unit: '/h',
      extras: odiExtras,
    },
    {
      source_slug: SOURCE_SLUG,
      source_record_id: `oxylink_${wakeDate}_spo2_time_below_90_pct`,
      data_shape: 'daily_summary',
      metric_type: 'spo2_time_below_90_pct',
      recorded_at: null,
      period_start: periodStartISO,
      period_end: periodEndISO,
      numeric_value: desat.timeBelow90Pct,
      unit: '%',
      canonical_value: desat.timeBelow90Pct,
      canonical_unit: '%',
      extras: {
        time_below_90_min: round1(desat.timeBelow90Min),
        time_below_88_min: round1(desat.timeBelow88Min),
        time_below_85_min: round1(desat.timeBelow85Min),
        valid_recording_hours: round1(desat.validRecordingHours),
      },
    },
    {
      // Overnight SpO2 curve — ONE row per night, downsampled array packed
      // into `extras`. This is the *display* curve (~700–1,200 pts at
      // CURVE_BUCKET_S=20 s buckets); the clinical summary numbers above
      // were computed on the full ~4 s series. Reasoned in the spec:
      // we never query individual points in SQL — only fetch whole-night
      // to draw. ~50–150 KB/night → ~40 MB/year, no new index.
      source_slug: SOURCE_SLUG,
      source_record_id: `oxylink_${wakeDate}_spo2_curve`,
      data_shape: 'daily_summary',
      metric_type: 'spo2_overnight_curve',
      recorded_at: null,
      period_start: periodStartISO,
      period_end: periodEndISO,
      numeric_value: null,
      unit: null,
      canonical_value: null,
      canonical_unit: null,
      extras: {
        interval_s: CURVE_BUCKET_S,
        start_ts: firstTs.toISOString(),
        spo2: downsampleSpo2Curve(rows, firstTs, lastTs, CURVE_BUCKET_S),
      },
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
      spo2_odi_3pct: desat.odi3PctOrNull,
      spo2_odi_4pct: desat.odi4Pct,
      time_below_90_pct: desat.timeBelow90Pct,
      valid_recording_hours: round1(desat.validRecordingHours),
    },
  }

  return { kind: 'ok', rows: obsRows, summary }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

// ─── Desaturation computation ────────────────────────────────────────────
//
// Walks the sorted rows[] in time order. Maintains a trailing-window local
// baseline (max SpO2 over ODI_BASELINE_WINDOW_S). Detects events as drops
// of ≥drop_pct from that baseline lasting ≥ODI_MIN_EVENT_DURATION_S, with
// ≥ODI_MIN_EVENT_SEPARATION_S between nadirs. valid_recording_hours sums
// inter-sample gaps clipped at ODI_MAX_GAP_S so sensor-off stretches don't
// inflate the denominator. ODI suppressed if validRecordingHours < ODI_MIN_HOURS.
//
// Time-below metrics use the SAME clipped inter-sample integration so a
// sensor-off stretch doesn't quietly inflate them either.
//
// All numbers here are SCREENING-grade approximations. Don't claim diagnostic
// accuracy anywhere in the UI.

interface DesaturationStats {
  /** ODI at the 3% threshold, /h. Null if validRecordingHours < ODI_MIN_HOURS. */
  odi3PctOrNull: number | null
  /** ODI at the 4% threshold, /h. Always computed (for extras). */
  odi4Pct: number
  eventCount3pct: number
  eventCount4pct: number
  validRecordingHours: number
  timeBelow90Min: number
  timeBelow88Min: number
  timeBelow85Min: number
  /** % of valid recording time spent < 90% SpO2 (drift-able metric). */
  timeBelow90Pct: number
  dist: { ge95Min: number; b90_94Min: number; lt90Min: number }
}

function computeDesaturation(rows: ParsedRow[]): DesaturationStats {
  const eventCount3pct = countDesatEvents(rows, ODI_DROP_PCT)
  const eventCount4pct = countDesatEvents(rows, ODI_DROP_PCT_4)

  let validSec = 0
  let below90Sec = 0
  let below88Sec = 0
  let below85Sec = 0
  let ge95Sec = 0
  let b90_94Sec = 0
  let lt90Sec = 0

  for (let i = 0; i < rows.length - 1; i++) {
    const gapSec = (rows[i + 1].ts.getTime() - rows[i].ts.getTime()) / 1000
    if (gapSec <= 0 || gapSec > ODI_MAX_GAP_S) continue
    validSec += gapSec
    const v = rows[i].spo2
    if (v < 90) below90Sec += gapSec
    if (v < 88) below88Sec += gapSec
    if (v < 85) below85Sec += gapSec
    if (v >= 95) ge95Sec += gapSec
    else if (v >= 90) b90_94Sec += gapSec
    else lt90Sec += gapSec
  }

  const validRecordingHours = validSec / 3600
  const odi3 = validRecordingHours > 0 ? round1(eventCount3pct / validRecordingHours) : 0
  const odi4 = validRecordingHours > 0 ? round1(eventCount4pct / validRecordingHours) : 0
  const timeBelow90Pct = validSec > 0 ? round1((below90Sec / validSec) * 100) : 0

  return {
    odi3PctOrNull: validRecordingHours >= ODI_MIN_HOURS ? odi3 : null,
    odi4Pct: odi4,
    eventCount3pct,
    eventCount4pct,
    validRecordingHours,
    timeBelow90Min: below90Sec / 60,
    timeBelow88Min: below88Sec / 60,
    timeBelow85Min: below85Sec / 60,
    timeBelow90Pct,
    dist: { ge95Min: ge95Sec / 60, b90_94Min: b90_94Sec / 60, lt90Min: lt90Sec / 60 },
  }
}

/**
 * AASM-style desaturation event detector. For each sample i, baseline =
 * max(SpO2) over the trailing ODI_BASELINE_WINDOW_S seconds (capped at i).
 * Walks forward looking for a nadir ≥ dropPct below that baseline; the
 * event is confirmed only if the dip lasts ≥ ODI_MIN_EVENT_DURATION_S and
 * the nadir is ≥ ODI_MIN_EVENT_SEPARATION_S after the previous event.
 */
function countDesatEvents(rows: ParsedRow[], dropPct: number): number {
  if (rows.length < 2) return 0
  let lastEventTs = -Infinity
  let events = 0
  let i = 0
  while (i < rows.length) {
    const tNow = rows[i].ts.getTime() / 1000
    // Local baseline: max SpO2 over the trailing window.
    let bIdx = i
    while (bIdx > 0 && (tNow - rows[bIdx - 1].ts.getTime() / 1000) <= ODI_BASELINE_WINDOW_S) bIdx--
    let baseline = rows[bIdx].spo2
    for (let k = bIdx; k <= i; k++) if (rows[k].spo2 > baseline) baseline = rows[k].spo2

    // Search forward for a dip of ≥ dropPct that meets duration + separation.
    let j = i + 1
    let nadirVal = rows[i].spo2
    let nadirIdx = i
    while (j < rows.length) {
      const v = rows[j].spo2
      if (v < nadirVal) {
        nadirVal = v
        nadirIdx = j
      }
      // Stop once SpO2 has recovered to within 1pp of baseline (event ended).
      if (v >= baseline - 1) break
      j++
    }
    if (j >= rows.length) break

    const drop = baseline - nadirVal
    const durationSec = (rows[j].ts.getTime() - rows[i].ts.getTime()) / 1000
    const separationSec = rows[nadirIdx].ts.getTime() / 1000 - lastEventTs

    if (drop >= dropPct && durationSec >= ODI_MIN_EVENT_DURATION_S && separationSec >= ODI_MIN_EVENT_SEPARATION_S) {
      events++
      lastEventTs = rows[nadirIdx].ts.getTime() / 1000
      // Advance past the recovery point so the next baseline lookup uses
      // post-event samples.
      i = j
      continue
    }
    i++
  }
  return events
}

/**
 * Downsample the full per-reading SpO2 series into fixed-width time buckets
 * (CURVE_BUCKET_S seconds each), keyed off `start_ts` so the panel can
 * reconstruct timestamps without sending them. Buckets that span a sensor-off
 * gap (no samples) emit `null` — gotcha #34: null = gap, never zero.
 *
 * Returned array has length = ceil((lastTs - startTs)/bucket). Average SpO2
 * within the bucket is rounded to integer (display precision).
 */
function downsampleSpo2Curve(
  rows: ParsedRow[],
  startTs: Date,
  lastTs: Date,
  bucketS: number
): (number | null)[] {
  const startMs = startTs.getTime()
  const totalSec = Math.max(0, (lastTs.getTime() - startMs) / 1000)
  const bucketCount = Math.max(1, Math.ceil(totalSec / bucketS))
  const sums = new Array<number>(bucketCount).fill(0)
  const counts = new Array<number>(bucketCount).fill(0)

  for (const r of rows) {
    const offsetSec = (r.ts.getTime() - startMs) / 1000
    const idx = Math.min(bucketCount - 1, Math.floor(offsetSec / bucketS))
    if (idx < 0) continue
    sums[idx] += r.spo2
    counts[idx] += 1
  }

  const out: (number | null)[] = new Array(bucketCount)
  for (let i = 0; i < bucketCount; i++) {
    out[i] = counts[i] > 0 ? Math.round(sums[i] / counts[i]) : null
  }
  return out
}

// ─── Exported parser ──────────────────────────────────────────────────────

export const oxylinkParser: FileDropParser = {
  sourceSlug: SOURCE_SLUG,
  sourceFolder: SOURCE_FOLDER,
  validate: validateOxylink,
  parse: parseOxylink,
}
