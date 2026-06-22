# Project State — Irfan's Health Platform

_Last updated: 2026-06-22 (session: SpO2 dashboard surfacing follow-on — display card + drift metrics 9+10)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Dashboard layer + file-drop ingestion + SpO2 surfacing all feature-complete. SpO2 just built locally: `migration_003` + `migration_004` view edits (CREATE OR REPLACE, no new tables), `daily_metrics` exposes `spo2_avg`/`spo2_min`, `metric_drift` watches them as the 9th + 10th metrics, RecoverySleepPanel renders a card (avg + min trend, band-shaded ≥95, last-night readout). `LOW_FLOORS` widened to keyed-by-`DriftMetricId` so SpO2 floors resolve without per-call casts. `npm run build` clean.

## Slice ledger
- ✅ Slice 0 — Scaffold · ✅ 1 Whoop · ✅ 1.5/1.6 backfill+refill · ✅ 2 Withings BP
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ✅ **Slice 4 — File-drop ingestion pipeline + Oxylink parser** (verified end-to-end 2026-06-22: 5 nights / 10 rows)
- ✅ Slice 5 — Nightscout CGM adapter · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ Slice 7.1 — Trend dashboard (baseline)
- ✅ Slice 7.2 — Connections (Correlation Explorer + Cardiac Readiness + cross-source views)
- ✅ Slice 7.3 — Personal Baseline & Drift Engine
- ✅ **SpO2 dashboard surfacing** (Slice 4 follow-on) — built locally 2026-06-22; NOT yet pushed
- → **Re-run migrations 003 + 004 in Supabase + push + deploy** — NEXT
- ⬜ Withings weight extension; anchor population (post-rehab); confirm Dr. Jose low floors; Contour parser (when sample available); Slice 6 — Labs PDF (rides file-drop pipeline); med-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer

## Data state
- **Whoop:** complete, Diagnose gap = 0; 6-hourly cron clean.
- **Withings:** `bp_readings` complete, Diagnose gap = 0; 12-hourly cron clean. (BP only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows, Diagnose gap = 0 (last 30 d); 12-hourly cron live.
- **Oxylink (overnight SpO2):** 10 rows in `health_observations` (5 nights, wake dates 2026-06-18 → 06-22). File-drop pipeline live (10:00 + 21:00 GST). Local SpO2 card + drift integration built; deploys with this push.
- **`daily_metrics` view:** post-SpO2 it exposes `spo2_avg`/`spo2_min` (after Irfan re-runs migration 003).
- **`metric_drift` view:** post-SpO2 it watches 10 metrics (after Irfan re-runs migration 004).

## Next action
1. **Re-run migrations 003 + 004** in Supabase (both `CREATE OR REPLACE`, idempotent — safe to re-run).
2. **Push** the SpO2 surfacing commits (`2f098df`, `4648adc`, + the closeout commit landing now). Three commits.
3. **Deploy + eyeball**: Recovery & Sleep card should show 5 nights of SpO2 (avg ~96% / min high-80s/low-90s); Baselines & Drift panel should add two new `spo2_avg`/`spo2_min` rows sitting `establishing` (not enough data-days for a verdict yet — needs ~7 nights of held data, which will accumulate as the file-drop cron keeps pulling new Oxylink drops).
4. Once verified, the next slot is the **Withings weight extension** (small follow-on — unblocks the Weight panel + Correlation Explorer's Weight metric + Slice 7.3 weight-drift).

## Open items (non-blocking)
- **Anchor population** — `/baselines` set-anchor form is built; populate post-rehab.
- **Confirm Dr. Jose floors** — `LOW_FLOORS` provisional numbers (rhr <50 / sys <90 / dia <60 / spo2_avg <92 / spo2_min <88); replace once Dr. Jose lands on the right numbers.
- **Withings weight extension** — small follow-on.
- **Contour fingerstick parser** — folder + dispatch ready; parser ships when sample available.
- **xDrip+ ongoing CGM capture** — new G7 sensor pending, then confirm one live reading lands.
- **`daily_metrics` + `metric_drift` views both scan full history per query** — trivial at current ~3k CGM rows + 10 SpO2 rows; future perf item once CGM accrues months.
- No cron failure alerting — small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
