# Slice 7.1 — Trend Dashboard (baseline / single-source) — Build Spec

**Version:** 1.0
**Date:** 2026-06-19
**Prerequisites:** Slices 0–3 + 5 live (Whoop, Withings, manual, Nightscout CGM all populating `health_observations` / `bp_readings`).
**Promoted from:** `slice-7-dashboard-notes.md` + the working prototype.

---

## Overview

First real data-viz slice. Builds the **Dashboard tab** of the prototype against **real DB data**. The prototype's **Correlations tab** (Cardiac Readiness composite + the cross-source correlation views) is **Slice 7.2 — out of scope here**. The **medication-adherence panel is deferred** (no dose-logging data source exists yet — see Out of scope).

The hard problem in 7.1 is **not** the UI (it's already designed) — it's the **server-side daily-aggregation layer** that turns raw rows into the one-record-per-day shape the prototype consumes.

## Design source of truth — the prototype

The prototype is realized in `Health Dashboard.html` (a throwaway Claude Design bundle with **synthetic** data). Its readable source is extracted to **`prototype-src/`** — **port from there**, don't re-interpret:
- `01-icons.jsx` — inline lucide-style SVG icons.
- `02-data-layer.jsx` — **SYNTHETIC** seeded data. **Do not port the data; port its SHAPE.** Its `buildDailySeries()` output is the exact target the real aggregation layer must produce (field names + types below). Also contains the Cardiac Readiness formula → **7.2**.
- `03-components.jsx` — `Card`, `PanelHeader`, `KpiCard`, `SourceBadge`, `Timeline`, `SeverityDots`, `MedChecklist` (med one → deferred).
- `04-app.jsx` — app shell: header (greeting, recovery-day counter, 7/30/90 range toggle, theme toggle), the Dashboard-tab panel composition, and the calm status thresholds (`st.recovery/bp/glucose/sleep/rhr`) — **port these thresholds verbatim**.
- `06-charts.jsx` — **custom SVG chart primitives** (`Sparkline`, `TrendChart` w/ shaded bands + hover, `CGMChart`, `Donut`, `StackedBars`). **Port these — do NOT introduce recharts** (the pre-spec notes said recharts; the built prototype supersedes that with hand-rolled SVG that matches the design language).
- `05-connections.jsx` — Correlations tab → **7.2, ignore for now.**

**Design tokens (locked, from the prototype):** dark default + light toggle (no system follow); neutral base; accents teal `#00C896` (good/primary), purple `#9B59B6` (sleep/recovery), amber `#F59E0B` (caution), soft red (concern). Calm over alarming. shadcn `base-nova`, Tailwind v4 (`@theme` in `app/globals.css`), semantic tokens only (gotcha #1). Wire the prototype's CSS variables (`--teal`, `--purple`, `--amber`, `--red`, `--grid`, `--text-dim`, etc.) into `@theme`.

---

## The data / aggregation layer (the real work)

The prototype reads `D.daily` — an array of one object per day with **all** metrics merged. Build a server-side equivalent. **Aggregate in SQL/Postgres, not client-side** (CGM is ~288 rows/day).

### Target daily shape (per `02-data-layer.jsx`)
Per day (local **GST / UTC+4** calendar day): `{ date, sys, dia, pulse, weight, rhr, hrv, recovery, strain, fasting, glucoseVar, tir, sleep: { total, performance, stages: { light, deep, rem, awake } } }`. Any field may be null on days a source didn't report — panels must render gracefully around gaps.

### Per-field source + window
| Field | Source | Daily rule |
|---|---|---|
| `sys`, `dia`, `pulse` | `bp_readings` | **Morning reading**: first reading with `measured_at` 05:00–11:00 GST that day; if none, the day's earliest reading; null if no reading. |
| `weight` | `health_observations` `metric_type='weight'` (manual + Withings) | latest `canonical_value` (kg) that day; else carry-forward most recent ≤ day for the trend line. |
| `recovery`, `hrv`, `rhr`, `strain` | `health_observations` Whoop `daily_summary` metrics | the day's value (Whoop is already one-per-day). |
| `sleep.total`, `sleep.performance`, `sleep.stages.*` | Whoop sleep metrics | the night attributed to that day. |
| `fasting` | `glucose_cgm` | first reading 04:00–09:00 GST (first after the overnight gap); canonical mmol/L. |
| `glucoseVar` | `glucose_cgm` | stddev of the day's readings (mmol/L). |
| `tir` | `glucose_cgm` | % of the day's readings within 3.9–10.0 mmol/L. |

Implement as a **Postgres view `daily_metrics`** (or a SQL function) that LEFT JOINs the per-source daily aggregates on `date`, returning the shape above. The dashboard queries it server-side for the selected range (7/30/90 days).

### Supporting queries (not in the daily view)
- **Raw 24h CGM curve** for the Glucose panel: last ~24h of `glucose_cgm` ordered by `recorded_at` (≈288 points — fine to pull raw).
- **Latest values** for the "Today at a glance" KPI row: most recent of each metric (+ CGM latest + trend direction from the last few points).
- **Recent manual entries** for the timeline: last ~20 `manual` rows across `health_observations` + `bp_readings`, newest first (reuse Slice 3's `fetch-recent` pattern).

All reads are server-side, authenticated (session) — same guard as the dashboard/`/log` pages.

---

## Panels in 7.1 (Dashboard tab, port from `04-app.jsx`, minus med-adherence)

1. **Today at a glance** — KPI row: Recovery %, BP sys/dia, Glucose + trend arrow, Sleep (last night), Resting HR, Weight; each colour-coded via the `st.*` thresholds; sparklines from recent series.
2. **Cardiac panel (hero)** — BP trend (sys+dia, shaded healthy zones) + Resting HR + HRV (`TrendChart`).
3. **Glucose panel** — raw 24h CGM curve with 3.9–10.0 mmol/L target band; time-in-range `Donut`; latest reading + direction; mmol/L ⇄ mg/dL toggle (×18.0182).
4. **Recovery & sleep** — recovery trend + sleep-stages `StackedBars` (light/deep/REM/awake) + strain.
5. **Weight trend** — line over range.
6. **Activity / symptom timeline** — reverse-chron manual entries; red-flag symptoms surface the calm, non-blocking cardiologist reminder (reuse Slice 3 vocabulary + `RED_FLAG_REMINDER`).
7. **Quick-log entry** — segmented Weight · Glucose · BP · Symptom + always-visible note; submits via the existing Slice 3 server actions; optimistic prepend to the timeline. (Don't rebuild the write path — reuse `app/log/actions.ts`.)

Header: greeting + date + **recovery-day counter** (days since STEMI 2026-04-28), global **7d/30d/90d** range toggle, **theme** toggle. (The `Dashboard | Correlations` tab nav exists in the prototype — render the Correlations tab as a disabled/"coming in 7.2" stub or hide it.)

---

## Route & integration

Build the dashboard as the authenticated home view. The current `app/page.tsx` is the minimal post-Slice-1 dashboard (just `DiagnoseButton` + a "Quick log →" link). Replace its body with the real dashboard; keep `DiagnoseButton` reachable but demoted (e.g. a small "diagnostics" affordance or a `/diagnostics` route) so reconciliation tooling isn't lost. `/log` stays as-is (the dashboard's Quick-log reuses its actions).

---

## Decisions (resolved for this slice)

- **Custom SVG charts, not recharts.** Port `06-charts.jsx`. Supersedes the pre-spec note.
- **Med-adherence panel deferred.** It needs a dose-logging write path (a `medications` + `medication_log` feature — the data-model's deferred appendix item). Out of scope; the design reserves its slot. Build it as its own small slice later if wanted.
- **Cardiac Readiness composite → 7.2.** The formula is already defined transparently in `02-data-layer.jsx` (`READINESS_WEIGHTS` + `subScores`). When built in 7.2, keep the weighting documented, the per-input breakdown always visible, and label it explicitly as an interpretable heuristic — not medical advice.
- **Aggregation is server-side** (`daily_metrics` view), not client-side row-crunching.
- **Time-window definitions** as tabled above (morning BP 05:00–11:00 GST; fasting glucose first 04:00–09:00 GST reading; day = GST calendar day).

## Out of scope (later)

- **Slice 7.2 — Connections:** the Correlations tab — Correlation Explorer engine, the 5 cross-source views, the Cardiac Readiness composite, Pearson r + insight sentences, with the small-n honesty guardrails (min ~10 paired points before showing r; always show n; no causal language). Port `05-connections.jsx` then.
- Medication-adherence panel + dose logging.
- Doctor-record export view (later slice).

---

## Implementation steps

1. **Aggregation layer first:** write + apply the `daily_metrics` Postgres view (new migration) and a typed server-side data module that returns the daily shape + the supporting queries (24h CGM, latest values, recent manual entries). Verify the numbers against a hand-spot-check for a couple of days.
2. Port chart primitives (`06-charts.jsx`) and presentational components (`03-components.jsx`) into the app (semantic tokens; wire CSS vars into `@theme`).
3. Build the dashboard page + header + the 7 panels (`04-app.jsx` Dashboard tab), reading real data; port the `st.*` thresholds.
4. Wire Quick-log to the existing Slice 3 actions; reuse the timeline/recent-entries fetch.
5. Range toggle (7/30/90) + glucose unit toggle + theme toggle.
6. Demote `DiagnoseButton`; keep it reachable.
7. `npm run build` clean.
8. (MANUAL — Irfan) Deploy; eyeball each panel against real data; sanity-check the aggregation (e.g. a known day's BP/TIR).

## Acceptance criteria

- [ ] `daily_metrics` view returns the documented shape; nulls handled where a source is missing
- [ ] All 7 panels render from **real** DB data (no synthetic data anywhere)
- [ ] KPI statuses use the prototype's `st.*` thresholds; glucose band 3.9–10.0 mmol/L
- [ ] Glucose panel shows the real 24h CGM curve + correct time-in-range; mmol/L⇄mg/dL toggle correct
- [ ] Range toggle (7/30/90) reshapes every time-series panel
- [ ] Quick-log writes via Slice 3 actions and appears in the timeline
- [ ] Red-flag symptoms show the calm cardiologist reminder
- [ ] CGM aggregation done in SQL, not client-side
- [ ] Charts are the ported SVG primitives (no recharts dependency added)
- [ ] Dashboard is session-protected; `npm run build` clean

---

*End of Slice 7.1 spec. Next: 7.2 — Connections (Correlation Explorer + cross-source views + Cardiac Readiness), porting `prototype-src/05-connections.jsx`.*
