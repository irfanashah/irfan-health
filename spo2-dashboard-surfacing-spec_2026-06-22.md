# SpO2 Dashboard Surfacing — Build Spec

**Version:** 1.0
**Date:** 2026-06-22
**Status:** Follow-on to Slice 4 (file-drop ingestion). Surfaces the overnight SpO2 data already in `health_observations` (`source_slug='oxylink_csv'`, `metric_type ∈ {spo2_overnight_avg, spo2_overnight_min}`, `data_shape='daily_summary'`). Deferred deliberately from Slice 4, which was ingestion-only.
**Prerequisites:** Slices 4, 7.1, 7.3 live. Oxylink rows already ingested (10 rows / 5 nights verified 2026-06-22).
**Scope (3 confirmed decisions):** (1) Display **+** drift — both a dashboard surface AND drift-engine integration. (2) Display surface = a **card inside the existing Recovery & Sleep panel** (overnight SpO2 is sleep-time data). (3) The drift engine watches **both overnight-avg and overnight-min**, concerning direction = **down**.

---

## Overview

Two changes, one slice:
1. **Display** — a compact SpO2 section inside `RecoverySleepPanel`: overnight-avg + overnight-min trend (two series, target band shaded), plus a "last night" status readout. Reads the `daily_metrics` view (extended) — no new query layer.
2. **Drift** — SpO2 becomes the **9th and 10th drift metrics** (`spo2_avg`, `spo2_min`) so the Slice 7.3 baseline engine watches nocturnal desaturation as a slow-drift signal. Wired through the existing generic machinery (the `metric_drift` view, `evaluate.ts`, `BaselinesDriftPanel`, `baselines.ts` all iterate `DRIFT_METRICS`).

**No new tables.** Both Postgres views are `CREATE OR REPLACE`. The work is additive.

## Attribution (load-bearing)

SpO2 attributes to **`period_end` GST date = wake-day**, identical to Whoop daily-summary attribution (and to the Slice-4 `source_record_id` wake-day rule). So a given night's SpO2 lands on the **same `daily_metrics` row** as that night's recovery/sleep — they line up. Use `(period_end AT TIME ZONE 'Asia/Dubai')::date`, exactly as `whoop_daily` does. Both rows per night (avg + min) share the same `period_end`, so a `GROUP BY` with `MAX(...) FILTER (WHERE metric_type = ...)` collapses them cleanly (mirror the `whoop_daily` CTE pattern).

---

## Changes — file by file

### 1. `migration_003_daily_metrics_view.sql` (CREATE OR REPLACE)
- Add a `spo2_daily` CTE (model on `whoop_daily`):
  ```sql
  spo2_daily AS (
    SELECT
      (period_end AT TIME ZONE 'Asia/Dubai')::date AS date,
      MAX(canonical_value) FILTER (WHERE metric_type = 'spo2_overnight_avg') AS spo2_avg,
      MAX(canonical_value) FILTER (WHERE metric_type = 'spo2_overnight_min') AS spo2_min
    FROM health_observations
    WHERE source_slug = 'oxylink_csv'
      AND data_shape  = 'daily_summary'
      AND period_end IS NOT NULL
      AND metric_type IN ('spo2_overnight_avg','spo2_overnight_min')
    GROUP BY (period_end AT TIME ZONE 'Asia/Dubai')::date
  )
  ```
- Add `sp.spo2_avg, sp.spo2_min` to the final SELECT list and `LEFT JOIN spo2_daily sp ON sp.date = ds.date`.
- Update the header comment block with the two new fields (source = `oxylink_csv`, wake-day attribution, unit `%`).

### 2. `migration_004_baselines_drift.sql` (CREATE OR REPLACE — the `metric_drift` view only)
- In the `long_form` CTE, add two `UNION ALL` lines:
  ```sql
  UNION ALL SELECT date, 'spo2_avg', spo2_avg::numeric FROM daily_metrics WHERE spo2_avg IS NOT NULL
  UNION ALL SELECT date, 'spo2_min', spo2_min::numeric FROM daily_metrics WHERE spo2_min IS NOT NULL
  ```
- Nothing else in the view changes — windows, medians, MAD, and the gate-input columns are metric-generic. Update the "8 v1 metrics" comment to "10 metrics".

### 3. `app/lib/dashboard/daily-metrics.ts`
- Add `spo2_avg: number | null` and `spo2_min: number | null` to `DailyMetricRow`.
- Add both to `mapDailyRow` (via the `n()` coercion — gotcha #8) and to the `.select(...)` column string in `fetchDailyMetrics`.
- Extend `LatestKpis` with `spo2: { avg: number; min: number; at: string } | null` and populate it in `fetchLatestKpis` (latest `period_end` night). Simplest: one helper reading the two latest `oxylink_csv` rows by `period_end DESC`, or a small dedicated query returning avg+min+`period_end` for the most recent night. Use `period_end` as the timestamp (these rows have no `recorded_at`).

### 4. `components/dashboard/drift-config.ts`
- Extend `DriftMetricId` union with `'spo2_avg' | 'spo2_min'`.
- Add two `DRIFT_CONFIG` entries (provisional numbers — see "Thresholds" below).
- Append both to the `DRIFT_METRICS` array. **This is what auto-propagates SpO2 into `baselines.ts`, `evaluate.ts`, `BaselinesDriftPanel`, and the `/baselines` med-change chip list.**

### 5. `components/dashboard/thresholds.ts`
- **Add `st.spo2(v)`** calm display-band status (for the card): `>= 94 → good`, `90–93 → watch`, `< 90 → concern`, `null → neutral`. (Display-only calm band; not medical advice — same disclaimer as the other `st.*`.)
- **Add SpO2 to `LOW_FLOORS`** (SpO2 is inherently a low-side metric — concerning = down — so it fits the low-floor pattern exactly, like `rhr`/`sys`/`dia`). Provisional numbers (see below).
- **Widen the `LOW_FLOORS` key type** from `'rhr' | 'sys' | 'dia'` to include `'spo2_avg' | 'spo2_min'`. **Recommended cleanup:** retype `LOW_FLOORS` as `Partial<Record<DriftMetricId, LowFloor>>` and **delete the three `as 'rhr' | 'sys' | 'dia'` casts** in `evaluate.ts` (×2) and `BaselinesDriftPanel.tsx` (×1) — they exist only because the map was narrowly typed. This is the single non-automatic wiring step; if the casts aren't widened/removed, SpO2's clinical floor silently won't be looked up.

### 6. `components/dashboard/panels/RecoverySleepPanel.tsx`
- Append a SpO2 section below the sleep-stages block (or between recovery and sleep — builder's call, keep the panel readable):
  - `chart-caption sm`: "Overnight SpO2" + `{rangeDays}-day trend`.
  - A `TrendChart` (the existing custom-SVG component — **not** recharts) with **two series**: `spo2_avg` (solid) and `spo2_min` (lighter/dashed), null-aware so gaps break the line. `yDomain` roughly `[85, 100]`. Shade the normal band (≥95) the way the glucose chart shades its target band.
  - A small "last night" readout from `latest.spo2` (avg + min) with the `st.spo2` status dot.
  - Empty state ("No SpO2 data in this window") when the series has no SpO2 — match the recovery empty-note pattern.
- Source badge: this card's data is Oxylink, not Whoop — either add a small per-card source tag or note it in the caption so the panel's Whoop badge isn't misattributed.

### 7. Verify auto-propagation (no code expected, but confirm)
- `baselines.ts::fetchMetricDrift` — `.select('*')` + groups on `DRIFT_METRICS.includes(...)`; confirm the `grouped` initialiser is built from `DRIFT_METRICS` (so the two new keys appear). If it's a hand-written object literal, add the two keys.
- `BaselinesDriftPanel` maps `DRIFT_METRICS` — SpO2 rows render automatically (tier pill + clinical-low pill once the floor type is widened).
- `/baselines` med-change chips map `DRIFT_METRICS` — SpO2 will appear as a selectable affected-metric. Harmless; leave it.

---

## Thresholds — ALL PROVISIONAL, pending Dr. Jose

Following the established Slice 7.3 pattern (a real number on day one, never null; flagged provisional; the `LOW_FLOOR_PROVISIONAL_NOTE` already renders on the panel).

**Drift config (`DRIFT_CONFIG`):**

| metric | concerning | acknowledgeGood | absFloor | zFloor | minNShort | minNPrior | M |
|---|---|---|---|---|---|---|---|
| `spo2_avg` | down | **false** | 1.5 (%) | 1.0 | 5 | 12 | 7 |
| `spo2_min` | down | **false** | 3.0 (%) | 1.0 | 5 | 12 | 7 |

- `unit: '%'`, `shortWindowDays: 7`, `rollingWindowDays: 28` (match the daily-cadence metrics).
- **`acknowledgeGood: false` for both** — provisional, and flagged like RHR. Rationale: SpO2 is bounded at 100 and Irfan already sits high; upward drift near the ceiling isn't a physiological "win" the way HRV-up or weight-down is. The signal that matters is downward (desaturation). Revisit with Dr. Jose.
- `spo2_min` carries the wider `absFloor` (3% vs 1.5%) because the nightly minimum is noisier than the average; the robust median+MAD math further smooths single bad-contact dips.

**Low-side clinical floors (`LOW_FLOORS`):**

| metric | floor | cautionBuffer | label |
|---|---|---|---|
| `spo2_avg` | 92 | 2 | Overnight SpO2 average low |
| `spo2_min` | 88 | 3 | Overnight SpO2 min low (desaturation) |

Clinical context for the provisional numbers (state plainly, don't over-assert): SpO2 < 90% is the conventional hypoxemia line; a healthy overnight average sits ≥ 94–95%, and brief dips into the high-80s on the nightly minimum are common in mild sleep-disordered breathing. The floors above are conservative starting points — **replace once Dr. Jose weighs in**, same as the RHR/BP floors.

**Display band (`st.spo2`):** ≥ 94 good · 90–93 watch · < 90 concern. Calm display band only; the drift panel's clinical pill uses `LOW_FLOORS`.

---

## Expected behaviour on first deploy (set expectations)

- The Recovery & Sleep SpO2 card renders the 5 nights already ingested (Jun 18–22): avg ≈ 96%, min in the high-80s/low-90s, band shaded.
- In the Baselines & Drift panel, `spo2_avg` and `spo2_min` appear as two new rows in state **`establishing`** — there aren't yet enough data-days (need ~5-of-7 short + ~12 prior, and ≥ M=7 held days for any drift verdict). They'll move to `active` as nights accumulate and the cron keeps pulling new Oxylink drops. This is correct, not a bug.
- Recency guard: if Oxylink drops stop for > 6 days, the SpO2 drift rows go quiet (`no-recent-data`) — same as CGM between sensor stints.

## Out of scope / deferred
- No SpO2 KPI tile in Today-at-a-glance (placement decision was the Recovery & Sleep card; revisit if you want it elevated).
- No per-reading SpO2 time-series (Slice 4 stores the overnight summary only — the night's avg/min, not the ~5,900 raw points).
- No anchor-population change — when you set a post-rehab anchor, SpO2 joins the frozen snapshot automatically if it has enough data-days in the window (partial anchors are valid; the `/baselines` preview already shows which metrics freeze).

## Implementation steps
1. `migration_003` — add `spo2_daily` CTE + 2 columns + join; re-run in Supabase SQL Editor (CREATE OR REPLACE).
2. `migration_004` — add 2 `long_form` UNION ALL lines; re-run (CREATE OR REPLACE).
3. `daily-metrics.ts` — type + map + select + `LatestKpis.spo2` + fetch.
4. `drift-config.ts` — union + 2 config entries + `DRIFT_METRICS`.
5. `thresholds.ts` — `st.spo2` + 2 `LOW_FLOORS` entries + widen the key type; remove the 3 narrow casts.
6. `RecoverySleepPanel.tsx` — SpO2 card section + source tag.
7. Confirm `baselines.ts` grouped-init covers the new keys; spot-check `BaselinesDriftPanel` renders the two rows.
8. `npm run build` clean.
9. Deploy; eyeball the card (5 nights) + the two `establishing` drift rows.

## Acceptance criteria
- [ ] `daily_metrics` exposes `spo2_avg` + `spo2_min`, attributed by wake-day (`period_end` GST), aligned with the same night's Whoop row
- [ ] `metric_drift` emits `spo2_avg` + `spo2_min` rows with the same windowed-stats shape as the other 8 metrics
- [ ] Recovery & Sleep panel shows an SpO2 card: avg + min trend (custom SVG, null-aware, band-shaded) + last-night status + empty state, with Oxylink source attribution
- [ ] Baselines & Drift panel shows `spo2_avg` + `spo2_min` rows, `establishing` on current data, with the provisional-floor note
- [ ] SpO2 `LOW_FLOORS` breach/caution pill resolves (floor type widened; narrow casts removed)
- [ ] No new tables/migrations beyond the two CREATE OR REPLACE view edits; `npm run build` clean
- [ ] Thresholds carry the provisional-pending-Dr-Jose labelling

---

*End of spec. No code this pass — awaiting build approval. All clinical numbers provisional pending Dr. Jose.*
