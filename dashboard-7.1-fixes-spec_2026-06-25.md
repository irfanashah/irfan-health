# Dashboard 7.1 — Fixes Spec (3 issues from the live eyeball)

**Version:** 1.0
**Date:** 2026-06-25
**Status:** Fixes three issues found eyeballing the deployed 7.1 dashboard. **Part 1 (Whoop wake-day attribution) is a real data-correctness bug and the priority** — it silently mis-dates and drops RHR/HRV/recovery/strain readings, and it feeds the Baselines & Drift engine. Parts 2–3 are a UX gap and a rendering bug. No new tables; one `CREATE OR REPLACE` view edit + component changes.

---

## Part 1 — Whoop wake-day attribution bug (PRIORITY — data correctness)

### The bug (diagnosed from live data)
`daily_metrics`'s `whoop_daily` CTE attributes every Whoop daily-summary metric by `(period_end AT TIME ZONE 'Asia/Dubai')::date`, assuming `period_end` is the wake time. That holds for **sleep** rows (period_end = wake, early morning) but is **wrong for `recovery_score` / `heart_rate_resting` / `hrv_rmssd` / `strain_score`**, which carry `period_end = the CYCLE end` (the next evening). When the cycle-end crosses GST midnight, those metrics bucket to the **next day** and **collide** with that day's own reading; `MAX(...) GROUP BY` keeps one and the correct day is left empty.

**Proof from the query:** the recovery value `71` (Whoop's **Jun 5** recovery) has `period_end = 2026-06-05 21:42 UTC` → GST `2026-06-06 01:42` → buckets to **Jun 6**, colliding with Jun 6's own recovery (`38`); MAX keeps `71` on Jun 6 and **Jun 5 shows no recovery/RHR/HRV** — the gap on the chart. Sleep for Jun 5 (`period_end 06:38 GST`) attributes correctly, which is why sleep is fine but the RHR/HRV + Recovery charts have holes. The mis-attribution is intermittent (only cycles whose end crosses GST midnight), hence scattered gaps.

### Scope of impact (state plainly)
- `recovery_score`, `heart_rate_resting`, `hrv_rmssd`, `strain_score` — **mis-dated by ~a day on affected cycles, with some days dropped** (collision + MAX).
- `sleep_duration_*` + `sleep_score` + `respiratory_rate` — correct (sleep-stamped period_end = wake).
- **Downstream: the Baselines & Drift engine reads `rhr`/`hrv` from this view** — its baselines/drift have been computed on mis-dated, gappy data. Fixing the view corrects the drift inputs automatically (the engine re-reads the view).

### The fix (view only — no data change, no re-ingestion)
Anchor the recovery-family metrics to the **cycle's wake day**, derived from the cycle's main sleep. Recovery/RHR/HRV/strain and the sleep all share the same `period_start` (the cycle anchor — confirmed in the data: e.g. the Jun 5 recovery and the Jun 5 sleep both have `period_start = 2026-06-04 19:14:40.64+00`). So:

Recommended structure in `migration_003` (`CREATE OR REPLACE`):
```sql
-- wake day per cycle, taken from the MAIN sleep's wake time
whoop_wake AS (
  SELECT period_start,
         (period_end AT TIME ZONE 'Asia/Dubai')::date AS wake_day
  FROM health_observations
  WHERE source_slug = 'whoop'
    AND metric_type = 'sleep_duration_total'
    AND period_end IS NOT NULL
),
whoop_daily AS (
  SELECT w.wake_day AS date,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type='recovery_score')     AS recovery,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type='hrv_rmssd')          AS hrv,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type='heart_rate_resting') AS rhr,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type='strain_score')       AS strain
  FROM health_observations o
  JOIN whoop_wake w ON w.period_start = o.period_start
  WHERE o.source_slug = 'whoop' AND o.data_shape = 'daily_summary'
    AND o.metric_type IN ('recovery_score','hrv_rmssd','heart_rate_resting','strain_score')
  GROUP BY w.wake_day
),
```
- The `sleep_daily` CTE can stay as-is (its own `period_end` = wake is already correct) — or, for one consistent attribution mechanism, also key it off `whoop_wake.wake_day`. Builder's call; keeping sleep as-is is the smaller diff.
- **Equivalent alternative:** a window function — `(MIN(period_end) OVER (PARTITION BY period_start) AT TIME ZONE 'Asia/Dubai')::date` as the wake day for every Whoop row (the sleep's morning wake is the earliest period_end in the cycle). Either works; the explicit `whoop_wake` join is clearer and robust against naps (it keys off `sleep_duration_total`, the main sleep).

### Edge cases (note in the view comments)
- A cycle with recovery but **no `sleep_duration_total`** row (no main sleep recorded) → the JOIN drops its recovery (can't derive a wake day). Rare; acceptable. (A `LEFT JOIN` with `COALESCE` back to the row's own `period_end` would retain it at the old—possibly off-by-one—attribution; only add if it shows up.)
- Two cycles waking the same GST day (split sleep) → `MAX` keeps the higher; rare, acceptable.
- Confirm `strain_score` rows share `period_start` with the cycle's sleep (they're cycle-derived, so they should). If strain is anchored differently, include it consistently.

### Verify after the fix
Re-run `migration_003` (`CREATE OR REPLACE`) in Supabase, then:
```sql
SELECT date, recovery, rhr, hrv, strain FROM daily_metrics WHERE date IN ('2026-06-05','2026-06-10');
```
Expected: **Jun 5 → recovery 71**, **Jun 10 → recovery 63** (matching the Whoop app), with no empty days where Whoop has data. The RHR/HRV + Recovery charts fill in; the Baselines & Drift RHR/HRV rows recompute on corrected data.

---

## Part 2 — Glucose panel: fingerstick fallback (UX gap)

### The gap
The Glucose panel is CGM-only (the big "now", trend arrow, 24h curve, TIR donut all read `glucose_cgm`). With no recent CGM it shows "—" / "No recent CGM" / TIR `0% / 0% / 0%` **even though fingerstick data exists** (Contour + manual `glucose_fingerstick`). The markers we shipped only render *on* a CGM curve within 24h, so fingerstick is invisible when CGM is stale.

### The fix — make the panel fingerstick-aware (full fallback, Irfan's choice)
- **When CGM is live** (recent `glucose_cgm` in window): current behaviour — CGM leads, fingerstick shows as the overlay diamonds (already built). No change.
- **When CGM is absent/stale** (no `glucose_cgm` in the 24h window):
  - **"Now" fallback:** show the **latest fingerstick** reading as the headline value (value + unit, its meal marker, "Xh ago / <time>", source). Coloured by `st.glucose`.
  - **Chart-area fallback:** replace the empty "No CGM readings" note with a **recent-fingersticks view** — recommend a compact list of the last N readings (time · value · fasting/before/after-meal tag · source), newest first (sparse fingerstick data suits a list better than a faux-continuous curve). A small scatter is an acceptable alternative — builder's call; a list is simpler and honest.
  - **TIR donut:** when there's no CGM, do **not** render `0% / 0% / 0%` — show a clean "no CGM data" state (hide the donut or show a neutral placeholder). This also fixes the cosmetic 0% issue.
- Data: extend the fingerstick reader (`fetchFingersticks`) or add a sibling that returns the **latest fingerstick** + the **recent N** (e.g. last 14 days or last ~10 readings) for the fallback. Source-agnostic (`metric_type='glucose_fingerstick'`, contour + manual). Sparse — no cap concern.
- Empty-empty case (no CGM AND no fingerstick) → the existing clean empty state.

### Decision flagged
Fallback chart-area form: **recent-readings list** (recommended) vs a mini scatter. Default to the list unless you want the scatter.

---

## Part 3 — BP KPI sparkline overflow (rendering bug)

### The bug
The Blood-pressure KPI tile's sparkline overflows the card — a long green diagonal bleeds into the gutter (visible in the screenshot). Likely causes: the `Sparkline` SVG/container isn't clipped, and with **sparse BP data** the smoothed (bezier) path overshoots the tile bounds and/or draws a steep diagonal that isn't contained.

### The fix
- **Clip the KPI sparkline to its tile** — `overflow: hidden` on the sparkline container / SVG so nothing can bleed past the card edge (the robust catch-all).
- **Contain the path:** add y-domain padding and/or clamp the smoothed path within the SVG viewport so the bezier can't overshoot above/below the box; ensure x maps within `width`.
- **Sparse-data handling:** with ≤2 points, don't draw an attention-grabbing steep diagonal — render a short flat/centered line (or no sparkline). Verify specifically with the current sparse BP series.
- Apply the clip to the KPI sparkline generally (not just BP) so any sparse KPI series is safe.

---

## Implementation steps
1. `migration_003` — add the `whoop_wake` CTE + rework `whoop_daily` to attribute by wake day (`CREATE OR REPLACE`). Comment the bug + the edge cases.
2. Glucose panel fingerstick fallback — reader(s) for latest + recent fingersticks; `GlucosePanel` branches on CGM-present vs absent; TIR "no data" state.
3. BP/KPI sparkline clip + sparse-data handling (in `Sparkline` / `KpiCard` / `TodayAtAGlance`).
4. `npm run build` clean.
5. (MANUAL — Irfan) Re-run `migration_003` in Supabase; verify the Jun 5 / Jun 10 query returns recovery 71 / 63; eyeball the RHR/HRV + Recovery charts (gaps gone), the Glucose panel (fingerstick fallback showing your Contour data), and the BP KPI (sparkline contained).

## Acceptance criteria
- [ ] **Part 1:** Whoop recovery/RHR/HRV/strain attribute to the **wake day**; `daily_metrics` for Jun 5 = recovery 71, Jun 10 = recovery 63; no empty days where Whoop has data; sleep unchanged; the Baselines & Drift RHR/HRV rows recompute on corrected data. `CREATE OR REPLACE` only — no data migration.
- [ ] **Part 2:** with no recent CGM, the Glucose panel shows the latest fingerstick as "now" + a recent-fingersticks view + a clean TIR "no data" state (not 0/0/0); with live CGM, unchanged (fingerstick stays as overlay markers); empty-empty handled.
- [ ] **Part 3:** the KPI sparkline is clipped to its tile (no bleed), contains the bezier, and handles sparse series gracefully; BP tile verified.
- [ ] No new tables; `npm run build` clean.

---

*End of spec. Part 1 is the priority — it's a correctness bug affecting RHR/HRV/recovery/strain dating AND the drift engine. View-level fix, no re-ingestion.*
