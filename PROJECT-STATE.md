# Project State — Irfan's Health Platform

_Last updated: 2026-06-25 (session: Cardiac BP chart — ACC/AHA per-metric zones + combined category readout)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Cardiac panel BP chart fixed — the long-standing visual bug where ONE band set (60–120 teal, 120–130 amber, 130+ red) covered the whole y-axis was correct for systolic but wrong for diastolic (a diastolic of 95 = Stage-2 high used to sit in the green "healthy" band — silent lie). Now: each metric gets its OWN ACC/AHA bands plotted at its actual mmHg range; the BP chart has a faint divider at 95 mmHg with "Systolic"/"Diastolic" edge labels so each line travels through its own clinically-correct territory. New `bpCategory(sys, dia)` is the single source of truth — `st.bp` delegates to it, the Today-at-a-glance KPI dot and the new "Stage 1 hypertension" category readout above the BP chart cannot drift apart. Tooltip extended with per-day category. UI + thresholds only — no data change, no migration. `npm run build` clean — 27 routes.

## Slice ledger
- ✅ Slices 0–5 (sources + ingestion + manual + CGM) · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ 7.1 Trend dashboard · ✅ 7.2 Connections · ✅ 7.3 Personal baseline & drift engine · ✅ 7.3R Baselines & drift redesign + tab move
- ✅ SpO2 dashboard surfacing
- ✅ Oxylink desaturation (ODI + time-below-90 + overnight curve + Overnight Oxygen panel + true event markers + Today min-SpO2 tile)
- ✅ Contour fingerstick parser + CGM-trace fingerstick markers
- ✅ Dashboard 7.1 fixes (Whoop wake-day attribution + Glucose fingerstick fallback + KPI sparkline overflow + sparkline v2 clipPath)
- ✅ Whoop SpO2 rename → `spo2_whoop` + skin_temp add
- ✅ Two-fix patch (TrendChart isolated-point dots + TodayAtAGlance glucose fingerstick fallback)
- ✅ **Cardiac BP chart — ACC/AHA per-metric zones + combined category readout**
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold; Slice 6 — Labs PDF; med-adherence + meal-logging; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged from the previous session. (This was a UI + thresholds slice; no migration, no re-ingestion.)

## Next action
**No migrations to run.** Just eyeball the deploy:
- Cardiac panel: the BP block now has a coloured "Stage 1 hypertension" / "Normal" / etc. status row above the chart with sys/dia value + "as of <date>".
- BP chart: faint zoned territories — diastolic bands in the lower y-region (60–119 mmHg), systolic bands in the upper (90–180+ mmHg), separated by a dashed divider at 95 mmHg with "Systolic" (above) / "Diastolic" (below) edge labels.
- Diastolic 95 should now visibly sit in the red zone (Stage 2) — not the green band like before.
- Tooltip on hover should show the day's combined category.
- RHR/HRV chart unchanged.

Once green, the next slot is the **Withings weight extension**.

## Open items (non-blocking)
- Anchor population — `/baselines` set-anchor form built; populate post-rehab.
- Confirm Dr. Jose low-side floors (BP / SpO2) + ODI severity + skin_temp threshold — all currently provisional.
- Withings weight extension — small follow-on.
- Fasting cross-check (Contour vs CGM-derived) — deferred follow-on.
- Range-wide meter-vs-sensor view — Glucose panel's CGM trace is fixed 24h.
- xDrip+ ongoing CGM capture — new G7 sensor pending.
- Daily / metric_drift views scan full history per query — future perf item once CGM accrues months.
- No cron failure alerting.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- CLAUDE.md cleanup carry-over — "two stale Slice 4 parked lines (~99 + ~251)" from the 7.3R closeout brief — still couldn't locate them.
