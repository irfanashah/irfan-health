# Project State — Irfan's Health Platform

_Last updated: 2026-06-28 (session: medication adherence — daily one-tap confirm. migration_011 + dashboard panel + /medications heat-strip + /report self-reported line; honest two-number math)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Daily one-tap medication adherence shipped** — `migration_011_med_adherence` (day-PK table, tri-state `taken`/`skipped`/`cleared`) + a compact `MedAdherencePanel` on the dashboard right after Today-at-a-glance (big "✓ Took today's meds" button + streak + last-7-days dot strip) + an adherence history section on `/medications` (30-day heat-strip + the two honest numbers) + a self-reported line on `/report` page 1 right under current medications. The clinical point: DAPT (Brilinta) adherence post-stent is what the cardiologist actually acts on; near-zero friction is the only way it gets used. **Honesty rules baked in:** unknown ≠ missed (the two numbers — `adherencePctOfLogged` and `coveragePct` — stay separate, never collapse); the doctor sees "98% of logged days taken · logged 71 of 90", not "78% adherence". GST today computed in TS as `Date.now() + 4h` (Dubai = fixed UTC+4, no DST). Undo writes `status='cleared'`, never deletes (gotcha #103 family → new #117). **Last week's lab-targets surface still live:** `evaluateLabMarker` continues to drive report + Labs tab. `npm run build` clean — still 30 routes.

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
1. **Run `migration_011_med_adherence.sql`** in Supabase — creates the new `med_adherence` table + RLS. Idempotent, no seed.
2. After Vercel deploys, tap **✓ Took today's meds** on the dashboard. Expect: panel switches to "Logged for today · Undo"; streak = 1; the rightmost dot in the 7-day strip fills teal. Refresh `/medications`: 30-day heat-strip shows one teal cell on today + 29 hollow; "100% of logged days taken / coverage 100% / streak 1". Refresh `/report`: page-1 line under meds reads "Self-reported adherence: 100% of logged days taken · logged 1 of 1 days over the last 90 days · current streak 1 day."
3. Tap **Undo** to verify the never-delete contract: state reverts to unknown; in Supabase the row still exists with `status='cleared'`, never deleted.
4. (Optional follow-on flagged in the spec) Add a daily morning reminder via the scheduled-tasks system to lift coverage — separate slice if wanted.
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
- No cron failure alerting.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- CLAUDE.md cleanup carry-over — "two stale Slice 4 parked lines (~99 + ~251)" — still couldn't locate them.
