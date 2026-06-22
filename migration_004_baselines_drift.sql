-- ============================================================
-- Health Platform — Slice 7.3 — Baselines & Drift schema + view
-- Version: 004
-- Date: 2026-06-21
-- Idempotent (CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE VIEW).
-- ============================================================
--
-- Adds the persistence + frozen-snapshot layer for the personal-baseline
-- drift engine, plus the metric_drift view that emits the per-data-day
-- computational outputs the TS layer needs to evaluate the abs+z gate
-- and count >= M held data-days.
--
-- Per-spec separation: this view computes STATS PER DATA-DAY (medians +
-- MADs + counts + the deltas/z). It emits NO gate verdict, NO thresholds.
-- The TS layer in components/dashboard/drift/evaluate.ts applies the
-- per-metric abs+z thresholds from drift-config.ts, the direction config,
-- the three sufficiency states, the recency-against-today guard, the >=M
-- data-day persistence count over a bounded look-back, and the tier
-- surfacing. Same SQL-stats / TS-interpretation split as Slice 7.1
-- (daily_metrics) and 7.2 (correlations).
--
-- The view also does NOT handle suppress_alerts — only exclude_from_baseline.
-- The TS layer queries context_periods separately to apply alert
-- suppression + the "suppressed — <type>" label.
-- ============================================================


-- ----------------------------------------------------------------
-- 1. anchor_sets — frozen snapshot HEADER (supersede, never delete)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anchor_sets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_start date        NOT NULL,
  source_end   date        NOT NULL,
  set_at       timestamptz NOT NULL DEFAULT now(),
  active       boolean     NOT NULL DEFAULT true,
  note         text,
  CONSTRAINT chk_anchor_window CHECK (source_end >= source_start)
);

-- Only ONE active anchor at any time. Supersede = flip prior to
-- active=false in the same transaction as the new insert; never DELETE
-- (history is part of the audit trail).
CREATE UNIQUE INDEX IF NOT EXISTS uq_anchor_one_active
  ON anchor_sets (active) WHERE active = true;


-- ----------------------------------------------------------------
-- 2. anchor_baseline_stats — frozen per-metric snapshot LINES
-- Partial anchors are valid: only metrics with enough data-days in the
-- source window get a row. Reads NEVER recompute; the active set's
-- stats ARE the anchor.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anchor_baseline_stats (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  anchor_set_id uuid        NOT NULL REFERENCES anchor_sets(id) ON DELETE CASCADE,
  metric        text        NOT NULL,
  median        numeric     NOT NULL,
  mad           numeric     NOT NULL,
  n             int         NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (anchor_set_id, metric)
);


-- ----------------------------------------------------------------
-- 3. context_periods — multi-day context AND 1-day "exclude today"
-- The 1-day "exclude today" quick action writes:
--   type='anomaly', exclude_from_baseline=true, suppress_alerts=false
-- EXPLICITLY (it does NOT inherit the multi-day both-default-true).
-- Multi-day form defaults both flags true.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_periods (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date            date        NOT NULL,
  end_date              date        NOT NULL,
  type                  text        NOT NULL,
  suppress_alerts       boolean     NOT NULL DEFAULT true,
  exclude_from_baseline boolean     NOT NULL DEFAULT true,
  note                  text,
  active                boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ctx_window CHECK (end_date >= start_date),
  CONSTRAINT chk_ctx_type   CHECK (type IN ('ramadan','travel','illness','other','anomaly'))
);

CREATE INDEX IF NOT EXISTS idx_ctx_active_dates
  ON context_periods (start_date, end_date)
  WHERE active = true;


-- ----------------------------------------------------------------
-- 4. med_changes — metric-scoped rolling-window reset
-- For each affected metric, EVERY window (rolling + short + prior) uses
-- ONLY data on/after change_date (hard window-start reset, applied as a
-- base filter so prior_n correctly empties post-change → metric reverts
-- to `establishing` until ~28d of post-change data accrues — intended).
-- NEVER touches anchors; surfacing prompts re-anchor; auto re-anchor is
-- forbidden.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS med_changes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  change_date       date        NOT NULL,
  label             text        NOT NULL,
  affected_metrics  text[]      NOT NULL,
  note              text,
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_med_metrics CHECK (array_length(affected_metrics, 1) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_med_active_date
  ON med_changes (change_date DESC) WHERE active = true;


-- ============================================================
-- Row Level Security
-- All four tables hold app data/config (anchor history, context flags,
-- med-change reset markers) — read+written by the dashboard + server
-- actions, NOT secrets. Match the data-table pattern from migration_001
-- (`authenticated_full_access`), NOT the deny_all pattern oauth_tokens
-- uses for credentials. Idempotent: DROP POLICY IF EXISTS before CREATE.
--
-- The metric_drift view inherits security from the underlying tables
-- (daily_metrics + the four above) — no separate policy needed. The
-- service client used by the dashboard data module bypasses RLS by
-- design, same as the daily_metrics surface.
-- ============================================================

ALTER TABLE anchor_sets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE anchor_baseline_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_periods       ENABLE ROW LEVEL SECURITY;
ALTER TABLE med_changes           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full_access" ON anchor_sets;
CREATE POLICY "authenticated_full_access" ON anchor_sets
  FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "authenticated_full_access" ON anchor_baseline_stats;
CREATE POLICY "authenticated_full_access" ON anchor_baseline_stats
  FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "authenticated_full_access" ON context_periods;
CREATE POLICY "authenticated_full_access" ON context_periods
  FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "authenticated_full_access" ON med_changes;
CREATE POLICY "authenticated_full_access" ON med_changes
  FOR ALL USING (auth.role() = 'authenticated');


-- ============================================================
-- metric_drift — the computation view
--
-- Per (date, metric) row emits everything the TS layer needs:
--   today_value, today_z (vs rolling)
--   rolling_median / rolling_mad / rolling_n        (28d ending date)
--   short_median / short_n                          (7d  ending date)
--   prior_median / prior_mad / prior_n              (disjoint 21d:
--                                                    [date-27d, date-7d])
--   short_vs_prior_delta, short_vs_prior_z          (drift inputs)
--   anchor_median / anchor_mad / anchor_n           (active set, or null)
--   short_vs_anchor_delta, short_vs_anchor_z        (drift inputs)
--
-- Rows are emitted ONLY for data-days (a real reading existed for that
-- metric that day). No row = no data = TS treats it as a gap in the
-- >= M held-data-day count.
--
-- MAD is computed via percentile_cont(0.5) over |value − window_median|
-- — a two-pass aggregate inside CTEs (first compute the window median,
-- then the median absolute deviation off that median).
--
-- Exclusions + med-change reset apply BEFORE any window stat is taken:
--   - context_periods rows with active=true AND exclude_from_baseline=true
--     covering the date drop the value from EVERY downstream window calc.
--   - med_changes with active=true: for each affected metric, drop rows
--     dated strictly before the LATEST active change_date for that metric.
--     The reset affects rolling + short + prior uniformly (so post-change
--     metrics revert to `establishing` until enough data-days accrue —
--     intended).
--
-- Performance: O(N × W) materialised rows in the self_join CTE. Trivial
-- at current volume (~90 days × 8 metrics × ~28 reads per window × 3
-- windows). The TS layer queries a bounded recent window
-- (~[today-13, today] + per-metric trend span), so the view's
-- full-history scan is paid only on the slice the dashboard reads.
-- Switch to a materialised view once CGM accrues many months.
-- ============================================================
CREATE OR REPLACE VIEW metric_drift AS

WITH
-- 1. Unpivot daily_metrics into long form for the 10 metrics (8 v1 + 2 SpO2).
--    NULL values are excluded by design — only real readings flow through.
long_form AS (
  SELECT date, 'rhr'         AS metric, rhr::numeric         AS value FROM daily_metrics WHERE rhr         IS NOT NULL
  UNION ALL SELECT date, 'hrv',         hrv::numeric                 FROM daily_metrics WHERE hrv         IS NOT NULL
  UNION ALL SELECT date, 'sys',         sys::numeric                 FROM daily_metrics WHERE sys         IS NOT NULL
  UNION ALL SELECT date, 'dia',         dia::numeric                 FROM daily_metrics WHERE dia         IS NOT NULL
  UNION ALL SELECT date, 'fasting',     fasting::numeric             FROM daily_metrics WHERE fasting     IS NOT NULL
  UNION ALL SELECT date, 'glucose_var', glucose_var::numeric         FROM daily_metrics WHERE glucose_var IS NOT NULL
  UNION ALL SELECT date, 'tir',         tir::numeric                 FROM daily_metrics WHERE tir         IS NOT NULL
  UNION ALL SELECT date, 'weight',      weight::numeric              FROM daily_metrics WHERE weight      IS NOT NULL
  UNION ALL SELECT date, 'spo2_avg',    spo2_avg::numeric            FROM daily_metrics WHERE spo2_avg    IS NOT NULL
  UNION ALL SELECT date, 'spo2_min',    spo2_min::numeric            FROM daily_metrics WHERE spo2_min    IS NOT NULL
),

-- 2. Latest active med-change date per metric (window-start reset floor).
med_floor AS (
  SELECT am AS metric, MAX(mc.change_date) AS earliest_allowed
  FROM med_changes mc
  CROSS JOIN LATERAL unnest(mc.affected_metrics) AS am
  WHERE mc.active = true
  GROUP BY am
),

-- 3. Apply BOTH exclusions: active context_periods (exclude_from_baseline
--    + covering the date) AND med-change reset (date >= floor). The
--    med-change filter applies to EVERY downstream window (rolling +
--    short + prior) so prior_n empties post-change — intended.
--
--    suppress_alerts is NOT applied here — that's a TS-layer concern
--    (the panel queries context_periods separately to label suppressed
--    states; the underlying stats stay honest regardless).
filtered AS (
  SELECT lf.date, lf.metric, lf.value
  FROM long_form lf
  WHERE NOT EXISTS (
          SELECT 1 FROM context_periods cp
          WHERE cp.active = true
            AND cp.exclude_from_baseline = true
            AND lf.date BETWEEN cp.start_date AND cp.end_date
        )
    AND lf.date >= COALESCE(
          (SELECT earliest_allowed FROM med_floor mf WHERE mf.metric = lf.metric),
          '1900-01-01'::date
        )
),

-- 4. Self-join: pair each (target date, metric) data-day with every
--    in-window reading for the three windows. Window-label discriminates.
self_join AS (
  SELECT base.date AS target_date, base.metric, base.value AS target_value,
         'rolling'::text AS w, f.value AS w_value
  FROM filtered base
  JOIN filtered f ON f.metric = base.metric
                 AND f.date BETWEEN base.date - INTERVAL '27 days' AND base.date
  UNION ALL
  SELECT base.date, base.metric, base.value, 'short', f.value
  FROM filtered base
  JOIN filtered f ON f.metric = base.metric
                 AND f.date BETWEEN base.date - INTERVAL '6 days' AND base.date
  UNION ALL
  SELECT base.date, base.metric, base.value, 'prior', f.value
  FROM filtered base
  JOIN filtered f ON f.metric = base.metric
                 AND f.date BETWEEN base.date - INTERVAL '27 days' AND base.date - INTERVAL '7 days'
),

-- 5. First pass: window medians + n per (target_date, metric, window).
medians AS (
  SELECT target_date, metric, target_value, w,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY w_value) AS med,
         COUNT(*)::int AS n
  FROM self_join
  GROUP BY target_date, metric, target_value, w
),

-- 6. Second pass: MAD per window = median(|value − window_median|).
--    Joined to medians on (target_date, metric, w) so each window's MAD
--    is taken off its own median.
mads AS (
  SELECT sj.target_date, sj.metric, sj.w,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(sj.w_value - m.med)) AS mad
  FROM self_join sj
  JOIN medians m ON m.target_date = sj.target_date
                AND m.metric      = sj.metric
                AND m.w           = sj.w
  GROUP BY sj.target_date, sj.metric, sj.w
),

-- 7. Pivot windows into a single row per (date, metric).
per_day AS (
  SELECT
    m.target_date AS date,
    m.metric,
    MAX(m.target_value)                                       AS today_value,
    MAX(m.med) FILTER (WHERE m.w = 'rolling')                 AS rolling_median,
    MAX(d.mad) FILTER (WHERE d.w = 'rolling')                 AS rolling_mad,
    MAX(m.n)   FILTER (WHERE m.w = 'rolling')                 AS rolling_n,
    MAX(m.med) FILTER (WHERE m.w = 'short')                   AS short_median,
    MAX(m.n)   FILTER (WHERE m.w = 'short')                   AS short_n,
    MAX(m.med) FILTER (WHERE m.w = 'prior')                   AS prior_median,
    MAX(d.mad) FILTER (WHERE d.w = 'prior')                   AS prior_mad,
    MAX(m.n)   FILTER (WHERE m.w = 'prior')                   AS prior_n
  FROM medians m
  LEFT JOIN mads d ON d.target_date = m.target_date
                  AND d.metric      = m.metric
                  AND d.w           = m.w
  GROUP BY m.target_date, m.metric
),

-- 8. Active anchor stats (one row per metric IF the active anchor has it).
active_anchor AS (
  SELECT abs.metric, abs.median, abs.mad, abs.n
  FROM anchor_baseline_stats abs
  JOIN anchor_sets aset ON aset.id = abs.anchor_set_id AND aset.active = true
)

SELECT
  p.date,
  p.metric,
  p.today_value,
  -- rolling
  p.rolling_median, p.rolling_mad, p.rolling_n,
  CASE WHEN p.rolling_mad IS NULL OR p.rolling_mad = 0 THEN NULL
       ELSE (p.today_value - p.rolling_median) / p.rolling_mad END AS today_z,
  -- short
  p.short_median, p.short_n,
  -- prior
  p.prior_median, p.prior_mad, p.prior_n,
  -- drift inputs vs prior (used by TS abs+z gate)
  (p.short_median - p.prior_median) AS short_vs_prior_delta,
  -- prior_mad = 0 (only realistic on sparse identical weights) → null z →
  -- gate can't trip that day even on a real abs move. v1 known edge,
  -- biases toward silence; revisit if it ever shows up in practice.
  CASE WHEN p.prior_mad IS NULL OR p.prior_mad = 0 THEN NULL
       ELSE (p.short_median - p.prior_median) / p.prior_mad END AS short_vs_prior_z,
  -- anchor (null when no active anchor or anchor lacks this metric)
  a.median AS anchor_median,
  a.mad    AS anchor_mad,
  a.n      AS anchor_n,
  (p.short_median - a.median) AS short_vs_anchor_delta,
  CASE WHEN a.mad IS NULL OR a.mad = 0 THEN NULL
       ELSE (p.short_median - a.median) / a.mad END AS short_vs_anchor_z
FROM per_day p
LEFT JOIN active_anchor a ON a.metric = p.metric
ORDER BY p.date, p.metric;


-- ============================================================
-- See the RLS block above (after the table definitions, before the view)
-- for the authenticated_full_access policies on the four new tables.
-- The view inherits security from the underlying tables; service-client
-- reads bypass RLS by design (same pattern as daily_metrics).
-- ============================================================
