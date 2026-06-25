// Shared types for the labs extraction + review + commit flow.

export type ExtractionPath = 'text' | 'vision'

export interface DraftValue {
  /** The marker name printed in the report (verbatim — preserved for audit + alias learning). */
  raw_marker_name: string
  /** Numeric reading. Null when the result is textual ("Negative") or absent. */
  numeric_value: number | null
  /** Textual result for qualitative panels ("Negative", "Positive", blood group, urine appearance). */
  text_value: string | null
  /** Reported unit verbatim (mg/dL, mmol/L, %, IU/L, …). Null when unitless / absent. */
  unit: string | null
  /** Reference range — numeric low (when reported as "low-high"). */
  ref_low: number | null
  /** Reference range — numeric high. */
  ref_high: number | null
  /** Reference unit (typically matches `unit`). */
  ref_unit: string | null
  /**
   * Reference range when it can't fit numerically (e.g. "< 5", "> 60",
   * "Negative", "Non-reactive", qualitative bands). Surfaces in the
   * review UI as-is; not used for trend band shading.
   */
  ref_text: string | null
  /** Out-of-range flag printed on the report: H / L / HH / LL / N — or null. */
  flag: 'H' | 'L' | 'HH' | 'LL' | 'N' | null
  /** LLM-suggested canonical marker_slug (editable in the review dropdown). */
  suggested_marker_slug: string | null
  /** Free-form notes — e.g. "ambiguous date", "unit unrecognised". */
  notes: string | null
}

export interface DraftPanel {
  /** ISO date (YYYY-MM-DD) of the draw. */
  drawn_at: string | null
  /** Hospital / lab name as printed. */
  lab_name: string | null
  /** Ordering doctor as printed. */
  ordering_physician: string | null
  /** Free-form notes (panel-level — e.g. "ambiguous date 03/04/2026"). */
  notes: string | null
}

export interface ExtractionDraft {
  path: ExtractionPath
  /** True if the LLM flagged that the date couldn't be unambiguously day-first vs month-first. */
  dateAmbiguous: boolean
  panel: DraftPanel
  values: DraftValue[]
  /** Free-form note about the extraction itself (e.g. "no text layer; used vision"). */
  extractionNote: string | null
}
