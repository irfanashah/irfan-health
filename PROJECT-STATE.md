# Project State — Irfan's Health Platform

_Last updated: 2026-06-22 (session: Oxylink desaturation — ODI + time-below-90 + overnight curve + new Overnight Oxygen panel; SpO2 surfacing moved out of Recovery & Sleep)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Oxylink desaturation slice shipped + the two follow-on fixes folded in: (1) per-event detail (true timestamps + nadirs) now stored in `extras.desaturation_events` on each `spo2_odi` row, threaded through `fetchLatestSpo2Night()` (returns `{curve, events}`), and rendered as accurate red-dot markers on the overnight trace; (2) Today-at-a-glance KPI row gains a Min SpO2 tile (icon Wind, source Oxylink, coloured by `st.spo2`); `.kpi-grid` bumped to 7 across. Parser emits `spo2_odi` + `spo2_time_below_90_pct` daily-summary rows plus one `spo2_overnight_curve` row/night (display-downsampled). All clinical numbers + event timestamps computed on the full ~4 s in-memory series. Migrations 003 + 004 extended (both `CREATE OR REPLACE`). New `Overnight Oxygen` Dashboard panel (4-stat readout + distribution donut + overnight trace w/ event markers + range trend); SpO2 card **removed from Recovery & Sleep**. ODI + time-below-90 flow into the Baselines & drift tab automatically (12 signals now). `npm run build` clean — 27 routes. **Pending:** re-run migrations 003 + 004 in Supabase, re-drop the 5 Oxylink CSVs to backfill the new metrics + curve + events (idempotent), then eyeball the deploy.

## Slice ledger
- ✅ Slice 0 — Scaffold · ✅ 1 Whoop · ✅ 1.5/1.6 backfill+refill · ✅ 2 Withings BP
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ✅ Slice 4 — File-drop ingestion pipeline + Oxylink parser (verified end-to-end 2026-06-22: 5 nights / 10 rows)
- ✅ Slice 5 — Nightscout CGM adapter · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ Slice 7.1 — Trend dashboard (baseline)
- ✅ Slice 7.2 — Connections (Correlation Explorer + Cardiac Readiness + cross-source views)
- ✅ Slice 7.3 — Personal Baseline & Drift Engine
- ✅ SpO2 dashboard surfacing (Slice 4 follow-on) — display card + drift integration
- ✅ Slice 7.3R — Baselines & drift redesign + tab move (Claude Design port)
- ✅ **Oxylink desaturation — ODI + time-below-90 + overnight curve + Overnight Oxygen panel** (Slice 4 follow-on)
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose low floors + ODI severity bands; Contour parser (when sample available); Slice 6 — Labs PDF (rides file-drop pipeline); med-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer

## Data state
- **Whoop:** complete, Diagnose gap = 0; 6-hourly cron clean.
- **Withings:** `bp_readings` complete, Diagnose gap = 0; 12-hourly cron clean. (BP only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows, Diagnose gap = 0 (last 30 d); 12-hourly cron live.
- **Oxylink (overnight SpO2 + desaturation):** 10 rows from the first SpO2 surfacing (avg + min) for 5 nights (2026-06-18 → 06-22). On re-drop of any one of the 5 CSVs the parser now also emits `spo2_odi` + `spo2_time_below_90_pct` + `spo2_overnight_curve` rows (idempotent, dedupes on `(source_slug, source_record_id)`). File-drop pipeline live (10:00 + 21:00 GST).
- **`daily_metrics` view:** post-desat extension exposes `spo2_odi` + `spo2_time_below_90` (verified at file-level; pending Supabase re-run + data verification).
- **`metric_drift` view:** post-extension watches 12 metrics. Read window stays at 30 days at the data-module layer.

## Next action
1. **Re-run migrations 003 + 004 in Supabase** (both `CREATE OR REPLACE`, idempotent).
2. **Re-drop one Oxylink CSV** from `processed/oxylink/` back into `inbox/oxylink/` and trigger the file-drop cron. The two new daily-summary rows + the curve row for that night land via upsert; existing avg/min rows untouched. Repeat for each of the 5 nights to backfill the panel + drift signals across the full set.
3. **Eyeball the deploy** at `https://irfan-health.vercel.app/`: Today-at-a-glance KPI row now has a 7th tile (Min SpO2, overnight). Dashboard tab should contain the new "Overnight Oxygen" panel between Recovery & Sleep and Weight: last-night readout + distribution donut + overnight curve trace **with red event markers at each detected 3% desaturation** + min-SpO2/ODI range trend. Hovering a marker shows nadir % + drop pp + ≥4% flag. Recovery & Sleep should no longer carry the SpO2 section. Baselines & drift tab should list 12 metrics (the 10 from before + `spo2_odi` + `spo2_time_below_90`), with both new ones `establishing` until ~7–12 nights accrue.
4. Once green, the next slot is the **Withings weight extension** (small — unblocks the Weight panel + Correlation Explorer's Weight metric + Slice 7.3 weight-drift).

## Open items (non-blocking)
- **Anchor population** — `/baselines` set-anchor form is built; populate post-rehab.
- **Confirm Dr. Jose floors + ODI severity bands** — `LOW_FLOORS` (rhr <50 / sys <90 / dia <60 / spo2_avg <92 / spo2_min <88) + new `st.odi(v)` band (<5 normal · 5–<15 mild · ≥15 concern) all provisional; replace once Dr. Jose lands on the right numbers.
- **Withings weight extension** — small follow-on.
- **Contour fingerstick parser** — folder + dispatch ready; parser ships when sample available.
- **xDrip+ ongoing CGM capture** — new G7 sensor pending, then confirm one live reading lands.
- **`daily_metrics` + `metric_drift` views both scan full history per query** — trivial at current volume; future perf item once CGM accrues months.
- No cron failure alerting — small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- **CLAUDE.md cleanup carry-over** — "two stale Slice 4 parked lines (~99 + ~251)" from the 7.3R closeout brief — couldn't locate them; not retried this pass.
