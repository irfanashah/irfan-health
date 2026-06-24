# Contour Fingerstick Parser — Build Spec

**Version:** 1.0
**Date:** 2026-06-24
**Status:** Adds the **Contour Next One** glucose-meter CSV parser to the existing file-drop pipeline (Slice 4). The pipeline's cron, Drive pull, validate→parse→ingest→move flow, and `/diagnostics` panel are already generic — this is a one-parser add plus a source seed. Grounded in the real export `Patient's_BG_data_Irfan_Shah_6_24_2026.csv` (57 readings, 05/04→06/24 2026).
**Scope:** Parser + registry entry + `contour` source seed (Part 1) **+ fingerstick markers on the Glucose panel's CGM trace** (Part 2). **No new migration table** — reuses `health_observations` + `metric_type='glucose_fingerstick'` (the same type Slice 3 manual entry writes).

---

## The real export format (observed)
- **UTF-8 BOM** precedes the header — must be stripped (`csv-parse` `bom: true`).
- **Header (10 cols):** `#,Date and Time,BGValue [mg/dL],Meal Marker,Data Source,Notes,Activity,Meal  [g],Medication,Location` (note the double space in "Meal  [g]").
- **Row:** `1,05/04/2026 7:18 AM,108,Fasting,Meter,,,,,`
  - `#` — sequential row index (1,2,3…). **Not stable across exports** — do NOT use for the id.
  - `Date and Time` — **`MM/DD/YYYY h:mm AM/PM`** (US format, no leading zero on the hour). Treat as **GST local** → UTC instant.
  - `BGValue [mg/dL]` — integer mg/dL. (Contour can emit `HI` (>600) / `LO` (<20) as strings — none in this file, but handle.)
  - `Meal Marker` — enum seen: `No mark`, `Fasting`, `Before Meal`, `After Meal` (Contour also has `Bedtime`, `Control Solution` — tolerate unknowns).
  - `Data Source` — `Meter` here (could be `Manual`).
  - `Notes`, `Activity`, `Meal  [g]`, `Medication`, `Location` — all empty in this export; capture `Notes` if present, ignore the rest for v1.

## What the parser writes
Mirror the **Slice 3 manual `glucose_fingerstick` row shape exactly** so Contour + manual fingerstick are indistinguishable downstream (`app/log/actions.ts::createGlucose` is the reference):
- `source_slug='contour'`, `metric_type='glucose_fingerstick'`, `data_shape='discrete'`
- `recorded_at` = parsed timestamp (UTC instant of the GST-local reading); no period.
- `numeric_value` = mg/dL, `unit='mg/dL'`; `canonical_value` = mmol/L via **`mgdlToMmol`** (the shared `app/log/_lib/glucose` helper — gotcha #28; Nightscout already reuses it), `canonical_unit='mmol/L'`, 1 dp.
- `extras = { meal_marker, data_source, notes }` (omit empty keys). The `meal_marker` is the valuable bit — `Fasting` readings can later cross-check the CGM fasting metric; `After Meal` are post-prandial.
- `source_record_id = 'contour_' + <epoch_ms> + '_' + <bg_mgdl>` — timestamp is minute-resolution, so append the value to guard the rare same-minute duplicate; stable → re-dropping the same (or an overlapping) export dedupes via `(source_slug, source_record_id)`.

**`validate()`:** BOM-tolerant, case-insensitive prefix-match on the header signature `#,Date and Time,BGValue [mg/dL],Meal Marker`. Anything else → `failed/`.

**Filters (count into `skip_breakdown`, same pattern as Oxylink):**
- Non-numeric `BGValue` (`HI`/`LO`/blank) → skip (don't store boundary values that pollute trends); count separately.
- Plausibility: reuse the Slice 3 glucose bounds (`GLUCOSE_MMOL_MIN`/`MAX`, ≈36–540 mg/dL) on the converted mmol value — out of range → skip + count.
- Keep the same drift guard the Oxylink parser uses (`parse_errors > rows_valid` → fail the file; 0 valid → fail) so a format change or garbled export fails loudly rather than writing a misleading partial.

## Pipeline integration (mostly already wired)
- **Seed the `contour` source:** add `('contour', 'Contour (fingerstick)', '0.1.0')` to `sources` (migration_001 seeded oxylink_csv but not contour — add a one-line insert; a tiny migration or SQL-editor `INSERT … ON CONFLICT DO NOTHING`).
- **Register the parser:** add to `FILE_DROP_PARSERS` with `sourceSlug='contour'`, `sourceFolder='contour'`. The cron dispatches it automatically; `/diagnostics` shows it automatically.
- **Drive folder:** Irfan creates `inbox/contour/` and drops the CSV there (the runbook reserved this folder; `processed/`/`failed/` auto-create).
- No refill route (same as Oxylink, gotcha #49) — the filter logic lives in the parser as the single source of truth.

## Part 2 — Surfacing: fingerstick markers on the CGM trace
Overlay fingerstick readings on the **Glucose panel's** 24h CGM curve as **value-anchored** dots — each meter reading plotted at its *own* glucose value, so you can see it sit above / below / on the CGM line (meter-vs-sensor agreement at the moment it was taken). Surfaces **all** `glucose_fingerstick` rows (both `source_slug='contour'` and `'manual'`) — so manual fingersticks start showing too, for free.

### 2a. Extend `CGMChart` markers (backwards-compatible)
The existing `CgmMarker` is time-anchored and snaps its dot to the **CGM curve's** value (`yOf(data[di].value)`) — fine for symptom/note pins, wrong for a meter comparison. Extend it:
- `kind` union → add `'fingerstick'`; add an optional `value?: number` (mmol) to `CgmMarker`.
- For `kind === 'fingerstick'`: render the dot at **`yOf(value)`** (its own reading), NOT snapped to the CGM curve — a distinct glyph (e.g. a small diamond / hollow drop) in a colour distinct from the purple CGM line and the amber/grey symptom/note pins (exact glyph/colour a low-stakes sub-choice). No top-of-chart pin needed for fingerstick (or a faint one). Hover tooltip shows: meter value + meal marker + the CGM value at that time (so both numbers are comparable side by side).
- Symptom/note marker behaviour unchanged. The `value`-anchored branch is additive.

### 2b. Data + wiring
- New reader `fetchFingersticks(hours = 24)` (or window-scoped): `health_observations WHERE metric_type='glucose_fingerstick' AND recorded_at >= now()-24h`, returning `{ time, mmol (canonical_value), mealMarker (extras.meal_marker, null for manual), source }`. (Mirrors how `fetchCgm24h` is a small dedicated reader; respects the 1000-row cap trivially — fingersticks are sparse.)
- `GlucosePanel`: map those to `CgmMarker[]` with `kind:'fingerstick'`, `value: mmol`, `label:'Fingerstick'`, `detail:` meal marker + source; pass to `CGMChart`'s `markers` prop alongside the existing data. Empty-safe (no fingersticks in window → no markers, no change).
- Window note: the Glucose panel's CGM chart is fixed 24h, so you'll see only the last 24h of fingersticks (Contour is ~1–2/day) — exactly "today's meter readings vs the sensor." Fine for v1; a range-wide meter-vs-sensor view would be a separate enhancement.

### Still deferred (flagged, not in this slice)
**Fasting-glucose cross-check** — the `Fasting`-marked readings vs the CGM-derived `fasting` metric in `daily_metrics` (a second fasting source, potentially its own drift metric). More involved (touches the view + maybe drift-config). Spec separately if wanted.

## Expected after build
Drop the CSV in `inbox/contour/` → ~57 `glucose_fingerstick` rows land (`source_slug='contour'`), all 90–141 mg/dL so none filtered; `/diagnostics` shows the file processed; the readings appear wherever manual fingerstick already shows (e.g. recent-activity timeline). Re-dropping the same or a later overlapping export dedupes.

## Implementation steps
1. Seed the `contour` source row.
2. `adapters/file-drop/contour/parser.ts`: `validate()` (BOM + header) + `parseContourTimestamp()` (`MM/DD/YYYY h:mm AM/PM`, GST→UTC) + `parse()` (csv-parse `bom:true`, per-row convert + filter + build `glucose_fingerstick` rows mirroring Slice 3, reusing `mgdlToMmol`/`roundTo1dp` + the Slice 3 glucose bounds).
3. Register in `FILE_DROP_PARSERS`.
4. **Part 2:** extend `CgmMarker` (`'fingerstick'` kind + `value`) + the value-anchored render branch in `CGMChart`; add `fetchFingersticks()`; wire markers into `GlucosePanel`.
5. `npm run build` clean.
6. (MANUAL — Irfan) Create `inbox/contour/` in Drive; drop the CSV; confirm ~57 rows + `/diagnostics` row + fingerstick dots on the Glucose panel's CGM trace where the windows overlap.

## Acceptance criteria
- [ ] `contour` source seeded; parser registered; cron dispatches it; `/diagnostics` shows Contour files
- [ ] BOM stripped; header validated; `MM/DD/YYYY h:mm AM/PM` parsed as GST→UTC; mg/dL→mmol/L via the shared helper
- [ ] Rows written as `glucose_fingerstick` / `discrete` / `source_slug='contour'`, **identical shape to Slice 3 manual fingerstick**, with `meal_marker` in extras; `source_record_id` timestamp+value keyed, idempotent on re-drop
- [ ] Non-numeric (HI/LO) + out-of-plausibility skipped + counted; drift guard + 0-valid-fail intact (Oxylink pattern)
- [ ] **Part 2:** fingerstick readings (contour + manual) render as value-anchored dots on the Glucose panel's CGM trace, at their own glucose value (not snapped to the curve), distinct glyph, hover shows meter value + meal marker + CGM value at that time; symptom/note markers unchanged; empty-safe
- [ ] No new migration table; `npm run build` clean

---

*End of spec. Grounded in the real Contour export. Includes Part 2 (CGM-trace fingerstick markers). Fasting cross-check deferred as a separate follow-on.*
