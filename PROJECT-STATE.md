# Project State — Irfan's Health Platform

_Last updated: 2026-06-25 (session: 7.1 dashboard fixes — Whoop wake-day attribution bug + Glucose fingerstick fallback + KPI sparkline overflow)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Three live-eyeballed issues fixed. **Part 1 was a real data-correctness bug** — `daily_metrics`'s `whoop_daily` CTE bucketed recovery/RHR/HRV/strain by `period_end` which is the CYCLE end, not the wake morning. Any cycle ending after GST midnight mis-dated to the next day, collided, and dropped the correct day to NULL — scattered gaps on RHR/HRV/Recovery charts AND corrupt drift baselines (the `metric_drift` view reads these). Fixed at the view layer (`whoop_wake` CTE derives wake from each cycle's main sleep; recovery family JOINs on `period_start`). No data migration, no re-ingestion. **Part 2:** Glucose panel now has a fingerstick fallback — latest fingerstick as headline "now" + recent-readings list + "Needs CGM data" TIR placeholder when no recent CGM. **Part 3:** KPI sparkline now `overflow: hidden` + ≤2-point short-circuit → BP sparkline no longer bleeds out of its tile. `npm run build` clean — 27 routes.

## Slice ledger
- ✅ Slice 0 — Scaffold · ✅ 1 Whoop · ✅ 1.5/1.6 backfill+refill · ✅ 2 Withings BP
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ✅ Slice 4 — File-drop ingestion pipeline + Oxylink parser
- ✅ Slice 5 — Nightscout CGM adapter · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ Slice 7.1 — Trend dashboard (baseline)
- ✅ Slice 7.2 — Connections (Correlation Explorer + Cardiac Readiness + cross-source views)
- ✅ Slice 7.3 — Personal Baseline & Drift Engine
- ✅ SpO2 dashboard surfacing
- ✅ Slice 7.3R — Baselines & drift redesign + tab move (Claude Design port)
- ✅ Oxylink desaturation — ODI + time-below-90 + overnight curve + Overnight Oxygen panel + true event markers + Today min-SpO2 tile
- ✅ Contour fingerstick parser + CGM-trace fingerstick markers
- ✅ **Dashboard 7.1 fixes — Whoop wake-day attribution + Glucose fingerstick fallback + KPI sparkline overflow**
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose low floors + ODI severity bands; Slice 6 — Labs PDF (rides file-drop pipeline); med-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived fasting — deferred follow-on)

## Data state
- **Whoop:** complete, Diagnose gap = 0; 6-hourly cron clean. (View now attributes recovery/RHR/HRV/strain by wake day correctly — no re-ingestion needed.)
- **Withings:** `bp_readings` complete, Diagnose gap = 0; 12-hourly cron clean. (BP only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows, last write May 2026; live xDrip+/G7 capture pending new sensor. The Glucose panel's fingerstick fallback now handles this stale-CGM state gracefully.
- **Oxylink (overnight SpO2 + desaturation):** 7 nights ingested via the new shape; file-drop pipeline live (10:00 + 21:00 GST).
- **Contour fingerstick:** 57 readings ingested (05/04 → 06/24 2026).
- **`daily_metrics` view:** wake-day attribution corrected for the Whoop recovery family. 12 metric exposure unchanged.
- **`metric_drift` view:** unchanged in this slice. Drift baselines for RHR + HRV will recompute on the corrected data the next time the dashboard pulls.

## Next action
1. **Re-run `migration_003_daily_metrics_view.sql`** in Supabase (CREATE OR REPLACE only — no data change).
2. **Verify the fix:**
   ```sql
   SELECT date, recovery, rhr, hrv, strain
   FROM daily_metrics
   WHERE date IN ('2026-06-05','2026-06-10');
   ```
   Expect **Jun 5 recovery = 71**, **Jun 10 recovery = 63** (matching the Whoop app).
3. **Eyeball the deploy:**
   - Recovery and RHR/HRV charts should fill in (no more scattered empty days where Whoop has data).
   - Baselines & drift tab's RHR + HRV signals recompute on corrected data.
   - Glucose panel: with CGM stale, the headline now shows your latest Contour fingerstick + a recent-readings list + a "Needs CGM data" placeholder instead of 0/0/0.
   - BP KPI sparkline stays inside its tile (no diagonal bleed).
4. Once green, the next slot is the **Withings weight extension**.

## Open items (non-blocking)
- **Anchor population** — `/baselines` set-anchor form is built; populate post-rehab.
- **Confirm Dr. Jose floors + ODI severity bands** — `LOW_FLOORS` + `st.odi(v)` band all provisional.
- **Withings weight extension** — small follow-on.
- **Fasting cross-check (Contour vs CGM-derived)** — deferred follow-on.
- **Range-wide meter-vs-sensor view** — Glucose panel's CGM trace is fixed 24h.
- **xDrip+ ongoing CGM capture** — new G7 sensor pending.
- **Daily / metric_drift views scan full history** — future perf item once CGM accrues months.
- No cron failure alerting.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- **CLAUDE.md cleanup carry-over** — "two stale Slice 4 parked lines (~99 + ~251)" from the 7.3R closeout brief — still couldn't locate them.
