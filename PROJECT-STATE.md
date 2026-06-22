# Project State — Irfan's Health Platform

_Last updated: 2026-06-22 (session: Baselines & Drift redesign — moved to its own third tab, rebuilt to the Claude Design layout; engine untouched)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Baselines & Drift has moved out of the Dashboard tab into its own **third top-level tab** (Dashboard · Correlations · Baselines & drift) and is rebuilt to the Claude Design layout: overall-read band → 5 tiers (Below a safe line / Worth a look / Going the right way / Steady chips / Not reading yet) → signal cards with the BandSpark + plain-English "See the numbers" expand. **Drift engine untouched** — no view/threshold/gate change. Only data-layer change: `fetchMetricDrift` widened to 30 days. `npm run build` clean — 27 routes. Pending only visual verification on Vercel.

## Slice ledger
- ✅ Slice 0 — Scaffold · ✅ 1 Whoop · ✅ 1.5/1.6 backfill+refill · ✅ 2 Withings BP
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ✅ Slice 4 — File-drop ingestion pipeline + Oxylink parser (verified end-to-end 2026-06-22: 5 nights / 10 rows)
- ✅ Slice 5 — Nightscout CGM adapter · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ Slice 7.1 — Trend dashboard (baseline)
- ✅ Slice 7.2 — Connections (Correlation Explorer + Cardiac Readiness + cross-source views)
- ✅ Slice 7.3 — Personal Baseline & Drift Engine
- ✅ SpO2 dashboard surfacing (Slice 4 follow-on) — pushed 2026-06-22; migrations re-applied + data verified
- ✅ **Slice 7.3R — Baselines & drift redesign + tab move** (Claude Design port — overall-read band + 5 tiers + BandSpark; engine untouched; `fetchMetricDrift` daysBack=30)
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose low floors; Contour parser (when sample available); Slice 6 — Labs PDF (rides file-drop pipeline); med-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer

## Data state
- **Whoop:** complete, Diagnose gap = 0; 6-hourly cron clean.
- **Withings:** `bp_readings` complete, Diagnose gap = 0; 12-hourly cron clean. (BP only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows, Diagnose gap = 0 (last 30 d); 12-hourly cron live.
- **Oxylink (overnight SpO2):** 10 rows in `health_observations` (5 nights, wake dates 2026-06-18 → 06-22). File-drop pipeline live (10:00 + 21:00 GST).
- **`daily_metrics` view:** exposes `spo2_avg`/`spo2_min` (verified).
- **`metric_drift` view:** watches 10 metrics (verified). Read window widened to 30 days at the data-module layer (`fetchMetricDrift(30)`); the view itself unchanged.

## Next action
Eyeball the 7.3R deploy on Vercel: the third tab **Baselines & drift** should appear between Correlations and the right-side header controls. Inside, the overall-read band reads "Holding steady" / "Still learning your normal" (anchor not set, most metrics still establishing/no-data); SpO2 + RHR/HRV may show "settling in"; BP/Glucose lean on existing data. The Dashboard tab should no longer contain the Baselines & Drift panel (the seven dashboard panels remain). Header label "Baselines" was renamed to "Set anchor" to disambiguate from the new tab; the link still goes to `/baselines`. Once green, the next slot is the **Withings weight extension** (small — unblocks the Weight panel + Correlation Explorer's Weight metric + Slice 7.3 weight-drift).

## Open items (non-blocking)
- **CLAUDE.md cleanup carry-over — "two stale Slice 4 parked lines (~99 + ~251)" the 7.3R closeout brief asked me to strike** — couldn't locate them. Searched for `parked` / `Slice 4 parked` and only found (a) the live Done entry header that mentions "Reclaims the parked Slice 4 …" (accurate phrasing, not stale) and (b) the Reference-section line "Slice 4 reclaimed + done" (also accurate). Both were left untouched. If you meant different lines, send the literal text and I'll strike in a follow-up commit.
- **Anchor population** — `/baselines` set-anchor form is built; populate post-rehab.
- **Confirm Dr. Jose floors** — `LOW_FLOORS` provisional numbers (rhr <50 / sys <90 / dia <60 / spo2_avg <92 / spo2_min <88); replace once Dr. Jose lands on the right numbers.
- **Withings weight extension** — small follow-on.
- **Contour fingerstick parser** — folder + dispatch ready; parser ships when sample available.
- **xDrip+ ongoing CGM capture** — new G7 sensor pending, then confirm one live reading lands.
- **`daily_metrics` + `metric_drift` views both scan full history per query** — trivial at current volume; future perf item once CGM accrues months.
- No cron failure alerting — small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
