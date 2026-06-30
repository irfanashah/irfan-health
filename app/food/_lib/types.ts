// Shared types for the food diary slice. Estimates ≠ measurements —
// macros come from an LLM (Claude Sonnet) and carry real error, so the
// UI labels them as estimates everywhere. None of the fields here imply
// clinical-grade precision.

export type MealLabel = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface MealItem {
  /** Plain-English item name; LLM is told to state portion assumptions inline if it inferred them. */
  name: string
  /** Best-effort quantity description ("1 medium", "200g", "1 bowl"). Optional. */
  qty?: string | null
  carbs_g?: number | null
  protein_g?: number | null
  fat_g?: number | null
  fiber_g?: number | null
  sugar_g?: number | null
  sodium_mg?: number | null
  calories?: number | null
}

export interface MealTotals {
  carbs_g: number | null
  protein_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
  calories: number | null
}

/** What the LLM returns (after validation), and what the user reviews before commit. */
export interface MealDraft {
  /** ISO timestamp (timestamptz) — verbatim from the form's eatenAt. */
  eatenAt: string
  /** Verbatim NL input. */
  description: string
  /** Auto-derived from eatenAt's GST hour; user can change in the review. */
  mealLabel: MealLabel
  items: MealItem[]
  totals: MealTotals
  /** Anything the model wants to flag to the user (e.g. assumed cuisine, ambiguous quantity). */
  note?: string | null
}

export interface MealEstimateOk {
  kind: 'ok'
  draft: MealDraft
}

export interface MealEstimateError {
  kind: 'error'
  error: string
  /**
   * `missingKey` lets the UI show a "manual fallback" affordance —
   * an empty draft the user fills in by hand. ANTHROPIC_API_KEY is
   * required for estimation but the diary still works without it.
   */
  missingKey?: boolean
}

export type MealEstimateResult = MealEstimateOk | MealEstimateError

/** Committed row, as the diary list + CGMChart markers consume it. */
export interface MealRow {
  id: string
  eaten_at: string
  meal_label: MealLabel | null
  description: string
  items: MealItem[] | null
  carbs_g: number | null
  protein_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  sodium_mg: number | null
  calories: number | null
  estimated: boolean
  edited: boolean
  source: string
  created_at: string
  updated_at: string
}
