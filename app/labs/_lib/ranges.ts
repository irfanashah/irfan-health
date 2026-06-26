// Labs reference-range + flag helpers.
//
// Precedence for the reference range of any value on a panel:
//   1. Lab-reported range (extracted from the report)    — authoritative for that draw.
//   2. Remembered standard range (lab_marker_ref_ranges) — confirmed previously, deterministic.
//   3. AI-proposed standard range (LLM, this call)        — fallback for genuinely-new markers.
// Steps 1+2 happen in code (this module); step 3 lives in the LLM
// prompt + tool schema. The user always confirms in the review UI.
//
// Flag computation:
//   - If the lab printed a flag → use it verbatim (authoritative).
//   - Else if a range exists (reported, remembered, or proposed) → compute H/L/N.
//   - HH/LL ONLY from an explicit lab flag, OR a confirmed
//     critical_low/critical_high threshold for the marker. Don't infer
//     "critical" from "just further out" — that's how spurious panic
//     alerts get into a dashboard.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DraftValue } from './types'

/** Single-user assumption: Irfan is male. Sex-aware lookups default to 'M'. */
export const PATIENT_SEX: 'M' | 'F' | null = 'M'

export type LabFlag = 'H' | 'L' | 'HH' | 'LL' | 'N' | null

export interface RememberedRange {
  marker_slug: string
  sex: 'M' | 'F' | null
  ref_low: number | null
  ref_high: number | null
  ref_unit: string | null
  critical_low: number | null
  critical_high: number | null
}

/**
 * Look up remembered standard ranges for a set of marker slugs.
 * Returns a map keyed by slug. Sex-aware: prefers the patient-sex row
 * over a generic (sex IS NULL) row when both exist.
 */
export async function fetchRememberedRanges(
  supabase: SupabaseClient,
  slugs: string[]
): Promise<Map<string, RememberedRange>> {
  const out = new Map<string, RememberedRange>()
  const valid = slugs.filter((s) => s && s !== 'unmapped')
  if (valid.length === 0) return out

  const { data, error } = await supabase
    .from('lab_marker_ref_ranges')
    .select('marker_slug, sex, ref_low, ref_high, ref_unit, critical_low, critical_high')
    .in('marker_slug', valid)
  if (error || !data) return out
  const rows = data as RememberedRange[]

  // Sex-specific wins; the generic NULL-sex row is a fallback. If a marker
  // happens to have both rows in the table, the sex-specific one is picked.
  for (const r of rows) {
    if (r.sex === PATIENT_SEX) {
      out.set(r.marker_slug, r)
    }
  }
  for (const r of rows) {
    if (out.has(r.marker_slug)) continue
    if (r.sex === null) out.set(r.marker_slug, r)
  }
  return out
}

/**
 * Compute the flag for a value given its (final) range + optional
 * critical thresholds. Honour an authoritative lab flag if supplied —
 * the lab printed it for a reason.
 *
 * Returns null when there's nothing meaningful to flag (value or
 * range absent) — the UI shows an empty badge rather than a misleading
 * "N" that implies "we checked and it's normal".
 */
export function computeFlag(args: {
  value: number | null
  refLow: number | null
  refHigh: number | null
  criticalLow: number | null
  criticalHigh: number | null
  labFlag: LabFlag
}): LabFlag {
  // Lab-printed flag wins (gotcha — the lab printed it for a reason;
  // includes case where lab flagged something we'd otherwise compute
  // as N because of a slightly-different threshold).
  if (args.labFlag) return args.labFlag

  if (args.value === null) return null
  if (args.refLow === null && args.refHigh === null) return null

  // Critical thresholds (HH/LL) — only honoured when explicitly
  // provided, never inferred from "value much further out than refHigh".
  if (args.criticalHigh !== null && args.value > args.criticalHigh) return 'HH'
  if (args.criticalLow !== null && args.value < args.criticalLow) return 'LL'

  if (args.refHigh !== null && args.value > args.refHigh) return 'H'
  if (args.refLow !== null && args.value < args.refLow) return 'L'
  return 'N'
}

/**
 * Overlay remembered ranges + recompute flags on a draft. Runs AFTER
 * the alias overlay, so the slug we look up is the confirmed/aliased
 * one — not the LLM's per-call guess.
 *
 * Precedence applied per row:
 *   - reported range (already present from the LLM extract) → keep + mark 'reported'
 *   - else remembered standard range → overlay + mark 'standard'
 *   - else AI-proposed range (already present on the draft) → mark 'proposed'
 *
 * Flag is recomputed from the FINAL range when no lab flag exists.
 */
export function overlayRangesOnDraft(
  draft: DraftValue[],
  remembered: Map<string, RememberedRange>
): DraftValue[] {
  return draft.map((v) => {
    const slug = v.suggested_marker_slug
    const reported = v.ref_low !== null || v.ref_high !== null || v.ref_text !== null
    let next: DraftValue = { ...v }

    // 2. Remembered standard range — only if the lab didn't print one.
    if (!reported && slug && remembered.has(slug)) {
      const r = remembered.get(slug)!
      next = {
        ...next,
        ref_low: r.ref_low,
        ref_high: r.ref_high,
        ref_unit: r.ref_unit ?? next.unit,
        range_source: 'standard',
        critical_low: r.critical_low,
        critical_high: r.critical_high,
      }
    } else if (reported) {
      next = { ...next, range_source: 'reported' }
    }
    // 3. else: the LLM may have already filled proposed_ref_*; the
    //    extract.ts pipeline normalises that into ref_low/ref_high with
    //    range_source='proposed'.

    // Recompute flag from the FINAL range when no lab flag exists.
    if (!v.flag) {
      next.flag = computeFlag({
        value: next.numeric_value,
        refLow: next.ref_low,
        refHigh: next.ref_high,
        criticalLow: next.critical_low ?? null,
        criticalHigh: next.critical_high ?? null,
        labFlag: null,
      })
    }

    return next
  })
}
