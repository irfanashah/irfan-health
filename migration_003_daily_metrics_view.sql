-- ============================================================
-- Health Platform — Slice 7.1 — daily_metrics view
-- Version: 003
-- Date: 2026-06-19
-- Run this once in the Supabase SQL Editor for the irfan-health project.
-- Safe to re-run: CREATE OR REPLACE.
-- ============================================================
--
-- Produces ONE ROW PER GST CALENDAR DAY across the data we have, with each
-- metric attributed to its day by source-appropriate rules. Consumed by the
-- Slice 7.1 dashboard via app/lib/dashboard/daily-metrics.ts.
--
-- Time zone rule (load-bearing):
--   All time bucketing + time-of-day comparisons happen via
--   `AT TIME ZONE 'Asia/Dubai'` (UAE is fixed UTC+4, no DST). Never compare
--   UTC and local time in the same predicate.
--
-- Per-field rules (mirrors slice-7.1-dashboard-spec.md "Per-field source + window"):
--   sys/dia/pulse  bp_readings    morning reading (GST 05:00–11:00 preferred),
--                                 else earliest of day; one row's values
--                                 (no Frankenstein BP).
--   weight         health_observations metric_type='weight' (manual + Withings)
--                                 latest reading on the day; null on no-reading
--                                 days (carry-forward done in the data module,
--                                 not the view — keeps the view idempotent).
--   recovery       Whoop daily_summary, period_end attribution (day you woke up)
--   hrv            Whoop daily_summary, period_end attribution
--   rhr            Whoop daily_summary, period_end attribution
--   strain         Whoop daily_summary, period_end attribution
--   sleep.*        Whoop daily_summary, period_end attribution; canonical_unit
--                                 is 'min' on the source row, view EXPOSES HOURS
--                                 (matches the prototype's sleep.total shape).
--   fasting        glucose_cgm   first reading 04:00–09:00 GST; canonical mmol/L.
--   glucose_var    glucose_cgm   stddev of the day's readings (mmol/L).
--   tir            glucose_cgm   % of the day's readings in 3.9–10.0 mmol/L.
--                                 COUNT-BASED proxy for time-based TIR — valid
--                                 because Nightscout sgv readings are ~5-min
--                                 equispaced (xDrip+/Clarity both write at the
--                                 sensor's native cadence), so count% ≈ time%.
--                                 If we ever ingest a non-uniform source, this
--                                 needs to switch to a time-weighted calc.
--   spo2_avg       Oxylink daily_summary, period_end attribution (wake-day).
--                                 Overnight average SpO2, canonical %.
--   spo2_min       Oxylink daily_summary, period_end attribution (wake-day).
--                                 Overnight minimum SpO2, canonical %.
--   spo2_odi       Oxylink daily_summary, period_end attribution (wake-day).
--                                 Screening-grade ODI (3% threshold, AASM-style),
--                                 events/hour. PROVISIONAL — not diagnostic.
--   spo2_time_below_90  Oxylink daily_summary, period_end attribution.
--                                 % of valid recording time < 90% SpO2.
-- ============================================================


CREATE OR REPLACE VIEW daily_metrics AS

WITH

-- ----------------------------------------------------------------
-- 1. Date spine: every GST day from the earliest data point to today.
--    LEAST + COALESCE handles the case where any one source is empty
--    (NULL would otherwise poison LEAST).
-- ----------------------------------------------------------------
bounds AS (
  SELECT LEAST(
    COALESCE(
      (SELECT MIN((period_end  AT TIME ZONE 'Asia/Dubai')::date)
       FROM health_observations
       WHERE source_slug = 'whoop' AND period_end IS NOT NULL),
      (now() AT TIME ZONE 'Asia/Dubai')::date
    ),
    COALESCE(
      (SELECT MIN((measured_at AT TIME ZONE 'Asia/Dubai')::date)
       FROM bp_readings),
      (now() AT TIME ZONE 'Asia/Dubai')::date
    ),
    COALESCE(
      (SELECT MIN((recorded_at AT TIME ZONE 'Asia/Dubai')::date)
       FROM health_observations
       WHERE recorded_at IS NOT NULL),
      (now() AT TIME ZONE 'Asia/Dubai')::date
    )
  ) AS first_date
),
date_series AS (
  SELECT generate_series(
    (SELECT first_date FROM bounds),
    (now() AT TIME ZONE 'Asia/Dubai')::date,
    interval '1 day'
  )::date AS date
),

-- ----------------------------------------------------------------
-- 2. BP: one row per GST day; morning reading (05:00–11:00) preferred,
--    else the day's earliest. All three values come from the SAME reading.
-- ----------------------------------------------------------------
bp_daily AS (
  SELECT DISTINCT ON ((measured_at AT TIME ZONE 'Asia/Dubai')::date)
    (measured_at AT TIME ZONE 'Asia/Dubai')::date AS date,
    systolic_mmhg  AS sys,
    diastolic_mmhg AS dia,
    pulse_bpm      AS pulse
  FROM bp_readings
  ORDER BY
    (measured_at AT TIME ZONE 'Asia/Dubai')::date,
    CASE
      WHEN (measured_at AT TIME ZONE 'Asia/Dubai')::time BETWEEN TIME '05:00' AND TIME '11:00'
      THEN 0 ELSE 1
    END,
    measured_at
),

-- ----------------------------------------------------------------
-- 3. Weight: latest reading of the day. Manual entries + Withings both
--    write metric_type='weight'. Null on no-reading days (carry-forward
--    is the data module's job).
-- ----------------------------------------------------------------
weight_daily AS (
  SELECT DISTINCT ON ((recorded_at AT TIME ZONE 'Asia/Dubai')::date)
    (recorded_at AT TIME ZONE 'Asia/Dubai')::date AS date,
    canonical_value AS weight
  FROM health_observations
  WHERE metric_type = 'weight'
    AND recorded_at IS NOT NULL
  ORDER BY (recorded_at AT TIME ZONE 'Asia/Dubai')::date, recorded_at DESC
),

-- ----------------------------------------------------------------
-- 4. Whoop daily metrics. Attribution = (period_end AT TIME ZONE 'Asia/Dubai')::date
--    — the day you wake up; matches Whoop's UI. In-progress cycles have
--    NULL period_end (gotcha #17), so they're naturally excluded.
-- ----------------------------------------------------------------
whoop_daily AS (
  SELECT
    (period_end AT TIME ZONE 'Asia/Dubai')::date AS date,
    MAX(canonical_value) FILTER (WHERE metric_type = 'recovery_score')      AS recovery,
    MAX(canonical_value) FILTER (WHERE metric_type = 'hrv_rmssd')           AS hrv,
    MAX(canonical_value) FILTER (WHERE metric_type = 'heart_rate_resting')  AS rhr,
    MAX(canonical_value) FILTER (WHERE metric_type = 'strain_score')        AS strain
  FROM health_observations
  WHERE source_slug = 'whoop'
    AND data_shape  = 'daily_summary'
    AND period_end IS NOT NULL
    AND metric_type IN ('recovery_score','hrv_rmssd','heart_rate_resting','strain_score')
  GROUP BY (period_end AT TIME ZONE 'Asia/Dubai')::date
),

-- ----------------------------------------------------------------
-- 5. Sleep stages (Whoop). canonical_unit='min' on the source rows.
--    The view exposes HOURS to match the prototype's sleep.total shape.
-- ----------------------------------------------------------------
sleep_daily AS (
  SELECT
    (period_end AT TIME ZONE 'Asia/Dubai')::date AS date,
    MAX(canonical_value) FILTER (WHERE metric_type = 'sleep_duration_total') / 60.0 AS sleep_total,
    MAX(canonical_value) FILTER (WHERE metric_type = 'sleep_score')                AS sleep_performance,
    MAX(canonical_value) FILTER (WHERE metric_type = 'sleep_duration_deep')  / 60.0 AS sleep_deep,
    MAX(canonical_value) FILTER (WHERE metric_type = 'sleep_duration_light') / 60.0 AS sleep_light,
    MAX(canonical_value) FILTER (WHERE metric_type = 'sleep_duration_rem')   / 60.0 AS sleep_rem,
    MAX(canonical_value) FILTER (WHERE metric_type = 'sleep_duration_awake') / 60.0 AS sleep_awake
  FROM health_observations
  WHERE source_slug = 'whoop'
    AND data_shape  = 'daily_summary'
    AND period_end IS NOT NULL
    AND metric_type IN (
      'sleep_duration_total','sleep_score',
      'sleep_duration_deep','sleep_duration_light','sleep_duration_rem','sleep_duration_awake'
    )
  GROUP BY (period_end AT TIME ZONE 'Asia/Dubai')::date
),

-- ----------------------------------------------------------------
-- 6. CGM fasting: first reading whose local time is 04:00–09:00 GST.
-- ----------------------------------------------------------------
cgm_fasting AS (
  SELECT DISTINCT ON ((recorded_at AT TIME ZONE 'Asia/Dubai')::date)
    (recorded_at AT TIME ZONE 'Asia/Dubai')::date AS date,
    canonical_value AS fasting
  FROM health_observations
  WHERE metric_type = 'glucose_cgm'
    AND recorded_at IS NOT NULL
    AND (recorded_at AT TIME ZONE 'Asia/Dubai')::time BETWEEN TIME '04:00' AND TIME '09:00'
  ORDER BY (recorded_at AT TIME ZONE 'Asia/Dubai')::date, recorded_at
),

-- ----------------------------------------------------------------
-- 7. CGM stats: stddev (variability) + count-based TIR proxy.
--    TIR: COUNT(*) FILTER (canonical_value BETWEEN 3.9 AND 10.0) / COUNT(*).
--    Count-based is valid because sgv readings are ~5-min equispaced
--    (xDrip+ / Clarity both write at the sensor's native cadence), so
--    count% ≈ time%. Switch to time-weighted if a non-uniform source
--    ever lands.
-- ----------------------------------------------------------------
cgm_stats AS (
  SELECT
    (recorded_at AT TIME ZONE 'Asia/Dubai')::date AS date,
    STDDEV(canonical_value) AS glucose_var,
    100.0 * COUNT(*) FILTER (WHERE canonical_value BETWEEN 3.9 AND 10.0)
          / NULLIF(COUNT(*), 0) AS tir,
    COUNT(*) AS cgm_count
  FROM health_observations
  WHERE metric_type = 'glucose_cgm'
    AND recorded_at IS NOT NULL
  GROUP BY (recorded_at AT TIME ZONE 'Asia/Dubai')::date
),

-- ----------------------------------------------------------------
-- 8. Oxylink overnight SpO2. Modelled on whoop_daily — wake-day
--    attribution via (period_end AT TIME ZONE 'Asia/Dubai')::date so
--    each night's SpO2 lands on the SAME daily_metrics row as that
--    night's recovery/sleep (they line up).
--    Source: health_observations source_slug='oxylink_csv'
--            data_shape='daily_summary'
--            metric_type ∈ {spo2_overnight_avg, spo2_overnight_min}
--    Unit: % (canonical). Both rows per night share period_end so the
--    GROUP BY + FILTER pattern collapses them cleanly.
-- ----------------------------------------------------------------
spo2_daily AS (
  SELECT
    (period_end AT TIME ZONE 'Asia/Dubai')::date AS date,
    MAX(canonical_value) FILTER (WHERE metric_type = 'spo2_overnight_avg')      AS spo2_avg,
    MAX(canonical_value) FILTER (WHERE metric_type = 'spo2_overnight_min')      AS spo2_min,
    MAX(canonical_value) FILTER (WHERE metric_type = 'spo2_odi')                AS spo2_odi,
    MAX(canonical_value) FILTER (WHERE metric_type = 'spo2_time_below_90_pct')  AS spo2_time_below_90
  FROM health_observations
  WHERE source_slug = 'oxylink_csv'
    AND data_shape  = 'daily_summary'
    AND period_end IS NOT NULL
    AND metric_type IN (
      'spo2_overnight_avg','spo2_overnight_min',
      'spo2_odi','spo2_time_below_90_pct'
    )
  GROUP BY (period_end AT TIME ZONE 'Asia/Dubai')::date
)

SELECT
  ds.date,
  bp.sys, bp.dia, bp.pulse,
  w.weight,
  wh.recovery, wh.hrv, wh.rhr, wh.strain,
  sl.sleep_total, sl.sleep_performance,
  sl.sleep_deep, sl.sleep_light, sl.sleep_rem, sl.sleep_awake,
  cf.fasting,
  cs.glucose_var,
  cs.tir,
  cs.cgm_count,
  sp.spo2_avg, sp.spo2_min, sp.spo2_odi, sp.spo2_time_below_90
FROM date_series ds
LEFT JOIN bp_daily     bp ON bp.date = ds.date
LEFT JOIN weight_daily w  ON w.date  = ds.date
LEFT JOIN whoop_daily  wh ON wh.date = ds.date
LEFT JOIN sleep_daily  sl ON sl.date = ds.date
LEFT JOIN cgm_fasting  cf ON cf.date = ds.date
LEFT JOIN cgm_stats    cs ON cs.date = ds.date
LEFT JOIN spo2_daily   sp ON sp.date = ds.date
ORDER BY ds.date;


-- ============================================================
-- RLS / access:
-- daily_metrics is a VIEW over the existing RLS-protected tables. PostgREST
-- queries via the dashboard's session-authenticated server client; the service
-- client (used by the dashboard's data module) bypasses RLS by design. No
-- separate policy needed.
-- ============================================================
