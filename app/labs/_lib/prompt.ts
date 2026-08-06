// Anthropic prompt + tool schema for lab-report extraction.
//
// Strategy: force the model to call ONE tool (`extract_lab_panel`) whose
// JSON-schema input IS the draft. Output is structured by construction —
// no JSON parsing of free-form text.
//
// Two extraction paths share the same prompt + tool:
//   text path:   user message is the verbatim extracted text from the
//                PDF's text layer. Prompt instructs "organise; do NOT
//                alter, round, or infer any value" — numbers come from
//                the real text, not vision transcription.
//   vision path: user message has a {type:'document'} block holding the
//                PDF bytes. Used when there's no usable text layer.
//
// The prompt is format-agnostic by design: no Fakeeh-specific anchors,
// no column-position hints. The system MUST handle reports from any lab
// — hospitals, specialty clinics, regional labs — each with its own
// layout, marker vocabulary, units, and reference-range conventions.
// The Fakeeh sample is one example, not the assumed format.

import { ALL_MARKER_SLUGS } from './markers'

export const ANTHROPIC_MODEL = 'claude-sonnet-4-6'

export const SYSTEM_PROMPT = `You extract structured lab/test results from medical documents.

YOU HAVE TWO DISTINCT JOBS — DO NOT CONFLATE THEM.

────────────────────────────────────────────────────────────────────
JOB 1 (SACRED) — extract patient MEASUREMENTS verbatim.
The result value, reported unit, reported reference range (if printed),
and any printed flag are PATIENT DATA. NEVER invent, alter, round,
re-derive, or "correct" them. They come from the document exactly as
printed. If a value is unreadable or absent → null + a per-row note.
Honest "I don't know" beats a guess on medical numbers.

JOB 2 — propose CONTEXT for canonicalisation + missing ranges/flags.
Canonical slug suggestions, AND — only when the report doesn't print a
reference range — proposed population-standard adult reference ranges
(plus a computed flag from value vs. range). These are CONTEXT, not
measurements. They are clearly labelled in the structured output
(range_source='proposed') and the user confirms each in review before
anything commits.

The contract: values are sacred; context is suggested.

────────────────────────────────────────────────────────────────────

DOCUMENT TYPES YOU MUST HANDLE:
- Clean blood-panel lab reports (tables of markers + results + ref ranges).
- Larger clinical documents — discharge summaries, consultation notes, admission records, progress notes — where lab results sit EMBEDDED among narrative.
- Echocardiogram / TTE (transthoracic echo) reports — M-Mode / 2D / Doppler measurement tables plus a findings/conclusion narrative. See the ECHOCARDIOGRAM section below.
Extract ALL lab/test results, however presented (tables, inline sentences, bulleted lists, "Investigations" sections). IGNORE non-lab narrative — diagnoses, medications, treatment plans, course-of-stay, recommendations, free-text impressions. None of those become marker rows.

────────────────────────────────────────────────────────────────────
JOB 1 RULES (values, units, reported ranges, lab-printed flags)
────────────────────────────────────────────────────────────────────
- NEVER invent, round, infer, or back-compute values. If a number is unreadable, absent, or unclear, leave it null and add a brief note. Do not guess.
- Preserve raw marker names VERBATIM (including prefixes like "SERUM " or suffixes like " (K)" — the user will correct via the controlled vocabulary).
- Preserve reported units VERBATIM. Don't convert. Don't normalise.
- Preserve REPORTED reference ranges as printed. If the range is "low-high", split into ref_low / ref_high with range_source='reported'. If it's "< 5" / "> 60" / "Negative" / qualitative, leave numeric ref_low/ref_high null and put the literal text in ref_text (still range_source='reported'). DO NOT FALL BACK to a proposed range when the report DID print one.
- Qualitative results (Negative, Reactive, Non-reactive, blood group, urine appearance, etc.) → put the result in text_value and leave numeric_value null.
- Lab-printed flags: H, L, HH, LL, N → use verbatim. Words like "High"/"Low"/"Critical" → map to H/L/HH respectively. If no flag is printed, leave flag null (Job 2 will compute one from the range).

────────────────────────────────────────────────────────────────────
JOB 2 RULES (proposed slug, proposed range, proposed flag)
────────────────────────────────────────────────────────────────────
Canonical slug (every row):
- Suggest a canonical marker_slug from this list when confident:
${ALL_MARKER_SLUGS.map((s) => `  - ${s}`).join('\n')}
- "SERUM SODIUM" or "Sodium (Na)" → sodium. "LDL CHOLESTEROL" → ldl. "Glycated Hb" / "Hemoglobin A1c" → hba1c. "NEUTROPHILS %" → neutrophils_pct (if that's in the list). Strip prefixes ("SERUM ", "PLASMA ") and suffixes (" (K)", " - Calculated") for matching.
- If no slug fits, suggest a sensible NEW slug (lowercase, alphanumeric + underscore) — e.g. "RDW-CV" → rdw_cv. The user can confirm/merge in review.

Proposed range (ONLY when the report did NOT print one for this marker):
- Set range_source='proposed', and fill proposed_ref_low / proposed_ref_high / proposed_ref_unit with the standard ADULT reference range for this marker. ASSUME MALE SEX (single-user app, patient is male) for sex-specific markers — hemoglobin, hematocrit, ferritin, creatinine, urate, eGFR-style metrics.
- Use widely-accepted population-standard ranges. Do not guess if you're unsure for an obscure marker — leave proposed_ref_low/high null and set range_source='proposed' with proposed_unit only.
- Critical thresholds (proposed_critical_low / proposed_critical_high): fill ONLY for markers where panic thresholds are clinically standard (potassium, sodium, glucose, hemoglobin, calcium, hs-CRP optionally). Leave null otherwise — don't fabricate "critical" thresholds for routine markers.
- These ranges are CONTEXT, not measurements. The UI labels them "proposed standard" so the user knows the provenance.

Proposed flag (when no lab-printed flag exists):
- Compute H / L / N from value vs the final range you're proposing.
- HH / LL: ONLY if the value crosses an explicit critical threshold you set above. NEVER infer "critical" from "value much further out than refHigh".
- If no range exists (you couldn't propose one), leave the flag null.

────────────────────────────────────────────────────────────────────
FORMAT-AGNOSTIC EXTRACTION
────────────────────────────────────────────────────────────────────
- Make NO assumption about the report's layout, column order, grouping, or vendor. Some reports use tables; some use stacked key-value rows; some span multiple pages; some group markers under section headers ("ELECTROLYTE PANEL", "LIPID PANEL"). Discharge summaries may use inline sentences or small embedded tables.
- Extract EVERY test result visible across the entire document.
- If a marker has a "Test Methodology" or similar column, ignore it.
- Skip headers / footers / page numbers / patient demographics / report-generation timestamps.

────────────────────────────────────────────────────────────────────
ECHOCARDIOGRAM / TTE REPORTS
────────────────────────────────────────────────────────────────────
An echo report lists cardiac measurements (M-Mode / 2D / Doppler) — treat each numeric measurement as a marker row, EXACTLY like a blood result: value + unit verbatim (Job 1), canonical slug + proposed range (Job 2). JOB 1 IS STILL SACRED — never invent an echo number.

- UNITS VERBATIM. Chamber/wall dimensions may be printed in cm (e.g. Fakeeh) OR mm (e.g. AFIC) — record the unit exactly as printed ("cm" or "mm"). DO NOT convert (the app converts mm→cm deterministically downstream). Velocities m/s, gradients/pressures mmHg, times ms, ratios unitless.
- Map each lab's naming to the canonical slug (both spellings map to the same slug — the app remembers per-lab names after the first commit):
  - Ejection Fraction / EF / LVEF → ef
  - IVSd / Septal Thickness / Septal Thickness at R Wave / IVS → ivsd
  - LVPWd / PW / Posterior Wall / PW diastole → lvpwd
  - LVIDd / LV Diastolic Diameter / Diastolic Diameter / LVEDD → lvidd
  - LVIDs / LV Systolic Diameter / Systolic Diameter / LVESD → lvids
  - LA / LA diameter / Left Atrium / Aortic root+LA pair (the LA one) → la_diameter
  - Aortic root / AO / Aortic Root Diameter → aortic_root
  - LVOT → lvot ; TAPSE → tapse
  - Mitral E velocity → mv_e_vel ; Mitral A velocity → mv_a_vel ; E/A → e_a_ratio ; E/e′ (E/Ea, E/E') → e_e_prime
  - Aortic valve velocity / AV Vmax → aortic_vel ; Aortic opening / Aortic valve opening / cusp separation → av_opening ; Deceleration time / Dec-T → deceleration_time ; IVRT → ivrt
  - TR peak gradient / TR PG → tr_pg ; TR jet velocity / TR Vmax → tr_vel ; RV/PA pressure / RVSP / PASP → rvsp ; Fractional shortening / FS → fractional_shortening
- A measurement reported as a RANGE (e.g. EF "55–60%") → store its MIDPOINT in numeric_value (57.5), keep the original "55–60%" in text_value, and add a per-row note "reported as a range". A single number → store as-is.
- QUALITATIVE FINDINGS ARE NOT MARKER ROWS. The findings/conclusion narrative — LV size + systolic function, LVH (concentric/eccentric), diastolic-dysfunction grade, RWMA / regional wall-motion, valve regurgitation grades (MR/AR/TR trace/mild/moderate), pericardial effusion — go into the PANEL notes field as a short summary. NEVER fabricate a number for a qualitative finding (do not turn "mild MR" into a value). (Ordinal grading of regurgitation for a numeric trend is out of scope for now.)
- Proposed standard ranges (Job 2, only when the report didn't print one) — use these widely-accepted adult echo ranges, expressed in the CANONICAL unit (cm for dimensions): ef ≥55% (55–75); ivsd/lvpwd 0.6–1.2 cm; lvidd 3.5–5.6 cm; lvids 2.5–4.1 cm; la_diameter 1.5–4.0 cm; aortic_root 2.0–3.7 cm; tapse ≥1.7 cm; e_a_ratio 1–2; e_e_prime <8. If the report DID print a range (AFIC prints them, often in mm), keep it as the reported range in the printed unit (range_source='reported') — do not convert.
- drawn_at = the STUDY date (the echo date).

────────────────────────────────────────────────────────────────────
DATE INTERPRETATION
────────────────────────────────────────────────────────────────────
- Many labs use DD/MM/YYYY (day-first); some US labs use MM/DD/YYYY. Look at the report's context — lab name, hospital location, other written dates ("April 29 2026"), and impossible day values (> 12 in the first position rules out month-first).
- For drawn_at: prefer the lab COLLECTION / DRAW date. Otherwise use the document date. In a discharge summary spanning an admission, a value drawn on admission day 1 should bucket to that date, not the discharge date. If you can't tell, set dateAmbiguous: true with a brief note. NEVER silently pick.
- Output drawn_at as ISO YYYY-MM-DD. Time is ignored.

OUTPUT:
- Call the extract_lab_panel tool ONCE with all extracted data. No text before or after the tool call.`

/**
 * JSON-schema for the extract_lab_panel tool. Anthropic's tool-use forces
 * the model to return data matching this schema; we then parse the
 * tool_use block to get a typed draft (no free-form JSON parsing).
 */
export const EXTRACT_TOOL = {
  name: 'extract_lab_panel',
  description:
    'Submit the structured extraction of a lab or cardiac-imaging report (blood panel, discharge summary, or echocardiogram/TTE). Call this tool exactly once with all data found across the entire document.',
  input_schema: {
    type: 'object',
    required: ['panel', 'values', 'dateAmbiguous'],
    properties: {
      panel: {
        type: 'object',
        required: ['drawn_at', 'lab_name', 'ordering_physician'],
        properties: {
          drawn_at: {
            type: ['string', 'null'],
            description: 'Draw date as ISO YYYY-MM-DD (day-first interpretation unless context indicates US format).',
          },
          lab_name: {
            type: ['string', 'null'],
            description: 'Hospital or lab name as printed (e.g. "Fakeeh University Hospital").',
          },
          ordering_physician: {
            type: ['string', 'null'],
            description: 'Doctor name printed on the report (e.g. "Dr. Fekry Eldeeb"). Null if absent.',
          },
          notes: {
            type: ['string', 'null'],
            description: 'Free-form notes — e.g. ambiguous date, multi-section report context.',
          },
        },
      },
      dateAmbiguous: {
        type: 'boolean',
        description: 'True iff drawn_at could not be unambiguously interpreted (e.g. 03/04 with no context).',
      },
      extractionNote: {
        type: ['string', 'null'],
        description: 'Free-form note about the extraction itself — e.g. "page 2 partially blurred", "table format unusual".',
      },
      values: {
        type: 'array',
        description: 'One entry per test result anywhere in the document.',
        items: {
          type: 'object',
          required: ['raw_marker_name'],
          properties: {
            // ─── Job 1: extracted measurements (SACRED — verbatim) ─────
            raw_marker_name: { type: 'string', description: 'Verbatim marker name as printed.' },
            numeric_value: { type: ['number', 'null'], description: 'Verbatim numeric result. NEVER altered/rounded/inferred.' },
            text_value: { type: ['string', 'null'], description: 'Qualitative result (e.g. "Negative", "A+"). Null when numeric_value is set.' },
            unit: { type: ['string', 'null'], description: 'Reported unit verbatim (mg/dL, mmol/L, %, IU/L). Null if unitless.' },
            // Reported reference range — present ONLY when the report printed one.
            ref_low: { type: ['number', 'null'], description: 'REPORTED ref low (lab printed it). Null if the report did not print a numeric range.' },
            ref_high: { type: ['number', 'null'], description: 'REPORTED ref high.' },
            ref_unit: { type: ['string', 'null'], description: 'REPORTED reference unit (typically matches unit).' },
            ref_text: {
              type: ['string', 'null'],
              description: 'Reference range verbatim if it can\'t fit as low/high (e.g. "< 5", "> 60", "Negative").',
            },
            flag: {
              type: ['string', 'null'],
              enum: ['H', 'L', 'HH', 'LL', 'N', null],
              description: 'LAB-PRINTED flag. Null if no flag printed (Job 2 proposes one).',
            },

            // ─── Job 2: proposed context (canonical / range / flag) ─────
            suggested_marker_slug: {
              type: ['string', 'null'],
              description: 'Canonical slug — from the registry when one fits, or a sensible new lowercase_underscore slug otherwise. Never null unless the row is unmappable.',
            },
            range_source: {
              type: 'string',
              enum: ['reported', 'proposed'],
              description: 'reported = lab printed the range above; proposed = range_low/high not printed, see proposed_ref_* below.',
            },
            proposed_ref_low: {
              type: ['number', 'null'],
              description: 'PROPOSED standard adult ref low (assume male) — populated ONLY when range_source=proposed AND a widely-accepted standard exists. Otherwise null.',
            },
            proposed_ref_high: {
              type: ['number', 'null'],
              description: 'PROPOSED standard adult ref high.',
            },
            proposed_ref_unit: {
              type: ['string', 'null'],
              description: 'Unit for the proposed standard range.',
            },
            proposed_critical_low: {
              type: ['number', 'null'],
              description: 'Critical (panic) low threshold — ONLY for markers with widely-accepted clinical critical values (K, Na, glucose, Hb, Ca). Null otherwise.',
            },
            proposed_critical_high: {
              type: ['number', 'null'],
              description: 'Critical (panic) high threshold — same conditions.',
            },
            proposed_flag: {
              type: ['string', 'null'],
              enum: ['H', 'L', 'HH', 'LL', 'N', null],
              description: 'Flag computed from value vs the FINAL range (reported wins; else proposed). HH/LL only when crossing an explicit critical threshold. Used only when "flag" above is null.',
            },

            notes: {
              type: ['string', 'null'],
              description: 'Free-form per-value notes — e.g. "unit unrecognised", "result obscured", "proposed range from population standard".',
            },
          },
        },
      },
    },
  },
} as const
