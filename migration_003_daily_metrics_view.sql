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
--   spo2_whoop     Whoop daily_summary, wake-day attribution (cycle-end
--                                 period_end → routed via whoop_wake).
--                                 Corroborating SpO2; NOT a drift metric
--                                 (Oxylink is authoritative — spec).
--   skin_temp      Whoop daily_summary, wake-day attribution via whoop_wake.
--                                 °C; drift-tracked (concerning='up' —
--                                 sustained rise = possible illness signal).
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
-- 4. Whoop daily metrics. ATTRIBUTION = wake day of the cycle's main sleep.
--
--    CRITICAL bug fix (dashboard-7.1-fixes-spec_2026-06-25.md):
--    These rows (recovery_score / hrv_rmssd / heart_rate_resting /
--    strain_score) carry `period_end = CYCLE end` (= the next evening,
--    when Whoop closes the cycle) — NOT the wake morning. The previous
--    implementation bucketed by (period_end AT TIME ZONE 'Asia/Dubai')::date,
--    so any cycle ending after GST midnight got mis-dated to the next day
--    and collided with that day's own reading; MAX() kept one, the
--    correct day was left empty → scattered gaps in the RHR/HRV +
--    Recovery charts (and corrupt drift baselines, since `metric_drift`
--    reads `rhr`/`hrv` from here).
--
--    Worked example from live data:
--      Jun 5 recovery = 71 → period_end 2026-06-05 21:42 UTC → GST Jun 6
--        → collided with Jun 6's recovery=38; MAX kept 71 on Jun 6.
--        Jun 5 left empty on the chart.
--
--    The fix: derive the cycle's wake_day from the cycle's MAIN sleep
--    (`metric_type = 'sleep_duration_total'` — its own period_end IS the
--    wake morning, so AT TIME ZONE 'Asia/Dubai'::date is correct). All
--    four metrics + the sleep share the cycle's `period_start` (e.g. the
--    Jun 5 recovery and Jun 5 sleep both period_start = 2026-06-04
--    19:14:40.64+00), so we join recovery-family rows back to wake_day
--    by period_start.
--
--    Edge cases (rare, intentional):
--      - A cycle with recovery but no main sleep (`sleep_duration_total`)
--        → the JOIN drops it; can't honestly attribute without a wake
--        time. If this shows up in practice, switch to LEFT JOIN + a
--        defensible fallback.
--      - Two cycles waking the same GST day (split sleep / nap-as-main)
--        → MAX keeps the higher; acceptable until it bites.
--      - In-progress cycles (gotcha #17) have NULL period_end → no row
--        in `whoop_wake`, naturally excluded.
-- ----------------------------------------------------------------
whoop_wake AS (
  -- Wake day per cycle, from the main sleep's wake time.
  SELECT period_start,
         (period_end AT TIME ZONE 'Asia/Dubai')::date AS wake_day
  FROM health_observations
  WHERE source_slug = 'whoop'
    AND metric_type = 'sleep_duration_total'
    AND period_start IS NOT NULL
    AND period_end IS NOT NULL
),
whoop_daily AS (
  -- spo2_whoop + skin_temp come from the recovery payload — same shape as
  -- recovery_score/hrv/rhr/strain (period_end = cycle end, not wake). Route
  -- through whoop_wake on period_start so they bucket to the cycle's wake
  -- day, NOT the cycle-end calendar day (gotcha #74).
  SELECT
    w.wake_day AS date,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type = 'recovery_score')      AS recovery,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type = 'hrv_rmssd')           AS hrv,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type = 'heart_rate_resting')  AS rhr,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type = 'strain_score')        AS strain,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type = 'spo2_whoop')          AS spo2_whoop,
    MAX(o.canonical_value) FILTER (WHERE o.metric_type = 'skin_temp')           AS skin_temp
  FROM health_observations o
  JOIN whoop_wake w ON w.period_start = o.period_start
  WHERE o.source_slug = 'whoop'
    AND o.data_shape  = 'daily_summary'
    AND o.metric_type IN ('recovery_score','hrv_rmssd','heart_rate_resting','strain_score','spo2_whoop','skin_temp')
  GROUP BY w.wake_day
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
),

-- ----------------------------------------------------------------
-- 9. Food diary — eaten-day attribution.
--    Per GST eaten-day macro totals + evening_carbs_g (relative to
--    THAT night's sleep onset) + last_meal_to_sleep_min.
--
--    Attribution rule (DO NOT change without thinking):
--    Meal-derived metrics attribute to the GST EATEN-day. The lagged
--    correlation engine relates them to next-day outcomes via its
--    own lag — pre-shifting to wake-day here would DOUBLE-SHIFT
--    (engine adds +1d on top of our +1d) and silently mis-align.
--
--    evening_carbs_g definition (primary):
--      carbs from meals eaten within 4h BEFORE that night's sleep onset.
--      "That night" = the sleep whose wake_day = eaten_day + 1.
--    Fallback (no sleep recorded for the following morning):
--      meals whose GST clock-time ≥ 18:00.
--
--    last_meal_to_sleep_min:
--      minutes between the day's last meal (eaten_at) and the next
--      night's sleep onset. Null when either is missing.
-- ----------------------------------------------------------------
whoop_sleep_onset AS (
  -- Sleep onset (period_start) keyed by wake_day.
  --
  -- DISTINCT ON (wake_day): a split-sleep / nap-as-main night can
  -- yield two rows sharing wake_day. Without the dedup, the LEFT JOIN
  -- in meals_enriched (`s.wake_day = eaten_day + 1`) duplicates every
  -- meal row, inflating meals_daily's SUM(carbs_g) etc. by a factor of
  -- two. Same split-sleep guard the whoop_wake CTE comment describes
  -- (cycle without main sleep, two cycles waking same day).
  -- ORDER BY wake_day, period_start picks the EARLIEST onset on a
  -- duplicate wake_day — the "real bedtime" rather than a 4am nap.
  SELECT DISTINCT ON ((period_end AT TIME ZONE 'Asia/Dubai')::date)
    (period_end AT TIME ZONE 'Asia/Dubai')::date AS wake_day,
    period_start AS sleep_onset
  FROM health_observations
  WHERE source_slug = 'whoop'
    AND metric_type = 'sleep_duration_total'
    AND period_start IS NOT NULL
    AND period_end IS NOT NULL
  ORDER BY (period_end AT TIME ZONE 'Asia/Dubai')::date, period_start
),
meals_enriched AS (
  -- For each meal: GST eaten-day + the upcoming night's sleep onset
  -- (sleep that ends on eaten_day + 1) + an is_evening flag with the
  -- onset-relative primary + clock-time fallback per the comment above.
  SELECT
    m.eaten_at,
    (m.eaten_at AT TIME ZONE 'Asia/Dubai')::date AS eaten_day,
    m.carbs_g, m.protein_g, m.fat_g, m.fiber_g, m.sugar_g, m.sodium_mg, m.calories,
    s.sleep_onset,
    CASE
      WHEN s.sleep_onset IS NOT NULL THEN
        m.eaten_at >= s.sleep_onset - interval '4 hours'
        AND m.eaten_at <= s.sleep_onset
      ELSE
        (m.eaten_at AT TIME ZONE 'Asia/Dubai')::time >= TIME '18:00'
    END AS is_evening
  FROM meals m
  LEFT JOIN whoop_sleep_onset s
    ON s.wake_day = (m.eaten_at AT TIME ZONE 'Asia/Dubai')::date + 1
),
meals_daily AS (
  SELECT
    eaten_day AS date,
    SUM(carbs_g)   AS carbs_g,
    SUM(protein_g) AS protein_g,
    SUM(fat_g)     AS fat_g,
    SUM(fiber_g)   AS fiber_g,
    SUM(sugar_g)   AS sugar_g,
    SUM(sodium_mg) AS sodium_mg,
    SUM(calories)  AS calories,
    SUM(carbs_g) FILTER (WHERE is_evening) AS evening_carbs_g,
    -- Minutes between the day's last PRE-SLEEP meal and the upcoming
    -- night's sleep onset.
    --
    -- "Last meal" is constrained to `eaten_at <= sleep_onset` — without
    -- the filter, a late/2am snack logged after sleep_onset (post-
    -- midnight bottle for the newborn, say) would make MAX(eaten_at) >
    -- sleep_onset and the difference negative. A negative value
    -- reaching the correlation engine as a covariate would be silently
    -- wrong (the engine would treat -120 as a real metric reading).
    --
    -- GREATEST(0, …) belt-and-braces — if a future edge case still
    -- slips a negative through (e.g. a single meal eaten exactly at the
    -- onset boundary with timezone rounding), clamp at zero.
    --
    -- Explicit NULL guard (fixes a regression the GREATEST(0,…) clamp
    -- itself introduced): Postgres GREATEST() ignores NULL arguments —
    -- GREATEST(0, NULL) = 0, not NULL. Without the CASE below, EVERY
    -- current day (no next-night sleep recorded yet) and any no-sleep
    -- night silently computed to 0 ("meal eaten at the exact moment of
    -- sleep onset") instead of NULL, feeding a fabricated zero into the
    -- correlation engine as a real covariate reading (gotcha #154). Null
    -- when either side is genuinely missing remains null.
    CASE
      WHEN MAX(sleep_onset) IS NULL
        OR MAX(eaten_at) FILTER (WHERE eaten_at <= sleep_onset) IS NULL
      THEN NULL
      ELSE GREATEST(
        0,
        EXTRACT(EPOCH FROM (
          MAX(sleep_onset) - MAX(eaten_at) FILTER (WHERE eaten_at <= sleep_onset)
        )) / 60.0
      )
    END AS last_meal_to_sleep_min
  FROM meals_enriched
  GROUP BY eaten_day
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
  sp.spo2_avg, sp.spo2_min, sp.spo2_odi, sp.spo2_time_below_90,
  -- NEW columns appended at the END (Postgres CREATE OR REPLACE VIEW
  -- can only add columns at the end; inserting in the middle errors
  -- "cannot change name of view column"). Order doesn't affect SELECT-
  -- by-name from the data module.
  wh.spo2_whoop, wh.skin_temp,
  -- Food diary (Slice — food-diary, migration_012). Eaten-day attribution.
  md.carbs_g, md.protein_g, md.fat_g, md.fiber_g, md.sugar_g, md.sodium_mg, md.calories,
  md.evening_carbs_g, md.last_meal_to_sleep_min
FROM date_series ds
LEFT JOIN bp_daily     bp ON bp.date = ds.date
LEFT JOIN weight_daily w  ON w.date  = ds.date
LEFT JOIN whoop_daily  wh ON wh.date = ds.date
LEFT JOIN sleep_daily  sl ON sl.date = ds.date
LEFT JOIN cgm_fasting  cf ON cf.date = ds.date
LEFT JOIN cgm_stats    cs ON cs.date = ds.date
LEFT JOIN spo2_daily   sp ON sp.date = ds.date
LEFT JOIN meals_daily  md ON md.date = ds.date
ORDER BY ds.date;


-- ============================================================
-- RLS / access:
-- daily_metrics is a VIEW over the existing RLS-protected tables. PostgREST
-- queries via the dashboard's session-authenticated server client; the service
-- client (used by the dashboard's data module) bypasses RLS by design. No
-- separate policy needed.
-- ============================================================
