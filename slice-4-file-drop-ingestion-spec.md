# Slice 4 — File-Drop Ingestion Pipeline (Oxylink first parser) — Build Spec

**Version:** 1.0
**Date:** 2026-06-22
**Status:** Reclaims and supersedes the parked `slice-4-oxylink-ingestion-options_2026-06-17.md` (Oxylink-only). This generalises it into the file-drop pipeline that pipeline-deferred sources (Oxylink now; Contour, Labs later) all ride.
**Prerequisites:** Slices 0–3, 5, 7.x live. **Google service-account + Drive setup** (companion `file-drop-google-drive-setup-guide_2026-06-22.md`) done before deploy. **No new migration.**

---

## Overview

A generic **scheduled file-drop ingestion pipeline**: you drop a daily extract into a per-source folder in Google Drive; a Vercel cron pulls it twice a day, routes it to the matching parser, validates the content, ingests into `health_observations`, and moves the file to `processed/` (or `failed/`). Built source-agnostic so new extracts ride it with just a new subfolder + a registered parser. **Oxylink SpO2 is the first parser**; Contour fingerstick and Labs PDF slot in later (Labs = Slice 6).

No new schema — writes existing `health_observations`, logs one `ingestion_log` row per file. The only DB touch is ensuring the `oxylink_csv` **source row is seeded** (one-line insert if migration_001 didn't seed it).

## Architecture & data flow (locked decisions)

- **Drop surface — Google Drive + service-account pull (Decision 1).** A shared Drive folder; the Vercel cron authenticates as a Google **service account** (Drive API) to list/download/move files. Google Drive Desktop on the Mac gives a *local folder* that syncs, so the drop UX is "drag into a folder." PHI stays in your own Workspace; the folder is private + shared only to the service account.
- **Folder lifecycle (Decision 2):** under the shared root —
  - `inbox/oxylink/`, `inbox/contour/`, `inbox/labs/` — you drop here (contour/labs reserved; parsers deferred).
  - `processed/<source>/` — moved here on a clean ingest (audit trail; never deleted).
  - `failed/<source>/` — moved here on any parse/validation error.
  The **inbox is the queue** — its contents are by definition unprocessed; the cron moves each file out after handling it. No "which files are new?" tracking.
- **Schedule:** Vercel cron **10:00 & 21:00 GST** (`0 6 * * *` and `0 17 * * *` in UTC) → `/api/cron/file-drop`, `CRON_SECRET` bearer. Add both to `vercel.json`.
- **Routing — per-source subfolder + per-parser content validation (Decision 3):** the subfolder declares the type (no filename/extension guessing — Oxylink & Contour are both CSV). Each parser still **validates the content header before ingesting**; a misfiled file (e.g. a Contour CSV dropped in `oxylink/`) **fails loudly to `failed/`** with a reason rather than mis-ingesting.
- **Idempotency — two layers:** (1) move-after-process means a handled file never re-reads from `inbox/`; (2) row ingestion upserts on `(source_slug, source_record_id)`, so re-dropping the same file/session inserts no duplicates.
- **Missing file = non-event:** empty inbox → no-op, `ingestion_log` `status='success'`, `records_found=0`. Never an error.
- **Failed file = loud:** moved to `failed/<source>/`, `ingestion_log` `status='error'` + reason, surfaced on `/diagnostics` (a "files that didn't ingest, and why" view) so nothing vanishes silently.

## Google Drive integration

- **Auth:** service-account JSON key in Vercel env (`GDRIVE_SA_KEY` as a base64/JSON string), root folder id in `GDRIVE_ROOT_FOLDER_ID`. `CRON_SECRET` reused.
- **Drive API ops:** `files.list` (q = parent folder, not trashed) per source subfolder; `files.get` (alt=media) to download; **"move" = `files.update` swapping `addParents`/`removeParents`** (Drive has no true move).
- Resolve the subfolder ids once (by name under the root) or store them in env/config.
- `maxDuration = 800` on the cron route (downloads + parse + batch upsert).

## Parser contract

A registered parser per source, dispatched by subfolder:
```
{ sourceSlug, sourceFolder, validate(text|bytes) -> boolean, parse(text|bytes, fileMeta) -> ObservationRow[] }
```
The cron: for each known source subfolder → list inbox files → for each file: download → `validate()` (header/structure signature) → if invalid, move to `failed/` + log; else `parse()` → batch-upsert rows (200 at a time, gotcha #11) → write the `ingestion_log` row → move to `processed/`. Registry makes adding Contour/Labs a one-entry change.

## Oxylink parser (v1) — grounded in the real export

**File format (observed):** header `Time,SpO2(%),Pulse Rate(bpm),Motion,SpO2 Reminder,PR Reminder,` (trailing empty column). Rows like `"10:38:13PM Jun 21, 2026",95,65,0,0,0,` at ~4-second cadence; one overnight session per file (~5,900 rows). **Timestamp quirk: no space before AM/PM** (`10:38:13PM`) — parse explicitly (`hh:mm:ss` + `AM/PM` + ` Mon DD, YYYY`), treat as **GST local**.

- **`validate()`**: first line matches the Oxylink header signature (`Time,SpO2(%),Pulse Rate(bpm),Motion…`). Anything else → `failed/`.
- **Filter (drop before computing):** sentinel `SpO2 == 255` and `Pulse == 65535` (sensor-off), and out-of-range `SpO2 ∉ [70,100]` / `Pulse ∉ [30,220]`. The skip count goes into `ingestion_log.records_skipped`.
- **Compute over valid rows:**
  - `spo2_overnight_avg` = mean SpO2 (1 dp).
  - `spo2_overnight_min` = min SpO2.
  - `extras` = `{ session_duration_min: (last_ts − first_ts) in minutes, movement_events: count(rows with Motion > 0), pulse_avg_bpm: mean valid pulse }`.
- **Rows written (2 per session):** `source_slug='oxylink_csv'`, `data_shape='daily_summary'`, `metric_type ∈ {spo2_overnight_avg, spo2_overnight_min}`, `period_start = first valid ts`, `period_end = last valid ts`, `numeric_value`+`canonical_value` = the value, `unit`+`canonical_unit = '%'`, `extras` on both. `recorded_at` null (period pair satisfies `chk_obs_time_coverage`).
- **`source_record_id` = `oxylink_<wakeDate>_<metric_type>`** where `wakeDate` = `period_end` GST date (**wake-day attribution**, Decision 4 — matches Whoop sleep). Stable + idempotent per session+metric, so re-dropping the same night dedupes.
- **One session per file** assumed (Oxylink exports per session). If a file ever holds multiple sessions (large internal time gap), v1 treats it as one — flag as a future refinement if it shows up.

## Decisions (resolved — the five)

1. **Drop surface:** Google Drive folder + service-account pull (Drive Desktop = local-folder UX).
2. **Lifecycle + schedule:** `inbox`/`processed`/`failed` per-source, move-after-process, two-layer idempotency, missing=no-op, failed=loud; cron 10:00 + 21:00 GST.
3. **Routing:** per-source subfolders + per-parser content validation; misfile → `failed/`.
4. **v1 = pipeline + Oxylink parser; wake-day attribution; ingestion-only (no panel).** Contour deferred (needs a sample); Labs → Slice 6.
5. **Slice 4 reclaimed**, `slice-4-file-drop-ingestion-spec.md`, **no migration** (seed `oxylink_csv` source row if missing); reuses `health_observations` + `ingestion_log`. Sequences before Slice 6 (Labs rides this pipeline).

## Out of scope / deferred

- **Contour Next One parser** — folder + dispatch ready; parser builds when a sample export is provided.
- **Labs PDF parser** — Slice 6 (LLM-vs-OCR extraction still open); rides `inbox/labs/`.
- **SpO2 dashboard surfacing** — **PENDING / to spec separately.** v1 ingests SpO2 into `health_observations` (queryable, `/diagnostics`-verifiable) but adds no dashboard card and does not extend `daily_metrics`. A follow-on spec covers the SpO2 panel + (optionally) adding SpO2 to `daily_metrics` so the drift engine could watch it.
- Non-Drive drop surfaces; real-time push; per-reading SpO2 time-series storage (v1 stores the overnight summary only).

## Implementation steps

1. Seed the `oxylink_csv` source row if absent (check migration_001's seed).
2. Google Drive client module (service-account auth; list/download/move helpers).
3. Parser registry + the dispatcher; the Oxylink parser (validate + parse + sentinel filter + summary compute).
4. `/api/cron/file-drop` route (`CRON_SECRET`; iterate source subfolders; per-file validate→parse→upsert→log→move; `maxDuration=800`). Add both cron times to `vercel.json`.
5. `/diagnostics` extension: a "file-drop" panel listing recent `ingestion_log` rows for file sources (processed/failed + reasons).
6. `npm run build` clean.
7. (MANUAL — Irfan) Do the Google setup (runbook); set `GDRIVE_SA_KEY` + `GDRIVE_ROOT_FOLDER_ID` on Vercel; deploy; drop the Oxylink CSV in `inbox/oxylink/`; confirm two `spo2_overnight_*` rows land and the file moves to `processed/oxylink/`.

## Acceptance criteria

- [ ] Cron (10:00 & 21:00 GST) authenticates to Drive via the service account, walks each source subfolder, processes inbox files
- [ ] Oxylink CSV → exactly 2 rows (`spo2_overnight_avg` + `spo2_overnight_min`), `source_slug='oxylink_csv'`, `daily_summary`, period span correct, `%` canonical; sentinels (255 / 65535) + out-of-range filtered (skip count logged)
- [ ] Wake-day attribution via `period_end` GST date; `source_record_id` stable so re-dropping the same session dedupes (0 new rows)
- [ ] Per-source subfolder routing; a file failing content-validation moves to `failed/` with a logged reason (no mis-ingest)
- [ ] Clean file → moved to `processed/`; empty inbox → no-op `success` (`records_found=0`); one `ingestion_log` row per file
- [ ] Failed/processed visible on `/diagnostics`
- [ ] No new migration; `oxylink_csv` source seeded; `npm run build` clean
- [ ] Secrets (`GDRIVE_SA_KEY`) only in Vercel env; the Drive folder is private + shared only to the service account

---

*End of Slice 4 spec. Companion: `file-drop-google-drive-setup-guide_2026-06-22.md`. No code this pass — awaiting build approval.*
