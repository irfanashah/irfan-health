# Project State — Irfan's Health Platform

_Last updated: 2026-06-30 (session: code-review Phase-1 remediation shipped + migrations 003/013 applied — PHI-read guards on every 'use server' export, App Router error boundaries, 3 correctness bugs, perf indexes, cleanups)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Code-review Phase-1 remediation landed** — the cheap, high-value fixes from `code-review-and-tech-debt-report_2026-06-30.md`. **Security:** every `'use server'` reader is now guarded with `await requireSession()` — the medications/food/labs/confounder-LLM action files had auth on mutators only, leaving PHI readers (`fetchMedications`, `fetchMeals`, `fetchAllPanels`, `fetchAdherence`, etc.) as publicly-callable RPCs by virtue of Next.js compiling every `'use server'` export to a public POST. Behaviour-neutral for authenticated reads from the dashboard; closes a real PHI hole (gotcha #143 added). **Resilience:** `app/error.tsx` + `app/global-error.tsx` (App Router boundaries) — any throw from `app/page.tsx`'s 11 parallel readers now renders a calm Try-again screen instead of Next's raw error page. **Correctness:** (a) `app/api/diagnose/whoop/route.ts` no longer claims an `spo2_overnight_avg` gap that's just the `migration_007` rename; (b) `migration_003`'s `last_meal_to_sleep_min` is `GREATEST(0, …)` with `eaten_at <= sleep_onset` so a post-midnight meal can't push the covariate negative; (c) `whoop_sleep_onset` CTE deduped via `DISTINCT ON (wake_day) … ORDER BY wake_day, period_start` so a split-sleep night doesn't double meal totals. **Perf:** `migration_013_perf_indexes.sql` (NEW) — composite index on `ingestion_log (source_slug, status, completed_at DESC)` (was ZERO indexes; cron + diagnostics paid full scans) + a `period_end DESC` partial index on `health_observations` for the SpO2 latest-night queries. **Trivial cleanups:** `food/actions.ts` imports `gstTodayISO` from `lib/gst` instead of duplicating it; `token-store.ts` drops the dead `.eq()` after `.upsert()`; `shadcn` moved to devDependencies. **Last week's Food diary slice still in place** — what changed is the surrounding security/correctness, not the feature surface. **Out of scope (Phase 2/3 — not done here):** test suite + vitest, CI workflow, README rewrite, materialized-view rewrite, token-refresh locking, retiring dead UI. `npm run build` + `tsc --noEmit` clean — 33 routes unchanged.

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
- ✅ **Code-review Phase 1 remediation** (PHI-read guards on every 'use server' export + App Router error boundaries + 3 correctness bugs + migration_013 perf indexes + trivial cleanups)
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
1. Confirm post-deploy: `/diagnostics` Whoop card should no longer claim an `spo2_overnight_avg` permanent gap (the type was renamed to `spo2_whoop` in `migration_007`; Diagnose now checks the right name + `skin_temp`). Spot-check `/`, `/labs`, `/medications`, `/food` still render for the logged-in user — the new `await requireSession()` guards must be transparent to authenticated reads.
2. Log a meal at `/food` to verify the food-diary flow still works through the guards.
3. Next slot is the **Withings weight extension** — extend `adapters/withings/{api,index}.ts` + `app/api/refill/withings/route.ts` (gotcha #25 — they must agree) to request `meastype=1` and write `metric_type='weight'`, canonical `kg`. No new migration. Unblocks the Weight panel, Weight KPI, BP-vs-weight Correlation preset, and the weight drift signal.

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
