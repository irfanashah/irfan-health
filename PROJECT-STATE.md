# Project State — Irfan's Health Platform

_Last updated: 2026-07-01 (session: full deep-audit run — five parallel readers found a triaged bug backlog, verified against source, recorded in CLAUDE.md; NOTHING fixed yet, awaiting Irfan's go-ahead)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Deep-audit backlog recorded — awaiting triage decision, nothing fixed.** A five-reader parallel audit (security/PHI · ingestion+API · server-actions+labs/food · dashboard+charts · SQL/views) ran on the whole codebase 2026-07-01; every finding was verified against source before listing. Full triaged list lives in **CLAUDE.md → "Known bug backlog — deep audit 2026-07-01"** (1 CRITICAL, 7 HIGH, 14 MEDIUM, 17 LOW). Headline items: **C1** unauthenticated OAuth connect/callback routes let anyone overwrite the device tokens (data-poisoning hole — flagged by 2 readers); **H1–H3** silent health-data loss + a cron that can wedge itself (empty-success frontier advance, missing recovery-cycle buffer the refill route already has, permanently-failing-record window growth); **H4** `last_meal_to_sleep_min` emits 0 not NULL (a regression the Phase-1 GREATEST(0,…) fix introduced); **H5** clinical-low breach silently hidden during `establishing`/suppression (contradicts the engine's own safety-precedence contract); **H6** stale CGM shown as live "now"; **H7** open redirect in the Supabase auth callback. Recommended order when Irfan approves: C1 + H7 (security) → H1–H6 → M-tier; **M1** (drift anchor/rolling baseline mix) is dormant but must be fixed before the first anchor is ever set. **No code touched this pass** — the last shipped state is still the lint-cleanup commit `b22fe6e`.

_Prior session (still the last shipped work): **Lint cleanup follow-on landed — CI is fully green, zero shortcuts.**_ Closes out the code-review Phase-2 remediation: every one of the ~50 lint errors left advisory last session is now genuinely fixed (no `eslint-disable` anywhere), and the LDL near-goal boundary bug that same session surfaced (and deliberately left unfixed, tracked via `it.fails`) is fixed too. Highlights: `prototype-src/**` + `outputs/**` added to eslint ignores (dead reference code, ~14 errors); real rules-of-hooks fixes (hoisted a conditionally-called `useCallback`/`useRouter`/`useTransition` above early returns in `BaselinesClient.tsx` + 4 chart components); real hydration-risk fixes (`Math.random()` gradient ids → `useId()`; a new `lib/hooks/useIsClient.ts` `useSyncExternalStore`-based hook replaces the `useState`+`useEffect` "mounted" pattern in `ThemeToggle`/`Header`, satisfying the newer `set-state-in-effect` rule the old React-documented idiom was tripping); `Donut.tsx`'s post-render `offset += len` mutation replaced with a precomputed cumulative-offset array. `evaluateLabMarker`'s `goalStateLower`/`Higher`/`Range` now carry a `BOUNDARY_EPS=1e-9` so `1.4+0.2!==1.6` in IEEE754 can't misclassify a real lab value at the documented boundary — `targets.test.ts`'s `it.fails` is now a normal passing test. Visually verified every touched chart via a temporary isolated preview route (deleted before commit) since the real dashboard needs Irfan's login. `.github/workflows/ci.yml`'s Lint step is a hard gate again — no `continue-on-error`. `npm run lint` — **0 errors**. `tsc --noEmit` clean. `npm run test` — **133 passed, 0 expected-fail**. `npm run build` clean — 33 routes unchanged. Background task `task_3927e02c` (lint cleanup) dismissed as done.

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
- ✅ **Lint cleanup follow-on — CI fully green** (all ~50 pre-existing lint errors genuinely fixed, zero disables; LDL near-goal boundary bug fixed; CI lint flipped back to hard-blocking)
- 🔎 **Deep audit 2026-07-01 — bug backlog recorded, NOT fixed** (39 verified findings: 1 CRITICAL / 7 HIGH / 14 MEDIUM / 17 LOW — full list in CLAUDE.md "Known bug backlog"; awaiting Irfan's triage)
- → **Bug backlog triage/fixes** OR **Withings weight extension** (small follow-on) — NEXT (Irfan's call on which)
- ⬜ Anchor population (post-rehab; NB fix backlog M1 first); confirm Dr. Jose floors + ODI severity + skin_temp threshold + lab targets; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).
- `medications` (migration_010) — Irfan's regimen, deactivate-not-delete.
- `med_adherence` (NEW, migration_011) — one row per GST calendar day, tri-state status; populated by the new one-tap panel. Empty until Irfan starts tapping.

## Next action
**Irfan's call:** (a) triage/fix the deep-audit backlog (CLAUDE.md "Known bug backlog" — recommend C1 + H7 security first, then H1–H6), or (b) **Withings weight extension** (small follow-on) — extend `adapters/withings/{api,index}.ts` + `app/api/refill/withings/route.ts` (gotcha #25 — they must agree) to request `meastype=1` and write `metric_type='weight'`, canonical `kg`. No new migration. Unblocks the Weight panel, Weight KPI, BP-vs-weight Correlation preset, and the weight drift signal.

## Open items (non-blocking)
- **Deep-audit bug backlog (2026-07-01)** — 39 verified findings in CLAUDE.md "Known bug backlog"; nothing fixed, awaiting triage. Security items (C1 unauth OAuth routes, H7 open redirect) are the sharpest.
- Anchor population — `/baselines` set-anchor form built; populate post-rehab (fix backlog M1 — drift anchor/rolling baseline mix — BEFORE setting the first anchor).
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
