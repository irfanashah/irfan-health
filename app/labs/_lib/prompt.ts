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

DOCUMENT TYPES YOU MUST HANDLE:
- Clean blood-panel lab reports (the common case — tables of markers + results + ref ranges).
- Larger clinical documents — discharge summaries, consultation notes, admission records, progress notes — where lab results sit EMBEDDED among narrative (diagnoses, medications, course-of-stay, plans).
Extract ALL lab/test results visible anywhere in the document, however they're presented (tables, inline sentences, bulleted lists, "Investigations" sections). IGNORE non-lab narrative — diagnoses, medications, treatment plans, course-of-stay, recommendations, free-text impressions. None of those become marker rows.

GUARDRAILS — LOAD-BEARING:
- This is medical data. It will inform cardiac care decisions. Accuracy and honesty over completeness.
- NEVER invent, round, infer, or back-compute values. If a number is unreadable, absent, or unclear, leave it null and add a brief note. Do not guess.
- Preserve raw marker names VERBATIM (exactly as printed, including prefixes like "SERUM " or suffixes like " (K)" — the user will correct via a controlled vocabulary).
- Preserve reported units VERBATIM. Don't convert. Don't normalise. The application handles canonical conversion deterministically downstream.
- Preserve reference ranges as printed. If the range is "low-high", split into ref_low/ref_high; if it's "< 5" / "> 60" / "Negative" / qualitative, leave numeric ref nulls and put the literal text in ref_text. Reference ranges are often ABSENT in discharge summaries — leave the ref fields null, don't invent a range.
- Qualitative results (Negative, Reactive, Non-reactive, blood group, urine appearance, etc.) → put the result in text_value and leave numeric_value null.
- Flags: if a single-letter flag appears next to a result (H, L, HH, LL, N), capture it in flag. If the report uses words ("High"/"Low"/"Critical"), map to H/L/HH/LL respectively. Otherwise null.

FORMAT-AGNOSTIC EXTRACTION:
- Make NO assumption about the report's layout, column order, grouping, or vendor. Some reports use tables; some use stacked key-value rows; some span multiple pages; some group markers under section headers (e.g. "ELECTROLYTE PANEL", "LIPID PANEL"). Discharge summaries may use inline sentences ("Admission labs: Troponin I 0.45 ng/mL (elevated), CK-MB 12 ng/mL …") or a small embedded table.
- Extract EVERY test result visible across the entire document.
- If a marker has a "Test Methodology" or similar column, ignore it (not stored).
- If a row is clearly a header / footer / page number / patient demographic / report-generation timestamp, skip it.

DATE INTERPRETATION:
- Many labs use DD/MM/YYYY (day-first); some US labs use MM/DD/YYYY. Look at the report's context — the lab name, hospital location, other written dates ("April 29 2026"), and impossible day values (> 12 in the first position rules out month-first) — to choose.
- For drawn_at: prefer the lab's COLLECTION / DRAW date if present. Otherwise use the document date. In a discharge summary that spans an admission, this matters: a value drawn on admission day 1 should bucket to that date, not the discharge date. If you can't tell whether a single date refers to the draw, the admission, or the discharge, output your best guess and set dateAmbiguous: true with a brief note (e.g. "could be admission or discharge date"). NEVER silently pick.
- If still genuinely ambiguous (e.g. 03/04/2026 with no other context), output your best guess and set dateAmbiguous: true with a note. The user will confirm in review.
- Output drawn_at as ISO YYYY-MM-DD. Time is ignored.

MARKER SLUG SUGGESTIONS:
- For each marker, suggest a canonical marker_slug from this list when you're confident the report's name maps to one:
${ALL_MARKER_SLUGS.map((s) => `  - ${s}`).join('\n')}
- "SERUM SODIUM" or "Sodium (Na)" → sodium. "LDL CHOLESTEROL" → ldl. "Glycated Hb" / "Hemoglobin A1c" → hba1c. Strip prefixes ("SERUM ", "PLASMA ") and suffixes (" (K)", " - Calculated") for matching.
- If you're not confident, leave suggested_marker_slug null. The user will pick from the dropdown in review.

OUTPUT:
- Call the extract_lab_panel tool ONCE with all extracted data. Do not output any text before or after the tool call.`

/**
 * JSON-schema for the extract_lab_panel tool. Anthropic's tool-use forces
 * the model to return data matching this schema; we then parse the
 * tool_use block to get a typed draft (no free-form JSON parsing).
 */
export const EXTRACT_TOOL = {
  name: 'extract_lab_panel',
  description:
    'Submit the structured extraction of a blood-panel lab report. Call this tool exactly once with all data found across the entire document.',
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
            raw_marker_name: { type: 'string', description: 'Verbatim marker name as printed.' },
            numeric_value: { type: ['number', 'null'] },
            text_value: { type: ['string', 'null'], description: 'Qualitative result (e.g. "Negative", "A+"). Null when numeric_value is set.' },
            unit: { type: ['string', 'null'], description: 'Reported unit verbatim (mg/dL, mmol/L, %, IU/L). Null if unitless.' },
            ref_low: { type: ['number', 'null'] },
            ref_high: { type: ['number', 'null'] },
            ref_unit: { type: ['string', 'null'] },
            ref_text: {
              type: ['string', 'null'],
              description: 'Reference range verbatim if it can\'t fit as low/high (e.g. "< 5", "> 60", "Negative").',
            },
            flag: {
              type: ['string', 'null'],
              enum: ['H', 'L', 'HH', 'LL', 'N', null],
              description: 'Out-of-range flag printed on the report. Null if no flag.',
            },
            suggested_marker_slug: {
              type: ['string', 'null'],
              description: 'Canonical slug from the registry above, OR null if you\'re not confident.',
            },
            notes: {
              type: ['string', 'null'],
              description: 'Free-form per-value notes — e.g. "unit unrecognised", "result obscured".',
            },
          },
        },
      },
    },
  },
} as const
