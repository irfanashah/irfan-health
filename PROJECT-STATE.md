# Project State — Irfan's Health Platform

_Last updated: 2026-06-26 (session: labs UI split — `/labs` = import only; dashboard 4th tab "Labs" = data viz)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

Labs UI split per Irfan's principle: `/labs` collapsed to the import tool only (upload → review → commit); the dashboard gains a **fourth top-level tab "Labs"** rendering the imported-panels list + key-marker trend cards in dashboard palette alongside the other health signals. UI + wiring only — no data-model / migration / extraction change. The split means the import flow stays focused (no charts cluttering the upload + review) AND the data viz lives where the user actually goes to read their health data. `npm run build` clean — 28 routes; `app/labs/PanelsList.tsx` + `MarkerTrends.tsx` deleted; `labs.css` trimmed to the upload/review styles only; the tab uses dashboard tokens throughout.

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
- ✅ **Labs UI split — `/labs` = import tool only; dashboard 4th tab "Labs" = data viz**
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold; lab markers as drift metrics; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).

## Next action
**No migrations / no env changes** — UI + wiring only.
1. After the push lands, open `/` — the dashboard nav should now show four tabs (Dashboard · Correlations · Baselines & drift · Labs). Click **Labs** → expect the imported-panels list at the top (chronological, expandable to markers, out-of-range highlighting + `standard` provenance badges where the range came from the remembered store) + one trend card per cardiac key marker (LDL / HDL / non-HDL / triglycerides / Lp(a) / ApoB / hs-CRP / HbA1c / fasting glucose) with ref-band shading + flagged points + sparse-data-safe rendering, plus a picker card for any non-key marker with ≥2 draws.
2. Open `/labs` → confirm it's now just the import tool (upload form + the review draft if you're mid-import) with a "See your labs in the dashboard →" link at the bottom.
3. Once green, the next slot is the **Withings weight extension**.

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
