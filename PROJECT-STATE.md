# Project State — Irfan's Health Platform

_Last updated: 2026-06-26 (session: labs marker-system maturation — auto-canonicals + AI-proposed ranges + computed flags + remembered-range store)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Labs marker layer matured from "curated cardiac list, everything else unmapped, ranges only when the lab prints them" to **"every marker becomes a trendable canonical, with a reference range and a flag — AI-proposed where the source omits them, user-confirmed at commit, then remembered"**. Surfaced by the discharge-summary upload (many markers came back `unmapped`, no ranges, empty flags). New `lab_marker_ref_ranges` learn-as-you-go store + `lab_values.ref_source` provenance column. SACRED guardrail held: measured RESULT values are NEVER altered — the AI only proposes CONTEXT (canonical slug, standard ranges, computed flag), labelled explicitly. Confirmed knowledge (aliases + remembered ranges) overlays the LLM proposals in code, so repeated panels are deterministic + the AI is only consulted on genuinely-new markers. Same learn-as-you-go pattern as the existing alias table.

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
- ✅ **Labs marker-system maturation — auto-canonicals + AI-proposed ranges + computed flags + remembered-range store**
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold; lab markers as drift metrics; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).

## Next action
**One migration to run, then re-test the discharge summary.**
1. **Run `migration_009_labs_ref_ranges.sql`** in Supabase (creates `lab_marker_ref_ranges` + adds `lab_values.ref_source` column + RLS + CHECK constraint). Idempotent.
2. **Re-upload `dischargesummary1_pdf.pdf`** at `/labs`. Expect: every previously-`unmapped` marker now gets a `+ Create` slug suggestion (e.g. `neutrophils_pct` for "NEUTROPHILS %") + merge candidates (e.g. existing `neutrophils_pct` if it's in the registry); proposed ranges + computed H/L/N flags pre-filled with `proposed` provenance badges. Review (edit/merge where wrong) + commit → standard ranges persist to `lab_marker_ref_ranges`.
3. **Re-upload the Fakeeh report.** Expect: its printed ranges/flags win (`from report` badge) — even for markers where you committed a standard from the discharge summary; the lab is authoritative for its own draw. The remembered standards still apply on the NEXT discharge-summary-style upload that omits ranges.
4. **Eyeball `/labs` trends.** Once you've committed ≥2 panels with overlapping key markers (HbA1c, LDL, etc.), the curated cardiac trends populate. Trend cards now badge `standard band` when the normal-band shading comes from a confirmed standard rather than a lab print.
5. Once green, the next slot is the **Withings weight extension**.

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
