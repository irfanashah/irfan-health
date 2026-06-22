# Project State — Irfan's Health Platform

_Last updated: 2026-06-22 (session: Slice 4 — file-drop ingestion pipeline + Oxylink parser built end-to-end; awaiting Drive setup + deploy)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Dashboard layer + file-drop ingestion both feature-complete. Slice 4 just built locally end-to-end: Google Drive service-account client + parser-registry contract + Oxylink overnight-SpO2 parser (csv-parse + drift guard + sentinel/range filter) + `/api/cron/file-drop` route (twice-daily, two-layer idempotency) + `vercel.json` cron entries + `/diagnostics` file-drop history table. Parser smoke-tested against the real Oxylink CSV: 5,909/5,911 valid rows, spo2_avg=96.4%, min=87%, wake_date=2026-06-22. `npm run build` clean. **No new migration** — reuses `health_observations` + `ingestion_log` + the existing `oxylink_csv` source seed.

## Slice ledger
- ✅ Slice 0 — Scaffold · ✅ 1 Whoop · ✅ 1.5/1.6 backfill+refill · ✅ 2 Withings BP
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ✅ **Slice 4 — File-drop ingestion pipeline + Oxylink parser** (built locally 2026-06-22, NOT pushed; awaiting Drive setup + deploy)
- ✅ Slice 5 — Nightscout CGM adapter · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ Slice 7.1 — Trend dashboard (baseline)
- ✅ Slice 7.2 — Connections (Correlation Explorer + Cardiac Readiness + cross-source views)
- ✅ Slice 7.3 — Personal Baseline & Drift Engine
- → **Slice 4 verification + SpO2 dashboard surfacing (separate small spec)** — NEXT
- ⬜ Withings weight extension; anchor population (post-rehab); confirm Dr. Jose low floors; Slice 6 — Labs PDF (rides file-drop pipeline); Contour parser (when sample available); med-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer

## Data state
- **Whoop:** complete, Diagnose gap = 0; 6-hourly cron clean.
- **Withings:** `bp_readings` complete, Diagnose gap = 0; 12-hourly cron clean. (BP only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows, Diagnose gap = 0 (last 30 d); 12-hourly cron live. xDrip+ pipeline armed; new G7 sensor pending.
- **Oxylink SpO2:** parser built + smoke-tested locally. Will land 2 rows per overnight session into `health_observations` once Irfan does the Drive setup + first cron tick lands a real file.
- **`daily_metrics` + `metric_drift` views:** applied 2026-06-19/22 with RLS. Spot-checks green.

## Next action
1. **Slice 4 end-to-end verification** — follow the runbook (`file-drop-google-drive-setup-guide_2026-06-22.md`, one-time ~20 min): create GCP project + service account, share the Drive folder, set `GDRIVE_SA_KEY` (base64 of JSON key) + `GDRIVE_ROOT_FOLDER_ID` on Vercel. Push Slice 4 to `main`. Drop the real Oxylink CSV into `inbox/oxylink/`. Wait for (or trigger) a cron tick. Confirm 2 `spo2_overnight_*` rows landed, file moved to `processed/oxylink/`, and the run shows on `/diagnostics`. **Idempotency check:** re-drop the same file → 0 new rows (the upsert dedupes via `(source_slug, source_record_id)`).
2. After verification, decide between drafting the **SpO2 dashboard surfacing spec** (small) and the **Withings-weight extension** (also small).
3. Slice 6 (Labs PDF) draft when ready.

## Open items (non-blocking)
- **Slice 4 push + Drive setup + deploy + smoke** — see Next action.
- **SpO2 dashboard surfacing** — deliberately deferred from Slice 4. Spec to write.
- **Withings weight extension** — small follow-on.
- **Slice 7.3 confirm-Dr-Jose low floors** — provisional numbers in `LOW_FLOORS` with visible provisional note; replace once Dr. Jose lands on the right numbers.
- **Anchor population** — `/baselines` set-anchor form is built; populate post-rehab.
- **Contour fingerstick parser** — folder + dispatch ready; parser ships when sample available.
- **xDrip+ ongoing CGM capture** — new G7 sensor pending, then confirm one live reading lands.
- **`daily_metrics` + `metric_drift` views both scan full history per query** — trivial at current ~3k CGM rows; future perf item once CGM accrues months.
- No cron failure alerting — small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
