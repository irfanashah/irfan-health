# Doctor-Record Export — Build Spec

**Version:** 1.0
**Date:** 2026-06-25
**Status:** A printable **doctor record** — a one-page cardiac snapshot for Dr. Jose (the "everything in 10 seconds" sheet) followed by detail/appendix pages. The payoff of the platform: one coherent, shareable view for cardiology appointments. Reads existing data (daily_metrics, bp_readings, lab_panels/lab_values, the drift engine) — **no new health data**.
**Audience:** a cardiologist (Dr. Jose / Dr. Fekry). Tone: clinical, dense, scannable.

---

## Decision 1 — Output mechanism: in-app print view → PDF (recommended)
A new **`/report` route** (auth-guarded) renders a **print-optimized** multi-page view; Irfan hits the browser's Print → Save as PDF. The page uses print CSS (`@media print`, `page-break-before` per section, hidden nav/chrome) so the browser handles pagination cleanly. No PDF-generation library (react-pdf/puppeteer are heavier + Vercel-finicky). Regenerate any time before an appointment. A "Doctor report" link from the dashboard header opens it. (If you later want a one-click server-generated PDF download, that's a follow-on — print-view is the pragmatic v1.)

## Decision 2 — Medications source (the one data gap — needs your call)
Meds aren't tracked in the platform yet, but the current regimen is essential on a cardiology record. Recommended: a **small editable medications list** (a `medications` table + a tiny maintain-it form, or a config the user edits), seeded with the known regimen — Concor 5mg (bisoprolol), Crestor 40mg (rosuvastatin), Brilinta 90mg (ticagrelor, BD), Ezetrol 10mg (ezetimibe), Tritace 10mg (ramipril), Aspirin Protect 100mg, Pantozol 40mg. The report reads it; you update it when meds change. (Alternatives: hardcode the list in config v1, or leave a blank meds box to hand-write — flag your preference. A maintainable list is the durable choice and reusable elsewhere later.)

## Page 1 — Cardiac snapshot (the 10-second page)
- **Header:** name, age/sex, **cardiac history** (STEMI 2026-04-28 — 100% LCx/OM1 occlusion, DES; elective LAD balloon angioplasty 2026-05-13; EF 55%), report generated date + data window. NKDA.
- **Current medications** (from Decision 2) — compact list with dose + frequency.
- **Blood pressure:** latest reading + **ACC/AHA category** (`bpCategory`), a small sys/dia trend sparkline, and the recent range.
- **Heart rate / HRV:** latest resting HR + HRV, small trend.
- **Cardiac labs** (the centerpiece — a compact table): LDL, HDL, non-HDL, triglycerides, **Lp(a)**, ApoB, **hs-CRP**, **HbA1c** — each with latest value + unit, reference range (+ provenance), flag (H/L), and a direction arrow / mini-trend vs the prior draw. (Markers Irfan has; others omitted gracefully.)
- **Overnight oxygen:** SpO2 avg + min + **ODI** (screening-grade tag).
- **Notable drift:** any "worth a look" / safety items the baseline engine is currently flagging (RHR/HRV/BP/SpO2/etc.) — a one-line each, or "nothing drifting."
- **Footer:** "Patient-tracked data, screening-grade, not diagnostic" + the device sources.

## Detail / appendix pages (page-break each)
- **Full lab history:** all panels chronologically + per-key-marker trend charts (the Labs-tab content, print-styled), with provenance on ranges.
- **Cardiac trends:** BP over the window (with the ACC/AHA zones), RHR + HRV over time.
- **Glucose:** time-in-range, fasting, recent CGM/fingerstick trend.
- **Sleep & recovery + overnight oxygen detail:** sleep stages, recovery, HRV; SpO2 curve + ODI / time-below-90 detail.
- **Baselines & drift:** the full per-signal drift summary.
- (Trim any of these — flag which to include/drop.)

## Data & implementation
- Reuse the dashboard's existing server readers (daily_metrics, BP, labs `fetchAllPanels`/`fetchAllMarkerTrends`, the drift `evaluate` + `present` layer, latest KPIs). Assemble in the `/report` server component; render with the dashboard's components where they suit print (custom-SVG charts print fine), restyled for print (light background, page breaks, no interactivity).
- `bpCategory` for the BP category; the labs provenance/flag logic as-is.
- Window: vitals/glucose/sleep over a sensible default (e.g. last 90 days, or a selectable range); labs over **all** draws.
- Print CSS: `@page` margins, `page-break-before: always` per detail section, hide header/nav, ensure charts/tables don't split awkwardly.

## Decisions (RESOLVED 2026-06-25)
1. **Output:** print-view → PDF (in-app `/report` route, browser print). ✅
2. **Meds:** **editable medications list** (small table + maintain form, seeded with the regimen). ✅
3. **Detail pages:** the full set above (labs history+trends, cardiac trends, glucose, sleep/recovery/O2, drift). ✅
4. **Window:** vitals/glucose/sleep default **last 90 days** (selectable later); labs = all draws. ✅

## Out of scope
- Server-generated PDF / email-to-doctor (follow-on). Med-adherence tracking (separate). Editable free-text clinician notes on the report (could add later).

## Implementation steps
1. (If meds = editable list) `medications` table + a small maintain form, seeded.
2. `/report` route (auth-guarded) + a "Doctor report" header link.
3. Page-1 snapshot component (header, meds, BP+category, HR/HRV, cardiac-labs table, overnight O2, drift flags, footer).
4. Detail-page components (labs history + trends, cardiac trends, glucose, sleep/recovery/O2, drift) with `page-break-before`.
5. Print CSS (`@media print`, `@page`, hide chrome, pagination).
6. `npm run build` clean.
7. (Irfan) open `/report` → Print → Save as PDF; sanity-check it reads well on paper.

## Acceptance criteria
- [ ] `/report` renders a print-optimized doctor record: page 1 = cardiac snapshot (history, meds, BP+ACC/AHA category, HR/HRV, cardiac-labs table with flags+trend, overnight O2, drift flags, disclaimer)
- [ ] Detail pages follow (labs history+trends, cardiac trends, glucose, sleep/recovery/O2, drift), each on its own page via print CSS
- [ ] Reads existing data only; no new health data; `bpCategory` + labs provenance reused
- [ ] Meds rendered from the chosen source (editable list recommended)
- [ ] Prints cleanly to PDF (page breaks, no awkward splits, no app chrome); `npm run build` clean

---

*End of spec. Decisions 1–4 (output, meds source, detail-page set, window) for your call — meds is the only real data gap. Reads everything else that's already in the platform.*
