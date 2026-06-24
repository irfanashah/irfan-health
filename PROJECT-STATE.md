# Project State — Irfan's Health Platform

_Last updated: 2026-06-24 (session: Contour fingerstick parser + CGM-trace fingerstick markers)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Contour Next One fingerstick parser shipped on top of the existing file-drop pipeline (cron + Drive pull + validate/parse/ingest/move already generic). Writes `glucose_fingerstick` rows shaped identically to Slice 3 manual entry (`metric_type='glucose_fingerstick'`, `data_shape='discrete'`, canonical mmol/L), plus `extras` enrichment (`meal_marker`, `data_source`, `notes`). `source_record_id` timestamp+value keyed for idempotency on re-drop. **No new migration table** — only a one-line `sources` seed (`migration_006_contour_source.sql`, idempotent). **Part 2 shipped too:** `CGMChart` markers extended with a `'fingerstick'` kind that value-anchors at the meter's own reading (NOT snapped to the CGM curve) so meter-vs-sensor agreement is visible at a glance; `fetchFingersticks(24)` reader added; Glucose panel wired. `npm run build` clean — 27 routes.

## Slice ledger
- ✅ Slice 0 — Scaffold · ✅ 1 Whoop · ✅ 1.5/1.6 backfill+refill · ✅ 2 Withings BP
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ✅ Slice 4 — File-drop ingestion pipeline + Oxylink parser
- ✅ Slice 5 — Nightscout CGM adapter · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ Slice 7.1 — Trend dashboard (baseline)
- ✅ Slice 7.2 — Connections (Correlation Explorer + Cardiac Readiness + cross-source views)
- ✅ Slice 7.3 — Personal Baseline & Drift Engine
- ✅ SpO2 dashboard surfacing (Slice 4 follow-on)
- ✅ Slice 7.3R — Baselines & drift redesign + tab move (Claude Design port)
- ✅ Oxylink desaturation — ODI + time-below-90 + overnight curve + Overnight Oxygen panel + true event markers + Today min-SpO2 tile
- ✅ **Contour fingerstick parser + CGM-trace fingerstick markers** (Slice 4 follow-on)
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose low floors + ODI severity bands; Slice 6 — Labs PDF (rides file-drop pipeline); med-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived fasting — deferred follow-on)

## Data state
- **Whoop:** complete, Diagnose gap = 0; 6-hourly cron clean.
- **Withings:** `bp_readings` complete, Diagnose gap = 0; 12-hourly cron clean. (BP only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows, Diagnose gap = 0 (last 30 d); 12-hourly cron live.
- **Oxylink (overnight SpO2 + desaturation):** 7 nights ingested via the new shape (`spo2_overnight_avg`, `_min`, `_odi`, `_time_below_90_pct`, `_overnight_curve` + `desaturation_events`). ODI 5.5–9.1 / h (mild band). File-drop pipeline live (10:00 + 21:00 GST).
- **Contour fingerstick:** parser + registry + source-seed shipped; awaiting first Drive drop. Real export `Patient's_BG_data_Irfan_Shah_6_24_2026.csv` has 57 readings (05/04→06/24 2026) — all 90–141 mg/dL, none expected to filter.
- **`daily_metrics` view:** 12 metric exposure (8 v1 + 2 SpO2 + 2 desat). Unchanged this slice.
- **`metric_drift` view:** 12 signals. Unchanged this slice (fingersticks are not drift-able — they're sparse events, not daily metrics).

## Next action
1. **Run `migration_006_contour_source.sql`** in Supabase (one INSERT, idempotent).
2. **Create `inbox/contour/` in Drive**, drop `Patient's_BG_data_Irfan_Shah_6_24_2026.csv` there.
3. **Wait for the next file-drop cron tick** (10:00 / 21:00 GST) or trigger manually (`curl -H "Authorization: Bearer $CRON_SECRET" https://irfan-health.vercel.app/api/cron/file-drop`). Expect ~57 `glucose_fingerstick` rows written (`source_slug='contour'`), file moved to `processed/contour/`, one row on `/diagnostics`.
4. **Eyeball the deploy**: Glucose panel's 24h CGM trace should show teal diamond markers at the meter's own values for any fingerstick within the last 24 h (typically the morning fasting reading); hover any diamond shows meter value + CGM value at the same time + meal marker / source. Manual fingersticks from `/log` should ALSO appear automatically (the reader is source-agnostic).
5. Once green, the next slot is the **Withings weight extension** (small — unblocks the Weight panel + Correlation Explorer's Weight metric + Slice 7.3 weight-drift).

## Open items (non-blocking)
- **Anchor population** — `/baselines` set-anchor form is built; populate post-rehab.
- **Confirm Dr. Jose floors + ODI severity bands** — `LOW_FLOORS` (rhr <50 / sys <90 / dia <60 / spo2_avg <92 / spo2_min <88) + `st.odi(v)` band (<5 normal · 5–<15 mild · ≥15 concern) all provisional; replace once Dr. Jose lands on the right numbers.
- **Withings weight extension** — small follow-on.
- **Fasting cross-check (Contour vs CGM-derived)** — deferred follow-on flagged in the parser spec. Contour's `Fasting`-marked readings vs `daily_metrics.fasting` (CGM-derived) — potentially its own drift signal. Touches the view + maybe drift-config; spec separately if wanted.
- **Range-wide meter-vs-sensor view** — the Glucose panel's CGM trace is fixed 24h, so fingerstick markers only show today's overlap. A range-wide comparison would be a separate enhancement.
- **xDrip+ ongoing CGM capture** — new G7 sensor pending, then confirm one live reading lands.
- **`daily_metrics` + `metric_drift` views both scan full history per query** — trivial at current volume; future perf item once CGM accrues months.
- No cron failure alerting — small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- **CLAUDE.md cleanup carry-over** — "two stale Slice 4 parked lines (~99 + ~251)" from the 7.3R closeout brief — couldn't locate them; not retried this pass.
