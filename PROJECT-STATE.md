# Project State — Irfan's Health Platform

_Last updated: 2026-06-25 (session: Whoop SpO2 rename → `spo2_whoop` + skin_temp added — corrects a gap-analysis-v2 error)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Two Whoop fields cleaned up + surfaced. **(1) Mislabel correction:** the adapter was already writing Whoop's recovery SpO2 — but under `metric_type='spo2_overnight_avg'`, colliding semantically with Oxylink. Renamed to `spo2_whoop`; `migration_007` re-stamps history in place (no deletes). Now surfaced as a corroborating readout in the Overnight Oxygen panel — Oxylink stays authoritative. **(2) Skin temperature added:** `rec.score.skin_temp_celsius` was in the payload but never written. Now a first-class drift signal (concerning='up' — sustained rise = possible illness / inflammation / fever) and a small readout in Recovery & Sleep. Both wake-day attributed via `whoop_wake` (mandatory — gotcha #74 the recovery payload is cycle-end-stamped). `npm run build` clean — 27 routes.

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
- ✅ Dashboard 7.1 fixes — Whoop wake-day attribution + Glucose fingerstick fallback + KPI sparkline overflow
- ✅ **Whoop SpO2 rename → `spo2_whoop` + skin_temp add** (corrects gap-analysis-v2)
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold; Slice 6 — Labs PDF; med-adherence + meal-logging; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
- **Whoop:** complete, Diagnose gap = 0; 6-hourly cron clean. Adapter now writes `spo2_whoop` (corroborating) + `skin_temp` (drift-tracked); both null-guarded. Migration_007 re-stamps existing SpO2 history.
- **Withings:** `bp_readings` complete, Diagnose gap = 0; 12-hourly cron clean. (BP only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows, last write May 2026; live xDrip+/G7 capture pending new sensor. Glucose panel has fingerstick fallback for this stale-CGM state.
- **Oxylink (overnight SpO2 + desaturation):** 7 nights ingested via the new shape; file-drop pipeline live.
- **Contour fingerstick:** 57 readings ingested (05/04 → 06/24 2026).
- **`daily_metrics` view:** 14 metric exposure (8 v1 + 4 SpO2/desat + skin_temp + spo2_whoop). `whoop_daily` now routes spo2_whoop + skin_temp through `whoop_wake` (mandatory wake-day attribution).
- **`metric_drift` view:** 13 signals (added `skin_temp`; `spo2_whoop` deliberately NOT a drift signal — corroborating only).

## Next action
**Run the migrations IN ORDER**:
1. **`migration_007_whoop_spo2_rename.sql`** — re-stamps existing Whoop SpO2 rows in place from `spo2_overnight_avg` → `spo2_whoop` (idempotent; never deletes).
2. **`migration_003`** (CREATE OR REPLACE) — adds `spo2_whoop` + `skin_temp` columns to the wake-day-attributed `whoop_daily` CTE.
3. **`migration_004`** (CREATE OR REPLACE) — adds `skin_temp` UNION ALL line to `long_form` (skin_temp only; spo2_whoop is corroborating, not drift).
4. Then run the **Whoop refill** once (browser dev-console `fetch('/api/refill/whoop', {method:'POST'})` while logged in) to backfill skin_temp history + re-confirm spo2_whoop. The fix is forward-applying — the refill is what fills in skin_temp for past cycles.

**Verify**: `SELECT date, recovery, spo2_whoop, skin_temp FROM daily_metrics WHERE skin_temp IS NOT NULL ORDER BY date DESC LIMIT 10;` — should show skin_temp values across the last ~10 days (degrees Celsius) and spo2_whoop alongside.

**Eyeball the deploy**: Recovery & Sleep panel shows a small "Skin temp 33.6°C · +0.3°C vs your normal" line below sleep stages. Overnight Oxygen panel shows a small "Whoop · corroborating 96%" pill below the Oxylink readout. Baselines & drift tab adds `skin_temp` as a drift row (`establishing` until ~5–12 nights of post-refill data accrue).

## Open items (non-blocking)
- **Anchor population** — `/baselines` set-anchor form is built; populate post-rehab.
- **Confirm Dr. Jose floors + ODI severity + skin_temp threshold** — `LOW_FLOORS` + `st.odi(v)` + skin_temp `absFloor 0.4 / zFloor 1.0` all provisional.
- **Withings weight extension** — small follow-on.
- **Fasting cross-check (Contour vs CGM-derived)** — deferred follow-on.
- **Range-wide meter-vs-sensor view** — Glucose panel's CGM trace is fixed 24h.
- **xDrip+ ongoing CGM capture** — new G7 sensor pending.
- **Daily / metric_drift views scan full history** — future perf item once CGM accrues months.
- No cron failure alerting.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- **CLAUDE.md cleanup carry-over** — "two stale Slice 4 parked lines (~99 + ~251)" from the 7.3R closeout brief — still couldn't locate them.
