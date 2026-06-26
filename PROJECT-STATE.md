# Project State — Irfan's Health Platform

_Last updated: 2026-06-26 (session: printable doctor record — /report + editable medications list)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**The platform payoff** — `/report` ships: a printable doctor record (browser print → Save as PDF, no PDF library). Page 1 is the 10-second cardiac snapshot (header with STEMI + LAD + EF history → current meds → BP + ACC/AHA category + sparkline → RHR/HRV → cardiac labs table with flags + Δ-vs-prior arrows → overnight oxygen + notable drift bullets → disclaimer). Detail pages follow on their own sheets via `@page A4` + `page-break-before: always`: cardiac trends · glucose · sleep & overnight O2 · full lab history · per-marker lab trend grid · baselines & drift summary. Reads existing data only via the dashboard's readers — the one new piece is the **editable medications list** (`migration_010` + `/medications` page + 7 seeded current meds, deactivate-not-delete). `bpCategory` + `buildDriftPanelData` reused so the report agrees with the dashboard by construction. `npm run build` clean — 30 routes (`/medications` + `/report` added).

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
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold; lab markers as drift metrics; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).

## Next action
1. **Run `migration_010_medications.sql`** in Supabase — creates the `medications` table + RLS + seeds your current 7-med regimen (Concor / Crestor / Brilinta / Ezetrol / Tritace / Aspirin Protect / Pantozol). Idempotent.
2. After the deploy, hit **Doctor report** in the dashboard header → opens `/report` → click "Print / Save as PDF" → expect ~5–6 A4 pages: page 1 = cardiac snapshot; then cardiac trends · glucose · sleep & overnight O2 · lab history · per-marker lab trends · baselines & drift summary.
3. Verify it reads well on paper before the next Dr. Jose appointment. If a med has changed in the meantime, edit it at `/medications` (Meds link in the header) — `active=false` for stopped meds, the report only shows active.
4. Once green, the next slot is the **Withings weight extension**.

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
