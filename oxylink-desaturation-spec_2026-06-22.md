# Oxylink Desaturation Metrics + Overnight Curve — Build Spec

**Version:** 1.0
**Date:** 2026-06-22
**Status:** Follow-on to Slice 4 (Oxylink file-drop) + SpO2 surfacing. Surfaces the highest-value untapped signal from the gap analysis (`platform-data-inventory-gap-analysis_v2_2026-06-22.md`): nocturnal **oxygen desaturation** — ODI, time-below-90%, and the per-reading overnight SpO2 curve — computed from the ~5,900-point/night CSV series the parser already reads but currently discards after taking avg/min.
**Why it matters:** nocturnal desaturation / sleep-disordered breathing is a real, under-screened cardiovascular risk for a post-MI patient. ODI and time-below-90% are the standard screening numbers. **No new data source** — we already parse every point; we just stop throwing them away.
**Scope:** Oxylink parser + two view edits (`CREATE OR REPLACE`) + drift-config/thresholds + dashboard. **No new tables, no new migration.** `data_shape='time_series'` is already valid (CGM uses it).

---

## Clinical framing (read first)
ODI (Oxygen Desaturation Index) = number of desaturation events per hour of valid recording. The computation here is **screening-grade and approximate, NOT a diagnostic ODI** — it runs on a consumer ring at ~4s sampling, not a titrated PSG. All clinical parameters below are **provisional constants pending Dr. Jose**, named and centralised so they're trivial to tune — same pattern as the Slice-7.3 low-floors. Nothing here is medical advice; it's a screening signal to bring to a doctor.

---

## Part 1 — New summary metrics (parser, written as `daily_summary` rows)
The parser already builds the sorted `rows[]` (ts, spo2, pulse, motion). Add a desaturation pass over that array and emit new per-night rows alongside the existing `spo2_overnight_avg`/`spo2_overnight_min` (same shape, `source_slug='oxylink_csv'`, wake-day attribution, `period_start/end`).

**First-class metrics (drift-able, flow into `daily_metrics`):**
- `spo2_odi` — desaturations per hour (3% threshold, AASM-style). Unit `/h`.
- `spo2_time_below_90_pct` — % of valid recording spent < 90% SpO2. Unit `%`.

**Supporting detail (in `extras` on the ODI row, not first-class):**
- `odi_4pct` — ODI at the 4% threshold (Medicare-style; the report shows both).
- `desaturation_event_count` — raw event count (ODI numerator).
- `time_below_90_min`, `time_below_88_min`, `time_below_85_min` — minutes below each threshold.
- `spo2_distribution` — minutes in bands `{ ge95, b90_94, lt90 }`.
- `valid_recording_hours` — ODI denominator (so the number is auditable).
- `lowest_spo2`, `pulse_min`, `pulse_max`.

**ODI algorithm (provisional — centralise as named constants):**
- Walk `rows[]` in time order. Maintain a **baseline** = the highest SpO2 over the trailing `ODI_BASELINE_WINDOW_S` (default **120 s**) of valid samples (pre-event local baseline, AASM-style).
- A **desaturation event** = SpO2 reaches a nadir `≥ ODI_DROP_PCT` below that baseline (default **3** percentage points), then recovers toward baseline. Enforce `ODI_MIN_EVENT_SEPARATION_S` (default **10 s**) between event nadirs so one slow dip isn't counted repeatedly, and ignore dips shorter than `ODI_MIN_EVENT_DURATION_S` (default **10 s**) to filter motion/noise spikes.
- `valid_recording_hours` = Σ inter-sample gaps between consecutive valid readings (so sensor-off stretches don't inflate the denominator), capped so a large gap doesn't count as recording time.
- `spo2_odi = desaturation_event_count / valid_recording_hours`. Compute the 4% variant the same way with `ODI_DROP_PCT=4`.
- **Guard:** if `valid_recording_hours < ODI_MIN_HOURS` (default **2 h**), don't emit ODI (too little data for a meaningful rate) — emit the row with `numeric_value = null`/skip, and note it. Avoids a wild ODI off a 20-minute nap.

> The algorithm is deliberately simple and well-commented; it is an approximation of clinical ODI. Flag in code that the constants are provisional. Don't claim diagnostic accuracy anywhere in the UI.

## Part 2 — Overnight curve: ONE JSONB-array row per night (not per-reading rows)
**Storage model decision (revised):** store the overnight SpO2 curve as a **single row per night** with the curve packed into `extras` as an array — NOT ~5,900 per-reading `time_series` rows. We only ever read the curve whole-night-at-a-time to draw it; we never query individual points in SQL. This collapses ~2.1M rows/year into ~365, keeps the per-reading data entirely out of the `daily_metrics` view path, and dodges the 1000-row cap and any new index. (If point-level SpO2 analytics is ever wanted, that's a job for a future purpose-built analytics store — logged separately, not this app's primary table.)
- One row per night: `metric_type='spo2_overnight_curve'`, `data_shape='daily_summary'`, `source_slug='oxylink_csv'`, `recorded_at=null`, `period_start/end` = session bounds, `source_record_id='oxylink_'+wakeDate+'_spo2_curve'` (one per night, idempotent on re-drop).
- The curve lives in `extras`, **display-downsampled to ~15–30 s buckets** (≈700–1,200 points/night — plenty for a clean trace; desaturation events last ≥10 s so they survive): e.g. `extras = { interval_s: 30, start_ts: <epoch>, spo2: [number|null, …] }` (null preserves sensor-off gaps; a flat numeric array keyed off `start_ts`+`interval_s` is the most compact). Pulse curve deferred.
- **Critical:** ODI + time-below-90 + all summary metrics in Part 1 are computed on the **FULL in-memory `rows[]` at ingest** (full ~4 s resolution — accuracy preserved). Only the *stored display curve* is downsampled. We don't downsample before computing the clinical numbers.
- Per-night JSONB ≈ 50–150 KB → ~40 MB/year. One row fetch to draw the trace; no pagination, no cap, existing indexes suffice.

## Part 3 — `daily_metrics` view (migration_003, CREATE OR REPLACE)
Extend the existing `spo2_daily` CTE (added by SpO2 surfacing) to also surface the two new first-class metrics, attributed by wake-day (`period_end` GST date), same as `spo2_avg`/`spo2_min`:
- add `MAX(...) FILTER (WHERE metric_type='spo2_odi')` → `spo2_odi`
- add `MAX(...) FILTER (WHERE metric_type='spo2_time_below_90_pct')` → `spo2_time_below_90`
- add the two columns to the final SELECT + the `DailyMetricRow` type + `select(...)` in `daily-metrics.ts` (n()-coerced, gotcha #8).

## Part 4 — `metric_drift` view (migration_004, CREATE OR REPLACE)
Add two `UNION ALL` lines to `long_form` — `spo2_odi`, `spo2_time_below_90` — exactly like SpO2 avg/min were added. Nothing else changes (metric-generic).

## Part 5 — drift-config + thresholds
- `drift-config.ts`: extend `DriftMetricId` with `'spo2_odi' | 'spo2_time_below_90'`; add to `DRIFT_METRICS`. Config: both **concerning: 'up'** (more desaturation = worse), **acknowledgeGood: true** (a sustained drop in ODI/time-below-90 is a genuine improvement worth surfacing). Provisional `absFloor`/`zFloor`/`minN` (e.g. ODI absFloor 2 /h, zFloor 1.0; time-below-90 absFloor 1.5 %, zFloor 1.0; minNShort 5 / minNPrior 12). All provisional pending Dr. Jose. Source-label map already routes oxylink → "Oxylink", so these flow into the Baselines & drift tab automatically.
- `thresholds.ts`: add an `st.odi(v)` calm **display band** for the card — provisional, standard ODI/AHI severity: `< 5` normal · `5–15` mild · `15–30` moderate · `> 30` severe. Add `st.timeBelow90(v)` if wanted. These are high-side severity bands (not the low-floor pattern) — display-only, flagged provisional pending Dr. Jose.

## Part 6 — Dedicated "Overnight Oxygen" dashboard panel
SpO2 has outgrown a sub-card. **Pull it out of `RecoverySleepPanel` into its own panel** on the Dashboard tab, modelled on `GlucosePanel` (header + source badge → "now" readout → distribution donut → band-shaded time-series trace → range trend). This is the dashboard impact of this slice.

### 6a. New source badge (required, small)
`components/dashboard/ui/SourceBadge.tsx` currently types `SourceKey = 'whoop' | 'withings' | 'nightscout' | 'manual'`. **Add `'oxylink'`** to the union + a `SOURCES.oxylink = { label: 'Oxylink', color: <accent> }` entry. (This replaces the "via Oxylink" caption hack the SpO2-surfacing card used — now it's a proper badge.)

### 6b. New `OvernightOxygenPanel.tsx` (model on `GlucosePanel`)
`<Card className="col-7">`, `PanelHeader` icon (e.g. `Activity`/`Wind`/`Lungs`), title **"Overnight oxygen"**, `source="oxylink"`, accent `var(--teal)` (flag). Contents:
- **Last-night readout** (a `glucose-top`-style block or a `mini-stat-row` like Cardiac): big **min SpO2** with `st.spo2` status colour, plus avg, **ODI** with `st.odi` severity dot, and **time-below-90%**. Each with unit + a tiny "last night · <wake date>" caption. Renders "—" / empty-note when no recent night.
- **Distribution donut** (reuse `Donut`, like the glucose TIR donut): time in **95–100 / 90–94 / <90%** bands for the latest night, centre label = % in the ≥95 band (or % below 90). Reads `extras.spo2_distribution` from the curve/summary row.
- **Overnight trace:** adapt **`CGMChart`** (it already does target-band shading + a time x-axis + optional markers) — render the latest night's SpO2 curve with the **≥95 band shaded**, a **90% reference line**, and **desaturation events marked** (reuse the `markers` prop pattern). Reads the single `spo2_overnight_curve` row, decodes `extras.spo2` (downsampled array keyed off `start_ts`+`interval_s`) — one fetch, no cap. Null-aware so sensor-off gaps break the line (gotcha #34).
- **Range trend** (7/30/90d, honours the header range control): a `TrendChart` (custom SVG, not recharts) of **min SpO2 + ODI** (or a Sparkline pair) across the range from `daily_metrics` — so drift is visible at a glance, not only on the Baselines tab. Null-aware across no-data nights.
- **Empty / establishing states** mirror the other panels (neutral dots, "No overnight oxygen data in this window").

### 6c. Remove the SpO2 section from `RecoverySleepPanel`
The avg/min SpO2 card the SpO2-surfacing slice appended to Recovery & Sleep **moves into the new panel** — delete it from `RecoverySleepPanel` so SpO2 lives in exactly one place. Recovery & Sleep returns to recovery + sleep stages + strain.

### 6d. Wire into the tab + data layer
- `DashboardClient.tsx` Dashboard-tab grid: insert `<OvernightOxygenPanel … />` (suggest right after `RecoverySleepPanel`); rebalance the 12-col grid as needed (Glucose col-7 + Recovery col-5 pair today — slot the new panel on its own row or pair it).
- Data: extend `LatestKpis.spo2` to carry `{ avg, min, odi, timeBelow90Pct, distribution, at }`; add a `fetchLatestSpo2Night()` reader that returns the latest `spo2_overnight_curve` row decoded (the display array) + that night's summary. Pass both to the panel as props (curve like `cgm24h` is passed today; summary via `latest`).
- ODI + time-below-90 **also** appear automatically as two rows in the **Baselines & drift** tab via `DRIFT_METRICS` — no extra work there.

### 6e. (Flag) Today-at-a-glance KPI tile
Optional: add an **overnight min-SpO2** (or ODI) tile to the `TodayAtAGlance` KPI row so the overnight-oxygen signal is glanceable at the very top. Note: the KPI grid is currently 6-wide — adding a 7th tile reflows it. Recommend yes (min SpO2), but flagged as a layout decision.

## Decisions baked in (flag to override)
1. **ODI primary threshold = 3%** (AASM); 4% computed + stored in extras. (Both available; 3% is the more sensitive screen.)
2. **Curve stored as ONE JSONB-array row per night** (not per-reading rows) — see Part 2. SpO2 only; pulse curve deferred.
3. **ODI/summary computed on full ~4 s resolution at ingest; stored display curve downsampled to ~15–30 s.** Clinical accuracy preserved; storage stays ~40 MB/yr. (Point-level analytics, if ever needed, → a future dedicated store, not this app's table.)
4. **concerning='up', acknowledgeGood=true** for both new drift metrics.
5. **All clinical constants provisional pending Dr. Jose** (ODI params + severity bands), centralised + labelled.
6. **Dedicated "Overnight Oxygen" panel** (Oxylink source badge, accent teal), SpO2 **removed from Recovery & Sleep**, modelled on GlucosePanel. Sub-choices flagged (low-stakes, easy to change): panel name/icon/accent; exact grid placement + column width; and whether to add the optional Today-at-a-glance min-SpO2 KPI tile (recommend yes).

## Out of scope
- Pulse curve (deferred). Reminder/alarm flag columns (ignored — encoding unverified). PDF-report ingestion (we compute the same metrics from the CSV instead). Contour parser (separate).
- **Point-level SpO2 analytics across nights (FUTURE — logged):** if ever wanted, ingest the raw per-reading data into a dedicated analytics store built for that purpose — deliberately NOT carried in this app's primary `health_observations` table. This app keeps only the per-night summary metrics + the one display-curve row.

## Implementation steps
1. Parser: desaturation pass over the full `rows[]` → new `daily_summary` rows (`spo2_odi`, `spo2_time_below_90_pct`) + rich `extras`; emit one `spo2_overnight_curve` row with the display-downsampled SpO2 array in `extras`; centralise ODI constants. Keep the existing avg/min/0-valid/drift guards intact.
2. `migration_003` `spo2_daily` CTE + 2 columns; re-run (CREATE OR REPLACE).
3. `migration_004` `long_form` + 2 UNION ALL lines; re-run.
4. `daily-metrics.ts`: type + map + select for the 2 new columns; a `latestSpo2Night()` helper for the trace.
5. `drift-config.ts` + `thresholds.ts`: 2 drift metrics + `st.odi` band (+ optional `st.timeBelow90`), provisional.
6. Dashboard: add `'oxylink'` to `SourceBadge`; build `OvernightOxygenPanel` (readout + distribution donut + adapted `CGMChart` trace + range trend); **remove the SpO2 card from `RecoverySleepPanel`**; wire the panel into `DashboardClient` + `fetchLatestSpo2Night()` reader + extend `LatestKpis.spo2`; (flagged) add the Today KPI tile.
7. `npm run build` clean; re-run migrations in Supabase; deploy; re-drop one Oxylink CSV (idempotent) to backfill the new metrics + curve for nights already ingested.

## Acceptance criteria
- [ ] Parser emits `spo2_odi` + `spo2_time_below_90_pct` daily_summary rows (+ extras: odi_4pct, event count, time-below thresholds, distribution, valid hours) with wake-day attribution; ODI guarded below `ODI_MIN_HOURS`
- [ ] Overnight SpO2 curve stored as ONE `spo2_overnight_curve` row/night (downsampled array in `extras`), idempotent on re-drop; full-resolution series used only in-memory for the summary computation
- [ ] ODI constants centralised + labelled provisional; algorithm commented as screening-grade approximation
- [ ] `daily_metrics` exposes `spo2_odi` + `spo2_time_below_90`; `metric_drift` watches both; both render in the Baselines & drift tab (concerning-up, acknowledgeGood)
- [ ] Dedicated **Overnight Oxygen panel** on the Dashboard tab (own `SourceBadge`=Oxylink): last-night min/avg/ODI(severity)/time-below-90 readout + distribution donut + band-shaded overnight trace (90% line + desaturation markers, null-aware) + range trend; SpO2 card **removed from Recovery & Sleep** (lives in one place); empty/establishing states render gracefully
- [ ] ODI + time-below-90 appear as two rows in the Baselines & drift tab automatically (concerning-up, acknowledgeGood)
- [ ] No new tables/migrations beyond the two CREATE OR REPLACE view edits; existing avg/min + 0-valid + drift guards unchanged; `npm run build` clean
- [ ] Re-dropping an already-processed CSV backfills the new metrics + curve without duplicating rows

---

*End of spec. Clinical constants provisional pending Dr. Jose. Decisions 1–5 baked in — flag any to change before build.*
