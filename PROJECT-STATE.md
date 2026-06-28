# Project State — Irfan's Health Platform

_Last updated: 2026-06-28 (session: lab markers — clinical-target tracking. 8 cardiac targets + evaluateLabMarker + Lp(a) reported-value fix; surfaces on /report page-1 + Labs tab)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Cardiac labs now answer "am I at goal?"** — `app/labs/_lib/targets.ts` holds 8 guideline-based targets for a very-high-risk secondary-prevention patient (LDL · non-HDL · ApoB · triglycerides · Lp(a) · hs-CRP · HbA1c · HDL), all provisional pending Dr. Jose. `evaluateLabMarker()` returns goal-state (at-goal / near / off-goal) + toward-goal trend + LDL % reduction from baseline. The doctor report's page-1 cardiac labs table now shows a Target column + at-goal status pill + arrow + LDL reduction line + provisional footnote. The dashboard's Labs tab gains a top-of-page "Cardiac labs vs target" summary strip + per-card goal divider line (or shaded at-goal/watch band for hba1c) + goal-state pill + trend arrow + "informational — not therapy-modifiable" badge on Lp(a)/HDL. **Lp(a) is no longer silently dropped** — `fetchAllMarkerTrends()` falls back to the reported value (mg/dL or nmol/L) for registered no-canonical markers; the evaluator unit-matches against the right threshold (50 mg/dL ≈ 125 nmol/L), else `goalState: null` + a "unit not matched" note (gotcha #90: never coerce assay-dependent units). Doctor report (gotcha #105) and dashboard tab agree by construction — same `evaluateLabMarker` everywhere. **NO new migration, NO drift-engine change.** `npm run build` clean — still 30 routes.

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
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold + lab targets; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).

## Next action
1. Deploy + visually verify the cardiac-targets surface. **Doctor report → /report**: page-1 cardiac labs table should show a Target column with at-goal/near/off pills + arrow; LDL row gets a `↓ X% from baseline` line; Lp(a) shows the `info` chip; provisional footnote below the table. **Labs tab**: top summary strip "N at goal · N near · N off · N not drawn"; each key-marker card shows a dashed `goal` line (lipids, hs-CRP, HDL) or shaded at-goal+watch bands (hba1c); Lp(a) + HDL cards have the "informational — not therapy-modifiable" badge.
2. Confirm Lp(a) appears in the Labs tab now (it was silently absent before — `fetchAllMarkerTrends` was filtering on `canonical_value` and Lp(a)'s canonical is null because mg/dL↔nmol/L is assay-dependent).
3. After Dr. Jose visit, **replace provisional targets** in `app/labs/_lib/targets.ts::LAB_TARGETS` with whatever he confirms. Same `LAB_TARGET_PROVISIONAL_NOTE` pattern as the drift floors — switch the wording to a "confirmed with Dr. Jose 2026-XX-XX" line rather than removing the disclaimer entirely (gotcha #109).
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
- No cron failure alerting.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- CLAUDE.md cleanup carry-over — "two stale Slice 4 parked lines (~99 + ~251)" — still couldn't locate them.
