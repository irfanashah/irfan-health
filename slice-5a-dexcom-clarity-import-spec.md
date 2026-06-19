# Slice 5a — Dexcom Clarity CSV Import (CGM history)

> **STATUS: DEFERRED — not being built as a dedicated slice (decided 2026-06-18).**
> The diabetes layer is being built as the device-agnostic Nightscout adapter (Slice 5) only. Historical Dexcom data (the ~11-day export saved in the repo) will be ingested later via a **generic front-end file-import** capability when that's built — at which point this Dexcom-Clarity parser logic is the reference. Kept for that purpose; do not build as a standalone slice. The valuable, reusable part below is the exact Clarity CSV format + EGV→`glucose_cgm` mapping.

**Version:** 1.0
**Date:** 2026-06-18
**Prerequisites:** Slices 0–3 complete (scaffold, auth, UI foundations, manual entry). Reuses the Slice 3 glucose conversion helper.

---

## Overview

First **file-upload + parse** path in the platform. Imports Dexcom CGM history from a **Dexcom Clarity CSV export** into `health_observations` as `glucose_cgm` (`time_series`) rows. This is the **historical** half of the CGM layer; the **ongoing** half (xDrip+ → Nightscout → API pull) is a separate later slice (**5b**), and the two were deliberately split because the Clarity import is buildable and testable today while Nightscout needs setup + a live sensor.

Context for why this path exists (don't re-litigate): Dexcom's cloud APIs are geo-gated and unavailable for the UAE account (Tidepool linking and the US Clarity app both rejected it; the EU portal `clarity.dexcom.eu` works). Tidepool's API is closed to new client IDs. So a manual Clarity CSV export → upload is the clean, dependency-free way to get historical CGM data in. It's also device-agnostic — any CGM that lands in Clarity exports the same schema.

**No new migration.** `glucose_cgm` already exists in the `metric_type` vocabulary (canonical mmol/L). Add `dexcom_clarity` as a new `source_slug` — application-level controlled vocabulary, no schema change.

## Scope decisions (confirmed with Irfan)

- **EGV rows only.** Ignore every other Event Type in the export — `Calibration`, `Alert`, `Meal`, `Activity`, `Blood Glucose` (manual fingerstick), `Device`, `Sensor`, and the patient-info metadata rows (`FirstName`/`LastName`/`DateOfBirth`). Only `Event Type == "EGV"` is ingested.
- **Historical only.** This slice does not do ongoing capture; that's 5b (Nightscout).
- Fingerstick stays on the Slice 3 manual `/log` (the lone Clarity `Blood Glucose` row is intentionally not imported).

## Test fixture

A real export is in the repo at `./Dexcom /Clarity_Export_Shah_Irfan_2026-06-18_092557.csv` (note: the folder name is literally `Dexcom ` with a trailing space — rename to `dexcom/` or reference exactly). It is one sensor session, **2026-05-28 → 2026-06-08**, 3,053 total lines, **3,018 EGV rows**. Irfan confirmed this is his complete Dexcom history (single CGM to date). Seven identical copies were exported; only one is needed.

**Privacy:** these CSVs contain PHI (name, DOB, glucose). Add the export folder to `.gitignore` — do **not** commit raw exports. If a committed test fixture is wanted, strip the patient-info metadata rows first.

---

## CSV format (observed, exact)

Header (note UTF-8 BOM at start of file):
```
"Index","Timestamp (YYYY-MM-DDThh:mm:ss)","Event Type","Event Subtype","Patient Info","Device Info","Source Device ID","Glucose Value (mg/dL)","Insulin Value (u)","Carb Value (grams)","Duration (hh:mm:ss)","Glucose Rate of Change (mg/dL/min)","Transmitter Time (Long Integer)","Transmitter ID"
```

Example EGV row:
```
"15","2026-05-28T18:32:13","EGV","","","","android G7","115","","","","","1692","547136261189"
```

Notes that matter for parsing:
- **BOM**: the file starts with a UTF-8 BOM (`﻿`). Strip it before parsing the header.
- All fields are double-quoted. Use a real CSV parser, not a naive split.
- **Timestamp has no timezone** — it is device-local. Irfan is GST (UTC+4). Attach `+04:00` when constructing the `timestamptz`.
- **Glucose Value is mg/dL.** Convert to canonical mmol/L.
- `Transmitter ID` + `Transmitter Time (Long Integer)` together form a stable per-reading key (survives re-export; `Index` does not — it's per-file).
- `Glucose Rate of Change`, `Source Device ID` are useful context for `extras`.
- Some EGV rows may have non-numeric glucose (e.g. "Low"/"High" out-of-range markers) — guard for that.

---

## Mapping: EGV row → `health_observations`

| Column | Source | Notes |
|---|---|---|
| `source_slug` | constant `'dexcom_clarity'` | new slug, documented in controlled vocab |
| `source_record_id` | `dexcom_clarity_{TransmitterID}_{TransmitterTime}` | e.g. `dexcom_clarity_547136261189_1692`; stable dedup key |
| `data_shape` | constant `'time_series'` | |
| `metric_type` | constant `'glucose_cgm'` | |
| `recorded_at` | `Timestamp` parsed as local + `+04:00` (GST) | timestamptz |
| `numeric_value` | `Glucose Value (mg/dL)` as number | reported value |
| `unit` | constant `'mg/dL'` | as reported |
| `canonical_value` | `mg/dL ÷ 18.0`, 1 dp | reuse Slice 3 `app/log/_lib/glucose.ts` |
| `canonical_unit` | constant `'mmol/L'` | |
| `extras` | `{ transmitter_id, transmitter_time, rate_of_change_mgdl_min, source_device_id }` | forensics/context |
| `ingestion_log_id` | from the import's `ingestion_log` row | |

`period_start`/`period_end` stay null (this is `time_series`, uses `recorded_at` — satisfies `chk_obs_time_coverage`).

**Skip a row if:** Event Type ≠ `EGV`, or Glucose Value is blank/non-numeric, or glucose is outside a plausibility guard (suggest 10–600 mg/dL; below/above are Dexcom's out-of-range sentinels, not real values).

---

## Ingestion mechanics

- **Dedup:** `UNIQUE (source_slug, source_record_id)` already on the table. Batch-**upsert** so re-uploading the same (or overlapping) export inserts zero duplicates. Coerce `numeric` with `Number()` on any compare (gotcha #8).
- **Batch insert 200 rows at a time**, filtering invalid rows before each batch (gotcha #11) — one bad row must not fail the batch.
- **One `ingestion_log` row per upload:** `source_slug='dexcom_clarity'`, `status='success'` (or `'partial'` if some rows skipped), `records_found` = EGV rows parsed, `records_written` = inserted, `records_skipped` = duplicates + invalid. `raw_payload` = the raw CSV text (data-model §1 — kept for reprocessing safety). No fetch window (nullable).
- **`maxDuration = 800`** on the route; ~3k rows is fast but a wider future export should fit comfortably.

## UI

New session-protected route **`/import`** (mirror the dashboard/`/log` auth guard). A file picker (accept `.csv`), an import-type label ("Dexcom Clarity — CGM"), a submit that posts the file to a server action / route handler, and a result panel showing found / written / skipped + the date range covered. Semantic tokens only (gotcha #1). Add a dashboard link to `/import`.

Structure the parse + insert so the upload route is **reusable** for future file imports (Oxylink CSV — parked Slice 4; Lab PDF — Slice 6). Keep the Dexcom-Clarity parser as its own module the route dispatches to; don't hard-wire Clarity-specific logic into the route.

---

## Forward note (5b / Slice 7) — do not solve here

When 5b (Nightscout) lands, both `dexcom_clarity` and `nightscout` will write `glucose_cgm`. They won't overlap now (this export ends 2026-06-08; Nightscout starts at the next sensor stint). But trend queries must not double-count if they ever overlap — reconcile at query/visualization time on `recorded_at` rounded to the 5-min epoch, preferring one source. Flagged for Slice 7; out of scope for 5a.

---

## Implementation steps

1. Add `dexcom_clarity` to the documented `source_slug` controlled vocabulary (and the `sources` seed if sources are row-enforced — check `migration_001`).
2. `/import` route + auth guard.
3. Dexcom Clarity parser module: BOM strip → CSV parse → filter EGV → map rows (reuse `glucose.ts` for the mmol/L conversion).
4. Server action / route handler: parse, validate, write the `ingestion_log` row, batch-upsert, return summary.
5. `/import` UI + result panel + dashboard link.
6. `.gitignore` the export folder; `npm run build` clean.
7. (MANUAL — Irfan) Smoke test on Vercel with the real export.

## Verification checklist

- [ ] Uploading the fixture imports **3,018** `glucose_cgm` rows for `source_slug='dexcom_clarity'`
- [ ] Canonical conversion correct (e.g. 115 mg/dL → **6.4 mmol/L**)
- [ ] `recorded_at` carries the GST offset (e.g. `2026-05-28T18:32:13+04:00`)
- [ ] All non-EGV event types ignored (no fingerstick/meal/alert rows land)
- [ ] Re-uploading the same file inserts **0** new rows (dedup via Transmitter ID + Transmitter Time)
- [ ] Exactly one `ingestion_log` row per upload with correct found/written/skipped
- [ ] Out-of-range/blank glucose rows skipped, not crashed on
- [ ] Export folder is gitignored; no PHI committed
- [ ] `npm run build` clean

## Out of scope

- Ongoing CGM capture (Nightscout) — Slice 5b
- Non-EGV events (calibration, alerts, meals, activity, fingerstick) — intentionally ignored
- Charts/trends — Slice 7
- A generic multi-format import framework — build the reusable seam, but only the Clarity parser now

---

*End of Slice 5a spec. Next: 5b — Nightscout ongoing CGM adapter (after Nightscout + xDrip+ setup and a live sensor stint).*
