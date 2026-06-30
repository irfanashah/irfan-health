# Project State — Irfan's Health Platform

_Last updated: 2026-06-30 (session: Correlations tab revamp — lagged-association engine with FDR + detrend + autocorrelation correction + curated/optional-LLM confounder layer; VAR/LMM documented as Phase 2)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Correlations tab now runs a real engine** — the old raw same-day Pearson explorer is replaced with a lagged cross-correlation **discovery scan** (`connections/engine.ts`) + a rebuilt manual Explorer. Pipeline: detrend each metric (21-day rolling-median residual — kills the shared-post-STEMI-trend confounding) → mask med-change reset windows + `context_periods(exclude_from_baseline)` BEFORE pairing → Spearman+Pearson at lags 0..3 in both directions → Fisher-z CI/p on **autocorrelation-corrected n_eff** (Bartlett-style — serial-dependence in daily health metrics otherwise inflates significance) → Benjamini–Hochberg FDR across the whole test family → gate (`q≤0.10 ∧ |rS|≥0.3 ∧ nEff≥12`) → suppress 20+ DERIVED_PAIRS (recovery↔hrv/rhr/sleep_*, sys↔dia, etc.) → rank by `|rS|×(1−q)`. Each surfaced card shows the associational sentence ("Higher X tended to precede higher Y next-day…"), stats, dual-axis overlay at the best lag, AND a **"Could this be something else?"** expand with a curated confounder list (split measured/unmeasured + "consider logging" pointers — diet, alcohol, stress, illness, newborn night-wakings) + an OPTIONAL Haiku LLM expand for "what else could explain this?" (hidden when `ANTHROPIC_API_KEY` is unset). Rebuilt Explorer has a cross-correlation lag profile, scatter at the selected lag, detrended/raw toggle, Spearman+Pearson side-by-side, and a **partial-correlation toggle** (control for strain / day-of-week, n-gated ≥20, Explorer-only — NOT in the discovery gate because semipartial at small n is df-unstable). `SleepCascade` + `ActivityPacing` panels retired (subsumed by the engine); Cardiac Readiness + Annotated Glucose kept untouched. Standing honesty banner: "Hypotheses to discuss with Dr. Jose, not findings, not causal, not diagnostic." Engine fetches 365 days (dashboard still slices to 7/30/90 client-side). No migration. **VAR / state-space / LMM / n-of-1-experiment documented as Phase 2** — at current n they'd overfit and tempt causal claims; the right tools come online with a Python compute path + 6–12 months of dense multivariate data. `npm run build` clean — still 32 routes.

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
1. **Deploy + visit the Correlations tab.** `Connections found` will likely show the empty state ("Nothing has cleared the evidence bar yet — the engine refusing to cry wolf, not a bug"). At current data depth that's expected: ~5 Oxylink nights, intermittent BP, sparse weight — very few pair × lag combinations have n_eff ≥ 12 (the autocorrelation-corrected minimum). Confirm the empty state reads honestly (no fake numbers). Open the **rebuilt Explorer** below; try `Sleep hours → Fasting glucose` with the lag profile + detrended toggle to feel the new UX.
2. After Vercel deploys, manually fire both crons from your browser console while logged in (or via `curl -H "Authorization: Bearer $CRON_SECRET"`):
   - `GET /api/cron/health-check` → expect JSON `{ok:true, checked:[whoop,withings,nightscout], stale:[…], emailed:true|false}`. With healthy crons, `emailed:false, reason:'all-healthy'` is correct. To force-test the email, temporarily set one of the staleHours thresholds to `0.001` in `pipeline-health.ts`, fire the cron, then revert.
   - `GET /api/cron/adherence-reminder` → if today's `med_adherence` row is missing, expect `emailed:true` + a nudge in your inbox. If you already tapped today, expect `logged:true, emailed:false`.
3. Verify the **Pipeline health** table renders at the top of `/diagnostics` with the three sources, last success in GST, and an "ok" badge on each (assuming all crons are happy).
4. Once green, the next slot is the **Withings weight extension** — extend `adapters/withings/{api,index}.ts` + `app/api/refill/withings/route.ts` (gotcha #25 — they must agree) to request `meastype=1` and write `metric_type='weight'`, canonical `kg`. No new migration. Unblocks the Weight panel, Weight KPI, BP-vs-weight Correlation preset, and the weight drift signal.

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
