# Slice 6 — Labs PDF Import (LLM extraction + human review) — Build Spec

**Version:** 1.4 (build-ready; hybrid text-layer-first extraction + robustness-across-sources)
**Date:** 2026-06-25
**Status:** Imports blood-panel lab PDFs into the reserved `lab_panels` / `lab_values` tables via **LLM extraction with a mandatory human-review step** (confirmed). **CORE REQUIREMENT: robust + flexible across many DIFFERENT sources** — hospitals, labs, specialty clinics — each with its own layout, marker naming, units, reference-range conventions, and date format. The Fakeeh report (`lab-reports/lab_report_pdf.pdf`) is **one validated example, NOT the assumed format** — nothing in the design may hard-code its layout. One small new table (`lab_marker_aliases`) powers the learn-as-you-go mapping; `lab_panels`/`lab_values` reused.
**Why human-in-the-loop:** these are medical numbers that inform cardiac decisions (LDL, Lp(a), HbA1c, etc.). LLM extraction is never auto-committed — Irfan reviews/corrects a draft before it's written.

---

## Decision 1 — Architecture: in-app upload+review flow ✅ CONFIRMED
Self-contained `/labs` flow: upload a PDF in the app → extract → review/correct inline → confirm → commit. No Drive folder, no cron (labs are episodic; review needs to be interactive). Diverges from the old "labs ride `inbox/labs/`" intent — intentionally.

## The flow
1. **Upload** — `/labs` page: a file input for a lab PDF (+ store the raw file in Supabase Storage → `lab_panels.raw_file_ref`).
2. **Extract — HYBRID (text-layer-first, vision fallback).** First, **deterministically extract the PDF's text layer** (server-side, e.g. `pdf-parse`/`pdfjs-dist`). Then:
   - **Text path (digital PDFs — the common case):** send the **exact extracted text** to the Anthropic API and ask it to **structure + map only** — "here is the verbatim text from a lab report; organise it into the schema; do NOT alter, round, or infer any value." The numbers come from the real text layer, not from the model transcribing pixels → **removes most digit-misread risk** (the LLM's main hazard on medical data).
   - **Vision path (scanned/image PDFs with no usable text layer):** fall back to sending the PDF itself to the LLM's vision (Claude reads PDFs/images natively).
   - Detect which path via a text-layer-usability heuristic (extracted text length / has-recognisable-content). **Tag the draft with the path used** (`text` vs `vision`) so review can be extra-careful on vision-extracted reports.
   Either path returns the same **draft**: panel metadata (`drawn_at`, `lab_name`, `ordering_physician`) + markers `{ raw_marker_name, numeric_value | text_value, unit, ref_low, ref_high, ref_unit, flag, suggested_marker_slug }`.
3. **Review** — render the draft as an **editable table**: every marker shown with its raw name, extracted value/unit/ref-range/flag, and the suggested canonical `marker_slug` (a dropdown the user can correct; unmapped → flagged). Panel-level fields editable too. Nothing is committed yet.
4. **Commit** — on confirm, write one `lab_panels` row + N `lab_values` rows (canonical + raw both stored), link `ingestion_log` + `raw_file_ref`. `source_slug='labs'` (seed it, like contour/oxylink).

## LLM extraction — guardrails (load-bearing)
- **Never auto-commit.** The review step is mandatory; the API output is a draft only.
- **Never invent values.** Prompt instructs: extract only what's present; if a field is unreadable/absent, leave it null and flag it — do not guess a number. Medical-data integrity over completeness.
- **Preserve raw + canonical.** Keep `raw_marker_name` and the original `unit`/ref-range verbatim; the canonical mapping is additive and user-confirmable.
- **Structured output** to a fixed JSON schema (panel + values array) so the review table is deterministic.
- **PHI note:** the PDF is sent to the Anthropic API. For this single-user personal project that's acceptable (API data isn't used for training by default), but it's a real PHI flow worth stating. Env: `ANTHROPIC_API_KEY` (new dependency — the platform doesn't currently call the API).

## Robustness across heterogeneous sources (load-bearing — the whole point)
The importer must handle ANY lab's report, not just Fakeeh's. Design rules:
- **Format-agnostic extraction.** The LLM prompt makes NO assumption about layout/columns/grouping — "extract every test result from this report whatever its structure." Multi-page PDFs handled (Claude reads them natively). The Fakeeh sample is a test case, not a template.
- **Learned marker aliases (the flexibility engine).** New table **`lab_marker_aliases`** (`raw_marker_name` text, optional `lab_name` scope, `marker_slug` text, `created_at`). Flow: LLM suggests a `marker_slug` for each raw name → on review/commit, the confirmed `raw_marker_name → marker_slug` mapping is **persisted**. Next upload, any known raw name **auto-maps** (no LLM guesswork needed, deterministic). So the system gets smarter per source: the first report from a new clinic needs the most review; repeats are near-automatic. Unmapped/low-confidence → `marker_slug` left blank + flagged in review for a one-time mapping.
- **Canonical marker registry (code-side):** the curated slug list + display name + canonical unit + key-marker flag — cardiac-first, extensible: `total_cholesterol`, `ldl`, `hdl`, `non_hdl`, `triglycerides`, `lipoprotein_a`, `apob`, `hs_crp`, `hba1c`, `fasting_glucose`, `creatinine`, `egfr`, `alt`, `ast`, `ggt`, `tsh`, `vitamin_d`, `hemoglobin`, `ferritin`, `potassium`, `sodium`, `bicarbonate`, `chloride`, `uric_acid`, … Markers outside the registry are still stored (raw name + value); they just don't get a canonical slug until added.
- **Units vary by lab** → store reported `unit` + `numeric_value` always; normalize to `canonical_unit`/`canonical_value` per-marker where a standard conversion exists (e.g. cholesterol mg/dL↔mmol/L ×0.0259, glucose ÷18, triglycerides ×0.0113). Unknown/unhandled units → store reported as-is, canonical left null + flagged. Don't guess conversions.
- **Reference ranges vary by lab** → store each value's ref range **AS REPORTED** (`ref_low`/`ref_high`/`ref_unit` per `lab_value` — the schema is already per-value, so different labs' ranges coexist correctly). Handle non-numeric ref forms (`< 5`, `> 60`, `Negative`, qualitative) — capture what's there; partial is fine.
- **Qualitative / text results** (e.g. "Negative", "Reactive", blood group, urine appearance) → `text_value` (numeric_value null). Don't force numbers.
- **Ambiguous dates** → the LLM infers day-first vs month-first from context where possible (29/04 must be day-first); genuinely ambiguous dates (03/04) are surfaced in review for the user to confirm. Never silently mis-date a draw.
- **`source_slug='labs'` stays generic; the specific provider goes in `lab_panels.lab_name`** (Fakeeh, Mediclinic, a specialty clinic…) — don't fragment into per-lab source slugs.
- **The review step is the universal safety net** — whatever format the LLM doesn't parse perfectly, the user catches and corrects before commit, and (via the alias table) that correction sticks.

## Marker canonicalization (`marker_slug`)
Per the registry + alias table above: alias hit → deterministic map; else LLM suggestion (editable in review); else blank + flagged. Confirmed mappings persist to `lab_marker_aliases`. Both reported (`unit`/`numeric_value`) and canonical (`canonical_unit`/`canonical_value`) stored.

## Schema usage (reserved — no migration to the tables)
- `lab_panels`: `drawn_at` (date), `lab_name`, `ordering_physician`, `notes`, `raw_file_ref` (Storage path), `ingestion_log_id`, `source_slug='labs'`.
- `lab_values`: `panel_id`, `marker_slug` (canonical), `raw_marker_name`, `numeric_value`/`text_value`, `unit`, `canonical_value`/`canonical_unit`, `ref_low`/`ref_high`/`ref_unit`, `flag` (H/L/HH/LL/N).
- DB changes (one small migration): seed a `labs` row in `sources` (FK-enforced) **+ create `lab_marker_aliases`** (`id`, `raw_marker_name`, `lab_name` nullable, `marker_slug`, `created_at`; unique on `(raw_marker_name, lab_name)`; RLS `authenticated_full_access` like the other data tables). This is the learned-mapping table — the only structural addition; `lab_panels`/`lab_values` are reused as reserved.

## Decision 2 — v1 surfacing: dedicated Labs section WITH key-marker trends ✅ CONFIRMED
v1 includes a **dedicated `/labs` section** with two parts:
- **Panels list:** every imported draw chronologically, each expandable to its markers (value · ref-range · flag, out-of-range highlighted).
- **Key-marker trends:** a curated set of cardiac-relevant markers surfaced as **trend charts across all draws over time** — each plots `canonical_value` by `drawn_at`, with the **reference-range band shaded** (`ref_low`–`ref_high`) and out-of-range points flagged, plus the latest value + flag. This is what the schema's `idx_lv_marker` (trend a marker across panels) is built for.
  - **Key markers (curated, cardiac-first, configurable):** `ldl`, `hdl`, `non_hdl`, `triglycerides`, `lipoprotein_a`, `apob`, `hs_crp`, `hba1c`, `fasting_glucose` — surfaced prominently. Plus a picker to trend ANY marker that has ≥2 draws (electrolytes, liver, thyroid, etc.).
  - **Charts:** custom-SVG `TrendChart` (NOT recharts — reuse the existing component), null-aware across draws (gotcha #34), ref-band shaded like the glucose target band, sparse-data friendly (labs are few points — handle 1–2 draws gracefully, mirroring the sparkline sparse-data fix #76).
- **Defer to follow-ons:** lab markers feeding the Baselines & Drift engine (LDL drift etc.), and the doctor-record export.

## New dependencies
- `ANTHROPIC_API_KEY` (server-side LLM structuring).
- A server-side **PDF text-extraction lib** (`pdf-parse` or `pdfjs-dist`) for the deterministic text-layer-first path.
- A Supabase Storage bucket for raw lab PDFs (`raw_file_ref`).
- Anthropic SDK (or a direct fetch to the Messages API — text content for the text path, a document/image content block for the vision fallback).

## Observed format — Fakeeh University Hospital (from the real report)
Grounds the extraction. The sample is the Electrolyte Panel; other reports add lipids/HbA1c/etc. in the same layout.
- **Table columns:** `Sample Type | Test Name | Result | Reference Range | Test Methodology`. Result cell holds the value + unit (`23.1 mmol/L`). Methodology often blank.
- **Panel sections:** markers grouped under headers (e.g. `ELECTROLYTE PANEL`) within one draw. The whole report = ONE `lab_panels` row; each marker = a `lab_values` row. The section name can go in `lab_values` (no schema field → put in `notes` or ignore for v1).
- **Flag:** a single letter sits between the result and the reference range when out of range — e.g. `SERUM SODIUM 133 mmol/L   L 136-145` (133 < 136 → `L`). Map to `lab_values.flag` (L/H/LL/HH/N). This stray-letter layout is exactly why the LLM is the right tool (regex on column position would be brittle).
- **Reference range:** `low-high` (e.g. `136-145`) → `ref_low`/`ref_high`; `ref_unit` = the result's unit (mmol/L).
- **Dates:** `DD/MM/YYYY HH:MM:SS` — **day-first** (29/04/2026 = 29 Apr 2026). NOTE: opposite of Contour's US MM/DD — the LLM must be told day-first for this lab. `Drawn` → `drawn_at` (date only).
- **Metadata:** `Doctor Name: Dr. Fekry Eldeeb` → `ordering_physician`; `Hospital Site: Fakeeh University Hospital` → `lab_name`; `MRNO` / `Bill No` → `notes` or ignore. Patient name/age/sex ignored (single user).
- **Marker vocab (this report):** bicarbonate, serum chloride, serum potassium (K), serum sodium → canonical `bicarbonate`/`chloride`/`potassium`/`sodium`. The "SERUM " prefix + " (K)" suffix are noise the canonical mapping strips. His cardiac panels (other reports) add `ldl`/`hdl`/`triglycerides`/`lipoprotein_a`/`hba1c`/etc. — vocab covers both.
- A `_context.md` for this report isn't needed (1 page, under the threshold); this section IS the grounding.

## Out of scope / deferred
- Per-marker trend charts + dashboard surfacing beyond the list (follow-on).
- Lab markers as drift metrics (e.g. LDL drift) — a later enhancement once trends exist.
- Doctor-record export (separate, builds on labs + meds).
- Multi-format/multi-lab robustness beyond what the LLM handles generically (the review step is the safety net regardless).

## Implementation steps
1. Migration: seed `labs` source row + create `lab_marker_aliases`; create the Supabase Storage bucket.
2. `/labs` upload page + raw-PDF store.
3. Server action: Anthropic API **format-agnostic** extraction → structured draft (guardrails above); apply `lab_marker_aliases` (deterministic) BEFORE falling back to the LLM's slug suggestion.
4. Review UI: editable draft table (marker rows + canonical-slug dropdowns + reported unit/ref/flag + panel fields); blank/flagged rows for unmapped markers, unknown units, ambiguous dates.
5. Commit action: write `lab_panels` + `lab_values` (+ ingestion_log, raw_file_ref) **+ persist any new/confirmed `raw_marker_name → marker_slug` into `lab_marker_aliases`** (the learning step).
6. Canonical marker registry (code-side: slugs + display + canonical unit + key-marker flag + conversions) — extensible, not Fakeeh-specific.
7. `/labs` section: panels list (panels → markers, out-of-range highlighted) **+ key-marker trend charts** (custom-SVG `TrendChart`, ref-band shaded, sparse-data-safe) + a marker picker for any ≥2-draw marker.
8. `npm run build` clean.
9. (MANUAL — Irfan) set `ANTHROPIC_API_KEY`; upload a real lab PDF; review + commit; confirm rows in `lab_panels`/`lab_values`.

## Acceptance criteria
- [ ] `/labs` upload accepts a PDF, stores the raw file, runs LLM extraction → a draft (never auto-committed)
- [ ] Review UI shows every extracted marker (raw name + value + unit + ref-range + flag + editable canonical slug); panel fields editable; nothing written until confirm
- [ ] Commit writes `lab_panels` + `lab_values` with raw + canonical preserved; `source_slug='labs'`; specific provider in `lab_name`; `raw_file_ref` set; `ingestion_log` row
- [ ] **Robust across sources:** extraction is format-agnostic (no Fakeeh hard-coding, multi-page OK); confirmed `raw_marker_name → marker_slug` mappings persist to `lab_marker_aliases` and auto-apply on later uploads; units stored as-reported + canonical-where-known (unknown flagged, not guessed); ref ranges stored per-value as reported; qualitative results → `text_value`; ambiguous dates surfaced in review
- [ ] **Hybrid extraction:** digital PDFs go text-layer-first (exact text → LLM structures/maps, values unaltered); scanned/no-text PDFs use the vision fallback; draft tagged `text`/`vision`
- [ ] LLM never invents values (absent → null + flagged); PHI flow + `ANTHROPIC_API_KEY` documented
- [ ] `/labs` section renders the panels list (markers + out-of-range highlighting) AND key-marker trend charts (canonical_value by drawn_at, ref-band shaded, flagged points, sparse-data-safe) + a picker to trend any ≥2-draw marker
- [ ] No new tables (reserved schema reused); `labs` source seeded; `npm run build` clean

---

*End of spec. Build-ready. Architecture: in-app LLM-extract + human-review (Decision 1 ✅); v1 = dedicated Labs section with panels list + key-marker trend charts (Decision 2 ✅). Grounded in the real Fakeeh report. Deferred: lab-marker drift + doctor-record export.*
