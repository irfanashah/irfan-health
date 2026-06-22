// File-drop parser contract — Slice 4.
//
// Each registered parser turns one file's bytes into a list of observation
// rows to upsert into health_observations, plus the metadata the cron needs
// to write a single ingestion_log row per file.
//
// Parsers are stateless and pure (no DB calls); the cron handles I/O.

export interface ObservationRow {
  source_slug: string
  source_record_id: string
  data_shape: 'time_series' | 'daily_summary' | 'discrete' | 'episodic'
  metric_type: string
  recorded_at: string | null   // ISO timestamp
  period_start: string | null  // ISO timestamp
  period_end: string | null    // ISO timestamp
  numeric_value: number | null
  unit: string | null
  canonical_value: number | null
  canonical_unit: string | null
  extras: Record<string, unknown> | null
}

export interface ParsedFileSummary {
  /** Window the rows cover — used as fetch_window_start/end on ingestion_log. */
  period_start: string
  period_end: string
  /** Breakdown of rows dropped during parse (drives ingestion_log.records_skipped + diagnostics). */
  skip_breakdown: {
    sentinel: number       // sensor-off / null-encoding values
    out_of_range: number   // physically implausible readings
    parse_errors: number   // unparseable rows (timestamp format drift, bad columns, etc.)
  }
  /** Total input rows seen (data rows, excluding header). */
  rows_seen: number
  /** Rows that survived all filters → contributed to the summary. */
  rows_valid: number
  /** Optional extra metadata the parser wants logged in raw_payload. */
  meta?: Record<string, unknown>
}

export type ParseResult =
  | { kind: 'ok'; rows: ObservationRow[]; summary: ParsedFileSummary }
  | { kind: 'fail'; reason: string; summary?: ParsedFileSummary }

export interface FileDropParser {
  /** Slug used in health_observations.source_slug + ingestion_log.source_slug. */
  sourceSlug: string

  /** Subfolder name under inbox/ (matches the source slug for v1). */
  sourceFolder: string

  /**
   * Validate the file's content shape. Header-signature check primarily;
   * cheap, runs before parse(). Should be tolerant of trivial drift
   * (trailing-column changes) but reject a misfiled file (wrong source).
   *
   * Returns true to proceed to parse(); false → cron moves the file to
   * failed/<source>/ with reason "content validation failed".
   */
  validate(bytes: Buffer): boolean

  /**
   * Parse a validated file into observation rows + summary metadata.
   * Pure — does not touch the DB or Drive.
   */
  parse(bytes: Buffer, fileMeta: { name: string; driveFileId: string }): ParseResult
}
