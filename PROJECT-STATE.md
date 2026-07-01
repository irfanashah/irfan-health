# Project State — Irfan's Health Platform

_Last updated: 2026-07-01 (session: code-review Phase-2 remediation shipped — vitest test suite + GitHub Actions CI + real README, the platform's first automated regression guard)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Code-review Phase-2 remediation landed — the test net.** This was the #1 tech-debt item from `code-review-and-tech-debt-report_2026-06-30.md`: zero automated tests under a health-decision platform full of cheap-to-test pure functions. Added **vitest** (+ `vitest.config.ts`, `npm run test`/`test:watch`) with **134 assertions across 11 co-located `*.test.ts` files** covering the statistical engine (`stats.ts`, `connections/engine.ts`), the drift gate (`drift/evaluate.ts` + `drift-config.ts`), the clinical classifiers (`bpCategory`, `evaluateLabMarker`, `computeFlag`), `mgdlToMmol`, the Oxylink/Contour file-drop parsers (fixed CSV fixtures, no Drive needed), `lib/gst.ts`, and `defaultMealLabel`. Every expected value was independently hand-derived (or built from already-validated primitives) and cross-checked by one real execution before being locked in — never a tautological echo of the function's own output. **One real bug surfaced and was deliberately NOT papered over:** `evaluateLabMarker`'s LDL near-goal boundary (`1.4+0.2` ≠ `1.6` in floating point) misclassifies a value of exactly 1.6 mmol/L; it's tracked via `it.fails(...)` in the suite (gotcha #144) and flagged to Irfan, not silently fixed. Added `.github/workflows/ci.yml` (Node 20, `tsc --noEmit` + test hard-fail, **lint advisory** — see below) and replaced the untouched `create-next-app` README with a real one (stack, full env-var table, migration-apply order, local-dev + test docs). **Lint is advisory in CI by Irfan's explicit choice, not oversight:** standing up the workflow surfaced ~50 pre-existing lint errors across ~16 live dashboard files (newer React-19 hooks-purity rules landing on code written before those rules existed) — unrelated to this session, confirmed via `git diff`. A background task (`task_3927e02c`) is filed to clean those up and flip lint back to a hard gate. `npm run test` — 133 passed, 1 expected-fail. `tsc --noEmit` clean. `npm run build` clean — 33 routes unchanged. **Out of scope (per the ask):** integration/e2e tests, anything needing a live Supabase/Anthropic/Drive connection, the Phase-3 materialized-view rewrite, retiring dead UI.

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
- ✅ **Code-review Phase 2 remediation — test suite + CI + README** (vitest, 134 assertions over the stats/drift/clinical-classifier core + file-drop parsers + gst; GitHub Actions CI with lint advisory; real README)
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold + lab targets; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived); fix pre-existing lint errors + LDL near-goal float boundary (both flagged, not fixed, this session)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).
- `medications` (migration_010) — Irfan's regimen, deactivate-not-delete.
- `med_adherence` (NEW, migration_011) — one row per GST calendar day, tri-state status; populated by the new one-tap panel. Empty until Irfan starts tapping.

## Next action
**Withings weight extension** (small follow-on) — extend `adapters/withings/{api,index}.ts` + `app/api/refill/withings/route.ts` (gotcha #25 — they must agree) to request `meastype=1` and write `metric_type='weight'`, canonical `kg`. No new migration. Unblocks the Weight panel, Weight KPI, BP-vs-weight Correlation preset, and the weight drift signal. Unaffected by this session's test/CI/README work — still the next real feature slice.

## Open items (non-blocking)
- **LDL near-goal boundary bug (found 2026-07-01, not fixed)** — `evaluateLabMarker`'s `value <= goal+near` check misclassifies a value of exactly 1.6 mmol/L as `'off-goal'` instead of `'near'` (`1.4+0.2 !== 1.6` in floating point). Tracked via `it.fails` in `app/labs/_lib/targets.test.ts`; gotcha #144. Trivial fix (epsilon tolerance) once you say go.
- **Pre-existing lint debt (found 2026-07-01, not fixed)** — ~50 ESLint errors across ~16 live dashboard/app files, from newer React-19 hooks-purity rules landing on older code; unrelated to any recent session. CI's lint step is advisory (`continue-on-error`) until this is cleaned up. Background task `task_3927e02c` filed to fix + flip CI lint back to a hard gate.
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
