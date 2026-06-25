# Whoop SpO2 (rename + corroborate) + Skin Temperature — Build Spec

**Version:** 1.0
**Date:** 2026-06-25
**Status:** Persists Whoop **skin temperature** (in the recovery payload we fetch, never written) and **cleans up Whoop SpO2** (already written, but mislabeled as `spo2_overnight_avg` — colliding with Oxylink — and unsurfaced). Corrects the `platform-data-inventory-gap-analysis_v2` claim that Whoop SpO2 wasn't persisted (it is).
**Scope:** Adapter + refill + an in-place re-stamp migration + two view edits + drift-config/thresholds + two panel readouts. **No new tables.** All clinical framing provisional pending Dr. Jose.

> **CRITICAL:** both metrics come from the **recovery** object, so their stored `period_end = cycle end` — the exact shape that caused the wake-day bug just fixed. In `daily_metrics` they MUST route through the `whoop_wake` CTE (wake-day attribution), NOT `(period_end AT TIME ZONE …)::date`. Gotcha #74.

---

## Background (the real state, from the code)
- `adapters/whoop/index.ts` (line ~178) and `/api/refill/whoop` already write `rec.score.spo2_percentage` — but under `metric_type='spo2_overnight_avg'`, the same type Oxylink uses. The `daily_metrics` `spo2_daily` CTE filters `source_slug='oxylink_csv'`, so Whoop's copy is stored but never surfaced. Latent collision + semantic muddle (Whoop's single recovery SpO2 ≠ an "overnight average").
- `rec.score.skin_temp_celsius` is in the `WhoopRecoveryRecord.score` type we fetch, but nothing writes it.
- Both are WHOOP 4.0+ fields; Irfan has 5.0 MG so they're populated — but guard against null defensively.

## Decisions (confirmed)
1. **Rename Whoop SpO2** `spo2_overnight_avg` → **`spo2_whoop`** (kills the Oxylink collision). In-place re-stamp of existing rows (never delete).
2. **Surface Whoop SpO2 as corroboration** on the Overnight Oxygen panel (small readout). **NOT a drift metric** — Oxylink stays the authoritative SpO2; don't double-count.
3. **Add skin temperature** (`skin_temp`, °C): surfaced (Recovery & Sleep readout) **+ a drift metric** (sustained rise = possible illness/inflammation — a genuine early-warning signal). Provisional thresholds pending Dr. Jose.
4. Both attribute by **wake day** via `whoop_wake`.

---

## Part 1 — Adapter + refill
`adapters/whoop/index.ts` recoveryMetrics array (and the mirror in `/api/refill/whoop` — gotcha #25, they must agree):
- Change the existing `spo2_overnight_avg` entry → **`spo2_whoop`** (value `rec.score.spo2_percentage`, unit `%`).
- ADD **`skin_temp`** (value `rec.score.skin_temp_celsius`, unit `C`, canonical `C`; `canonical_value = value`, no conversion — same as the other recovery metrics).
- **Null guard:** filter out either metric when its source field is null/undefined (4.0+ only) before writing — don't push a null row.
- `source_record_id` follows the existing pattern `recovery_${cycle_id}_${metric_type}` → `recovery_<cycle>_spo2_whoop`, `recovery_<cycle>_skin_temp`.

## Part 2 — `migration_007_whoop_spo2_rename.sql` (NEW, idempotent, in-place — no deletes)
Re-stamp the existing Whoop SpO2 rows from the old name to the new one:
```sql
UPDATE health_observations
SET metric_type = 'spo2_whoop',
    source_record_id = replace(source_record_id, 'spo2_overnight_avg', 'spo2_whoop')
WHERE source_slug = 'whoop'
  AND metric_type = 'spo2_overnight_avg';
```
Idempotent (after it runs once, no rows match). This converts history in place so there are no orphaned old-name rows and no duplicates when the renamed adapter next runs. (Oxylink's `spo2_overnight_avg` rows are untouched — different `source_slug`.)

## Part 3 — `daily_metrics` view (migration_003, CREATE OR REPLACE)
In the **wake-day-attributed `whoop_daily` CTE** (the one that JOINs `whoop_wake` on `period_start`), add two metrics:
- `MAX(o.canonical_value) FILTER (WHERE o.metric_type='spo2_whoop')  AS spo2_whoop`
- `MAX(o.canonical_value) FILTER (WHERE o.metric_type='skin_temp')   AS skin_temp`
Add both to the `metric_type IN (...)` filter and the final SELECT. (They share `period_start` with the cycle's sleep → `whoop_wake` attributes them to the wake day correctly.) Extend `DailyMetricRow` + `select(...)` in `daily-metrics.ts` (n()-coerced, gotcha #8). Extend `LatestKpis` with `skinTemp` + `spo2Whoop` latest values (for the readouts).

## Part 4 — `metric_drift` view (migration_004, CREATE OR REPLACE)
Add **`skin_temp` only** as a `UNION ALL` line in `long_form` (NOT `spo2_whoop` — corroborating, not drift). The gate machinery is metric-generic.

## Part 5 — drift-config + thresholds
- `drift-config.ts`: add `'skin_temp'` to `DriftMetricId` + `DRIFT_METRICS`. Config: **`concerning: 'up'`** (sustained rise = possible illness/inflammation/fever — the signal that matters for a post-procedure cardiac patient), **`acknowledgeGood: false`** (a dip isn't a celebrated "win"). Provisional thresholds (e.g. `absFloor 0.4` °C, `zFloor 1.0`, `minNShort 5`, `minNPrior 12`, same windows/M as the rest). Provisional pending Dr. Jose. Source-label map → `Whoop`. Flows into the Baselines & drift tab automatically via `DRIFT_METRICS`.
- `thresholds.ts`: **no fixed `st.*` band** for skin temp — it's a personal-baseline/deviation signal, not an absolute-threshold metric. The drift engine watches deviation from his own normal, which is exactly right. (A raw °C readout is fine on the panel; no good/watch/concern colouring without a clinical anchor.) No `LOW_FLOORS` entry.

## Part 6 — Dashboard surfacing
- **Skin temp** → small readout in `RecoverySleepPanel` (Whoop-sourced, fits alongside recovery/strain): latest value + a "vs your normal" hint if cheap (else just the value). Appears in the **Baselines & drift** tab automatically as a drift row.
- **Whoop SpO2 (`spo2_whoop`)** → small **corroborating** readout in the **Overnight Oxygen panel**, clearly labelled (e.g. "Whoop: 96% · corroborating") next to the authoritative Oxylink avg/min, source-tagged Whoop. NOT a drift row, NOT the headline. Empty-safe.
- Reads come from `LatestKpis` (latest skin_temp + spo2_whoop) — no heavy new fetch.

## Out of scope
- Whoop SpO2 as a drift metric (Oxylink is authoritative — explicitly avoided to prevent double-counting). Other Whoop recovery fields (`user_calibrating`). A fixed clinical band for skin temp (no anchor; it's a deviation signal).

## Implementation steps
1. Adapter + refill: rename spo2 → `spo2_whoop`, add `skin_temp`, null-guard both.
2. `migration_007` re-stamp (in-place).
3. `migration_003` (CREATE OR REPLACE): `spo2_whoop` + `skin_temp` columns via `whoop_wake`; `daily-metrics.ts` types + `LatestKpis`.
4. `migration_004` (CREATE OR REPLACE): `skin_temp` UNION ALL line.
5. `drift-config.ts` (+skin_temp, source-label Whoop) + `thresholds.ts` (no band).
6. `RecoverySleepPanel` skin-temp readout; `OvernightOxygenPanel` Whoop-SpO2 corroborating readout.
7. `npm run build` clean.
8. (MANUAL — Irfan, in order) run `migration_007` (re-stamp), then `migration_003` + `migration_004` (CREATE OR REPLACE), then run the Whoop **refill** once (backfills `skin_temp` history; re-confirms `spo2_whoop`). Eyeball the two readouts + the skin-temp drift row.

## Acceptance criteria
- [ ] Whoop SpO2 stored as `spo2_whoop` (not `spo2_overnight_avg`); existing rows re-stamped in place (no orphans, no deletes); Oxylink SpO2 untouched
- [ ] `skin_temp` written from `skin_temp_celsius`; null-guarded; refill backfills history
- [ ] Both attribute by **wake day** in `daily_metrics` (via `whoop_wake`), not `period_end::date`
- [ ] `skin_temp` is a drift metric (concerning-up, provisional, no fixed band) and appears in the Baselines & drift tab; `spo2_whoop` is NOT a drift metric
- [ ] Skin-temp readout in Recovery & Sleep; Whoop-SpO2 corroborating readout in Overnight Oxygen (labelled, source Whoop, not the headline)
- [ ] No new tables; `npm run build` clean

---

*End of spec. Corrects the gap-analysis v2 (Whoop SpO2 WAS persisted, just mislabeled). Skin temp is the genuinely new signal; clinical framing provisional pending Dr. Jose.*
