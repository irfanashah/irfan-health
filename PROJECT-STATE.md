# Project State — Irfan's Health Platform

_Last updated: 2026-06-30 (session: food diary + auto-macros — turns the engine's biggest unmeasured confounder (diet) into measured, adjustable variables. migration_012 + /food + macro columns + meal markers + Explorer evening-carbs/sodium toggles)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Food diary closes the engine's biggest blind spot.** Diet was the dominant *unmeasured* confounder for sleep + glucose (the correlations spec called it out: "a late high-carb dinner → poor sleep AND a morning glucose spike"). Now: `/food` lets Irfan log a meal in plain words → Sonnet estimates macros (carbs / protein / fat / fiber / sugar / sodium / kcal) → editable review → commit to `meals` (migration_012). Daily totals + meal-timing flow into `daily_metrics` via `migration_003`'s new `meals_daily` CTE — including **`evening_carbs_g`** (carbs within 4h before that night's sleep onset, fallback ≥18:00 GST when no Whoop) + **`last_meal_to_sleep_min`**. **Eaten-day attribution** — the engine adds its own +1d lag; pre-shifting here would double-shift (gotcha #136). The correlation engine's `ENGINE_METRIC_IDS` now includes carbs/sugar/fiber/sodium/calories/evening_carbs/last-meal-to-sleep; `connections/confounders.ts` **flipped** the evening-meal / sodium confounders from `unmeasured: 'consider logging'` to `measured: 'covariate'` for the outcomes that now have a control variable. The Explorer gains **"Control for evening carbs"** + **"Control for sodium"** partial-corr toggles (same n-gated Explorer-only discipline — not in the discovery scan). The CGM trace gets **time-anchored meal markers** (amber, glyph radius scales with carbs, 'C' inside, snap-dot on the curve) so the post-meal trajectory is glanceable. Estimates labelled everywhere; LLM prompt forbids food judgement / advice. The **n-of-1 experiment** Phase 2 feature is now better supported — carbs are measurable. **Last week's Correlations engine still in place** — what changed is the inputs the engine sees. `npm run build` clean — 33 routes (`/food` added).

## Slice ledger
- ✅ Slices 0–5 (sources + ingestion + manual + CGM) · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ 7.1 Trend dashboard · ✅ 7.2 Connections · ✅ 7.3 Personal baseline & drift engine · ✅ 7.3R Baselines & drift redesign + tab move
- ✅ SpO2 dashboard surfacing
- ✅ Oxylink desaturation (ODI + time-below-90 + overnight curve + Overnight Oxygen panel + true event markers + Today min-SpO2 tile)
- ✅ Contour fingerstick parser + CGM-trace fingerstick markers
- ✅ Dashboard 7.1 fixes (Whoop wake-day attribution + Glucose fingerstick fallback + KPI sparkline overflow)
- ✅ Whoop SpO2 rename → `spo2_whoop` + skin_temp add
- ✅ Two-fix patch (TrendChart isolated-point dots + TodayAtAGlance glucose fingerstick fallback)
- ✅ Cardiac BP chart — ACC/AHA per-metric zones + combined category readout
- ✅ Slice 6 — Labs PDF import (LLM extraction + human review + Labs section with trends)
- ✅ Labs large-file fix — direct-to-Storage upload + mixed-document prompt
- ✅ Labs marker-system maturation — auto-canonicals + AI-proposed ranges + computed flags + remembered-range store
- ✅ Labs UI split — `/labs` = import tool only; dashboard 4th tab "Labs" = data viz
- ✅ **Doctor record (`/report`) + editable medications list**
- ✅ **Lab markers — clinical-target tracking** (LAB_TARGETS + evaluateLabMarker + Lp(a) reported fallback + report page-1 + Labs tab summary strip & goal lines)
- ✅ **Medication adherence — daily one-tap** (migration_011 + MedAdherencePanel + /medications heat-strip + /report self-reported line; honest two-number math)
- ✅ **Platform alerts & reminders** (Resend email primitive + daily pipeline-health digest cron + daily adherence-nudge cron + /diagnostics pipeline-health table; resolves the "cron monitoring" Pending item)
- ✅ **Correlations engine revamp — lagged-association discovery + rebuilt Explorer** (detrend + autocorrelation-corrected FDR + curated/optional-LLM confounder layer; VAR/LMM = Phase 2)
- ✅ **Food diary + auto-macros** (migration_012 + Sonnet estimate → review → commit + meals_daily CTE + eaten-day attribution + meal markers on CGM trace + engine adjustments)
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold + lab targets; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).
- `medications` (migration_010) — Irfan's regimen, deactivate-not-delete.
- `med_adherence` (NEW, migration_011) — one row per GST calendar day, tri-state status; populated by the new one-tap panel. Empty until Irfan starts tapping.

## Next action
1. **Run `migration_012_food_diary.sql`** in Supabase — creates the `meals` table + index + RLS. Idempotent, no seed.
2. **Re-run `migration_003_daily_metrics_view.sql`** — adds the `whoop_sleep_onset` + `meals_enriched` + `meals_daily` CTEs and nine new columns at the end (carbs/protein/fat/fiber/sugar/sodium/calories/evening_carbs_g/last_meal_to_sleep_min). The view is `CREATE OR REPLACE` so this is a single re-run, no drop needed.
3. Confirm `ANTHROPIC_API_KEY` is set on Vercel (it should be — already used by Labs + the LLM-confounder expand). After deploy, hit **Food** in the dashboard header. Log a meal like *"2 rotis, chicken karahi, cucumber salad — about 9pm"* → expect Sonnet returns 3-4 items with assumed-portion notes ("Roti — assumed 2 medium") + sensible totals + an estimate caveat banner. Tweak any number, Commit. The Glucose panel on `/` should now show an amber "C" pin at the meal time.
4. Over the next few days as more meals + meal-timing accrue, the correlation engine's Explorer "Control for evening carbs" / "Control for sodium" toggles become useful — try `Fasting glucose` vs `Sleep hours` with vs without "Control for evening carbs" to see whether the carb covariate is doing real work.
5. Once green, the next slot is the **Withings weight extension** — extend `adapters/withings/{api,index}.ts` + `app/api/refill/withings/route.ts` (gotcha #25 — they must agree) to request `meastype=1` and write `metric_type='weight'`, canonical `kg`. No new migration. Unblocks the Weight panel, Weight KPI, BP-vs-weight Correlation preset, and the weight drift signal.

## Open items (non-blocking)
- Anchor population — `/baselines` set-anchor form built; populate post-rehab.
- Confirm Dr. Jose low-side floors (BP / SpO2) + ODI severity + skin_temp threshold — provisional.
- Withings weight extension — small follow-on.
- Lab markers as drift metrics (LDL drift etc.) — deferred follow-on, builds on the Labs section.
- Doctor-record export — separate, builds on labs + meds.
- Fasting cross-check (Contour vs CGM-derived) — deferred follow-on.
- Re-mapping UI for lab_marker_aliases — v1 has ON CONFLICT DO NOTHING (first commit wins); a future UI to update aliases would make it possible to fix a mis-mapping after the fact.
- Range-wide meter-vs-sensor view — Glucose panel's CGM trace is fixed 24h.
- xDrip+ ongoing CGM capture — new G7 sensor pending.
- Daily / metric_drift views scan full history per query — future perf item once CGM accrues months.
- ~~No cron failure alerting.~~ — ✅ Daily `/api/cron/health-check` digest emails when any API-pull source is stale. Set `RESEND_API_KEY` + `ALERT_EMAIL_TO` on Vercel to activate. File-drop sources excluded by design (user-action-dependent, staleness is normal there).
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- CLAUDE.md cleanup carry-over — "two stale Slice 4 parked lines (~99 + ~251)" — still couldn't locate them.
