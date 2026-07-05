# Project State — Irfan's Health Platform

_Last updated: 2026-07-01 (session: top 4 deep-audit items fixed — C1 CRITICAL security hole, H7 open redirect, H4 correlation-engine data regression, H5 hidden clinical-low safety bug)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Deep-audit backlog — top 4 items fixed, small high-care pass.** Fixed exactly C1, H7, H4, H5 from the 2026-07-01 audit backlog — nothing else in the backlog touched. **C1 (CRITICAL, security):** the four OAuth connect/callback routes (`app/api/auth/{whoop,withings}/route.ts` + both `callback/route.ts`) had no session guard — `middleware.ts` deliberately exempts `/api/*`, so anyone who knew the app URL could complete OAuth with their own device account and overwrite Irfan's stored tokens. Added the same `getUser()` guard `/api/ingest/*` already uses; CSRF `state` check kept as defence-in-depth. **H7 (security):** open redirect on `?next=` in the Supabase auth callback — extracted a pure `safeRedirectPath()` (`lib/safe-redirect.ts` + `.test.ts`, 6 cases incl. `//evil.com` and backslash-disguised variants). **H4 (data regression):** `last_meal_to_sleep_min` in `migration_003` was fabricating `0` instead of `NULL` on every current day (Postgres `GREATEST(0, NULL) = 0`) — the correlation engine was ingesting a fake covariate reading daily. Fixed with an explicit `CASE WHEN ... IS NULL THEN NULL` guard. **Migration re-run confirmed by Irfan 2026-07-01.** **H5 (clinical safety):** a real clinical-low breach (e.g. systolic 84) was rendering as a calm "settling"/"steady" card whenever the metric was still `establishing` or alerts were suppressed — `present.ts`'s state remap checked those before checking for a breach. Breach now checked first, unconditionally; both the Baselines & Drift panel and `/report` inherit the fix automatically (same `buildDriftPanelData` pipeline). Locked in with `present.test.ts` (7 cases) exercising both exact bug scenarios. Added gotchas #153–155; gotcha #59 marked superseded (it had accidentally documented the H5 bug as the spec). **Backlog count corrected in the process:** the task brief estimated "0 CRITICAL/3 HIGH remaining" after these fixes; the correct count is **4 HIGH remaining** (H1, H2, H3, H6) — 7 original HIGH items minus the 3 fixed here (H4/H5/H7) is 4, not 3. `npm run lint` 0 errors, `tsc --noEmit` clean, `npm run build` clean (33 routes), `npm run test` **146 passed** (133→146, +13 new). SQL syntax verified by hand (balanced parens, matches the CTE's own pre-existing patterns) — **no live Postgres connection available in this sandboxed environment to execute `migration_003` directly; sanity-check the re-run.**

_Prior session (still otherwise the last shipped work before this pass): **Lint cleanup follow-on landed — CI is fully green, zero shortcuts.**_ Closes out the code-review Phase-2 remediation: every one of the ~50 lint errors left advisory last session is now genuinely fixed (no `eslint-disable` anywhere), and the LDL near-goal boundary bug that same session surfaced (and deliberately left unfixed, tracked via `it.fails`) is fixed too. Highlights: `prototype-src/**` + `outputs/**` added to eslint ignores (dead reference code, ~14 errors); real rules-of-hooks fixes (hoisted a conditionally-called `useCallback`/`useRouter`/`useTransition` above early returns in `BaselinesClient.tsx` + 4 chart components); real hydration-risk fixes (`Math.random()` gradient ids → `useId()`; a new `lib/hooks/useIsClient.ts` `useSyncExternalStore`-based hook replaces the `useState`+`useEffect` "mounted" pattern in `ThemeToggle`/`Header`, satisfying the newer `set-state-in-effect` rule the old React-documented idiom was tripping); `Donut.tsx`'s post-render `offset += len` mutation replaced with a precomputed cumulative-offset array. `evaluateLabMarker`'s `goalStateLower`/`Higher`/`Range` now carry a `BOUNDARY_EPS=1e-9` so `1.4+0.2!==1.6` in IEEE754 can't misclassify a real lab value at the documented boundary — `targets.test.ts`'s `it.fails` is now a normal passing test. Visually verified every touched chart via a temporary isolated preview route (deleted before commit) since the real dashboard needs Irfan's login. `.github/workflows/ci.yml`'s Lint step is a hard gate again — no `continue-on-error`. `npm run lint` — **0 errors**. `tsc --noEmit` clean. `npm run test` — **133 passed, 0 expected-fail**. `npm run build` clean — 33 routes unchanged. Background task `task_3927e02c` (lint cleanup) dismissed as done.

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
- ✅ **Deep audit 2026-07-01 — top 4 fixed** (C1 unauth OAuth routes, H7 open redirect, H4 last_meal_to_sleep_min NULL-vs-0, H5 hidden clinical-low breach; +13 tests; 4 HIGH / 14 MEDIUM / 17 LOW remain — see CLAUDE.md "Known bug backlog")
- → **Bug backlog (H1–H3, H6, M-tier) triage/fixes** OR **Withings weight extension** (small follow-on) — NEXT (Irfan's call on which)
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
**Irfan's call:** (a) continue the deep-audit backlog (CLAUDE.md "Known bug backlog" — C1/H4/H5/H7 done; H1–H3 + H6 next, then M-tier), or (b) **Withings weight extension** (small follow-on) — extend `adapters/withings/{api,index}.ts` + `app/api/refill/withings/route.ts` (gotcha #25 — they must agree) to request `meastype=1` and write `metric_type='weight'`, canonical `kg`. No new migration. Unblocks the Weight panel, Weight KPI, BP-vs-weight Correlation preset, and the weight drift signal.

~~**Also pending from this session (Irfan, manual):** re-run `migration_003` in Supabase to pick up the H4 fix.~~ — ✅ DONE 2026-07-01, Irfan confirmed the migration is run. (Not independently re-verified from this session — no live DB access here. Worth a spot-check next time the dashboard's open: `SELECT last_meal_to_sleep_min FROM daily_metrics WHERE date = CURRENT_DATE` should read NULL, not 0, for today.)

## Open items (non-blocking)
- **Deep-audit bug backlog (2026-07-01)** — 4 HIGH (H1, H2, H3, H6) / 14 MEDIUM / 17 LOW remain in CLAUDE.md "Known bug backlog" (C1/H4/H5/H7 fixed this session). H6 (stale CGM shown as live) is probably the next-sharpest for day-to-day trust in the dashboard.
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
