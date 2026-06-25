# Project State — Irfan's Health Platform

_Last updated: 2026-06-25 (session: Slice 6 — Labs PDF import + LLM extraction + human review + Labs section with key-marker trends)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Slice 6 (the biggest on the platform) ships. New `/labs` flow: upload a PDF → hybrid extraction (text-layer-first via `unpdf` → exact text to Anthropic with strict "do NOT alter/round/infer" prompt; vision fallback for scanned PDFs) → editable draft review → confirm → write to `lab_panels` + `lab_values` + persist learned `raw_marker_name → marker_slug` aliases to `lab_marker_aliases`. **Format-agnostic by design** (no Fakeeh hard-coding — the LLM prompt makes no layout assumptions; the alias table makes the importer get smarter per-source over time). Curated cardiac-first marker registry handles canonical conversions deterministically (cholesterol mg/dL↔mmol/L, glucose ÷18, etc.); unknown units flag in UI, never guess. `/labs` section renders the panels list (chronological, expandable, out-of-range highlighted) + key-marker trend charts (LDL/HDL/non-HDL/triglycerides/Lp(a)/ApoB/hs-CRP/HbA1c/fasting glucose + picker for any ≥2-draw marker). `npm run build` clean — 28 routes (+`/labs`). New deps: `@anthropic-ai/sdk`, `unpdf`.

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
- ✅ **Slice 6 — Labs PDF import (LLM extraction + human review + Labs section with trends)**
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold; lab markers as drift metrics; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).

## Next action
**In order:**
1. **Set `ANTHROPIC_API_KEY`** in Vercel env vars (and add to `.env.local` for local dev). Without this, the upload route shows a clear error.
2. **Run `migration_008_labs.sql`** in Supabase (seeds `labs` source + creates `lab_marker_aliases` + RLS).
3. **Create the `lab-reports` Storage bucket** in Supabase Studio → Storage → New bucket. Name: `lab-reports`, public: false, file-size limit: 25 MB.
4. **Test the flow:** open `/labs`, upload `lab-reports/lab_report_pdf.pdf` (the Fakeeh electrolyte panel). Expect: draft tagged `text` path, 4 markers (sodium, potassium, chloride, bicarbonate), sodium flagged `L` (133 vs 136–145). Review + commit. Verify in Supabase: 1 row in `lab_panels`, 4 in `lab_values`, ~4 in `lab_marker_aliases`. Panels list shows the new panel. Trends section is still empty (electrolytes aren't key cardiac markers — upload a lipid panel next to populate the curated charts).
5. **Upload a second report from a different lab** (whenever one's available) to validate the format-agnostic design + alias learning across sources.
6. Once green, the next slot is the **Withings weight extension**.

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
