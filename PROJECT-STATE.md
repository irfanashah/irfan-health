# Project State — Irfan's Health Platform

_Last updated: 2026-06-22 (session: SpO2 dashboard surfacing shipped — card + drift integration; migrations re-applied + pushed)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Dashboard layer + file-drop ingestion + SpO2 surfacing all live. SpO2 commits pushed; migrations 003 + 004 re-applied in Supabase and verified — `daily_metrics` exposes `spo2_avg`/`spo2_min` for all 5 ingested nights (avg 96.1–96.9%, min 87–91%), and `metric_drift` now watches the two new SpO2 metrics. Pending only visual verification on Vercel.

## Slice ledger
- ✅ Slice 0 — Scaffold · ✅ 1 Whoop · ✅ 1.5/1.6 backfill+refill · ✅ 2 Withings BP
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ✅ Slice 4 — File-drop ingestion pipeline + Oxylink parser (verified end-to-end 2026-06-22: 5 nights / 10 rows)
- ✅ Slice 5 — Nightscout CGM adapter · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ Slice 7.1 — Trend dashboard (baseline)
- ✅ Slice 7.2 — Connections (Correlation Explorer + Cardiac Readiness + cross-source views)
- ✅ Slice 7.3 — Personal Baseline & Drift Engine
- ✅ SpO2 dashboard surfacing (Slice 4 follow-on) — pushed 2026-06-22; migrations re-applied + data verified at the view layer
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose low floors; Contour parser (when sample available); Slice 6 — Labs PDF (rides file-drop pipeline); med-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer

## Data state
- **Whoop:** complete, Diagnose gap = 0; 6-hourly cron clean.
- **Withings:** `bp_readings` complete, Diagnose gap = 0; 12-hourly cron clean. (BP only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows, Diagnose gap = 0 (last 30 d); 12-hourly cron live.
- **Oxylink (overnight SpO2):** 10 rows in `health_observations` (5 nights, wake dates 2026-06-18 → 06-22; avg 96.1–96.9%, min 87–91%). File-drop pipeline live (10:00 + 21:00 GST). `daily_metrics` + `metric_drift` views verified post-migration-rerun.
- **`daily_metrics` view:** post-SpO2 it exposes `spo2_avg`/`spo2_min` — verified.
- **`metric_drift` view:** post-SpO2 it watches 10 metrics — verified.

## Next action
Eyeball the deploy at `https://irfan-health.vercel.app/` once Vercel finishes: Recovery & Sleep card should show 5 nights of SpO2 (avg ~96% / min high-80s/low-90s, ≥95 band shaded, last-night readout); Baselines & Drift panel should add `spo2_avg` + `spo2_min` rows sitting `establishing` (insufficient data-days yet — they'll move to `active` as more nights accrue). Once green, the next slot is the **Withings weight extension** (small — unblocks the Weight panel + Correlation Explorer's Weight metric + Slice 7.3 weight-drift).

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
