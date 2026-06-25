# Project State — Irfan's Health Platform

_Last updated: 2026-06-26 (session: labs large-file upload fix — direct-to-Storage + mixed-document prompt)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
`/labs` upload was failing on PDFs > 1 MB (the STEMI discharge summary at 2.05 MB returned a bare 404). **Root cause confirmed:** the original `uploadAndExtract(formData)` routed file bytes through a Next.js server action, which silently caps request bodies at 1 MB (Vercel additionally caps full requests at ~4.5 MB). Durable fix shipped: **direct-to-browser-to-Storage upload** in two steps — `createLabUploadUrl(filename)` server action returns a signed Storage URL; browser uploads to Storage; `extractFromStorage(path)` server action downloads + extracts. File bytes never traverse a server action. Bypasses BOTH the 1 MB and ~4.5 MB limits — handles any realistic lab/discharge PDF up to the bucket's 25 MB cap. Also: `maxDuration=800` on the `/labs` segment (extract inherits); `SYSTEM_PROMPT` broadened for mixed clinical documents (discharge summaries / consult notes with labs embedded among narrative — extract labs, ignore non-lab content, surface ambiguous draw dates); `max_tokens` raised to 16k + truncation guard. No schema / alias / commit / trends change.

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
- ✅ **Labs large-file fix — direct-to-Storage upload + mixed-document prompt**
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold; lab markers as drift metrics; doctor-record export; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).

## Next action
**No new migrations / no env changes.** Re-upload the 2 MB `dischargesummary1_pdf.pdf` at `/labs` after the push lands:
1. Should upload (direct-to-Storage; no 404).
2. Should extract embedded admission labs from the discharge summary narrative (troponin / CK-MB / hemogram / lipid panel / chemistries — whatever the STEMI workup printed).
3. Should reach the review draft with `dateAmbiguous: true` if the document doesn't clearly distinguish the lab collection date from the admission/discharge dates.
4. Review + commit. Verify rows land in `lab_panels` + `lab_values` and the cardiac key-marker trends populate (LDL / HDL / triglycerides etc. if the STEMI workup included a lipid panel).
5. The existing Fakeeh single-panel uploads continue to work identically (small files go through the same two-step flow, no regression).
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
