-- ============================================================
-- Health Platform — Slice 7.3 — Anchor preview + supersede functions
-- Version: 005
-- Date: 2026-06-22
-- Idempotent (CREATE OR REPLACE).
-- ============================================================
--
-- migration_004's unique index `WHERE active = true` enforces exactly one
-- active anchor, which means superseding cannot be done by the naive
-- "insert new, then flip prior" pattern (the insert would race with the
-- prior's active=true). The right pattern is a single transaction that
-- flips prior → false, inserts the new header, and inserts the per-metric
-- stat lines atomically. That's what `set_anchor()` below does.
--
-- Preview reuses the same CTE shape so the numbers shown to the user at
-- preview time are identical to what gets frozen at set time.
-- ============================================================


-- ----------------------------------------------------------------
-- compute_anchor_stats(p_start, p_end)
--   Internal helper. Returns one row per metric with median + MAD + n
--   over the requested window, with context exclusions applied
--   (matches the metric_drift view's `filtered` CTE: drops rows on
--   days an active context_periods row excludes from baseline).
--
--   med_changes are NOT applied here — the anchor is a frozen
--   snapshot of a chosen window; the user picks a window that
--   represents their stable post-rehab "normal" and any included
--   med-change inside the window is part of the snapshot they
--   chose. Med-change resets only affect the rolling baseline.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_anchor_stats(p_start date, p_end date)
RETURNS TABLE (metric text, median numeric, mad numeric, n int)
LANGUAGE sql
STABLE
AS $$
  WITH
  long_form AS (
    SELECT date, 'rhr'         AS metric, rhr::numeric         AS value FROM daily_metrics WHERE rhr         IS NOT NULL AND date BETWEEN p_start AND p_end
    UNION ALL SELECT date, 'hrv',         hrv::numeric                 FROM daily_metrics WHERE hrv         IS NOT NULL AND date BETWEEN p_start AND p_end
    UNION ALL SELECT date, 'sys',         sys::numeric                 FROM daily_metrics WHERE sys         IS NOT NULL AND date BETWEEN p_start AND p_end
    UNION ALL SELECT date, 'dia',         dia::numeric                 FROM daily_metrics WHERE dia         IS NOT NULL AND date BETWEEN p_start AND p_end
    UNION ALL SELECT date, 'fasting',     fasting::numeric             FROM daily_metrics WHERE fasting     IS NOT NULL AND date BETWEEN p_start AND p_end
    UNION ALL SELECT date, 'glucose_var', glucose_var::numeric         FROM daily_metrics WHERE glucose_var IS NOT NULL AND date BETWEEN p_start AND p_end
    UNION ALL SELECT date, 'tir',         tir::numeric                 FROM daily_metrics WHERE tir         IS NOT NULL AND date BETWEEN p_start AND p_end
    UNION ALL SELECT date, 'weight',      weight::numeric              FROM daily_metrics WHERE weight      IS NOT NULL AND date BETWEEN p_start AND p_end
  ),
  filtered AS (
    SELECT lf.date, lf.metric, lf.value
    FROM long_form lf
    WHERE NOT EXISTS (
      SELECT 1 FROM context_periods cp
      WHERE cp.active = true
        AND cp.exclude_from_baseline = true
        AND lf.date BETWEEN cp.start_date AND cp.end_date
    )
  ),
  medians AS (
    SELECT metric,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS med,
           COUNT(*)::int AS cnt
    FROM filtered
    GROUP BY metric
  ),
  mads AS (
    SELECT f.metric,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(f.value - m.med)) AS mad
    FROM filtered f
    JOIN medians m USING (metric)
    GROUP BY f.metric
  )
  SELECT m.metric, m.med AS median, d.mad, m.cnt AS n
  FROM medians m
  JOIN mads d USING (metric)
  ORDER BY m.metric;
$$;


-- ----------------------------------------------------------------
-- set_anchor(p_start, p_end, p_note, p_min_n)
--   Atomic supersede + insert. Returns the new anchor_set id.
--   - Flips the prior active anchor (if any) to active=false.
--   - Inserts a new anchor_sets row (active=true).
--   - Inserts one anchor_baseline_stats row per metric whose computed n
--     is >= p_min_n (default 5 — matches drift-config.ts min-n short for
--     daily metrics). Partial anchors are valid; metrics without enough
--     data-days simply don't get a frozen row.
--   - Runs inside an implicit transaction (PL/pgSQL function body).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_anchor(
  p_start date,
  p_end   date,
  p_note  text DEFAULT NULL,
  p_min_n int  DEFAULT 5
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF p_end < p_start THEN
    RAISE EXCEPTION 'set_anchor: source_end must be >= source_start';
  END IF;

  -- Flip prior active(s) to false (partial unique index allows the new
  -- insert below only after this).
  UPDATE anchor_sets SET active = false WHERE active = true;

  -- Insert the new active header.
  INSERT INTO anchor_sets (source_start, source_end, note, active)
  VALUES (p_start, p_end, p_note, true)
  RETURNING id INTO new_id;

  -- Insert per-metric frozen stats (only metrics meeting min-n).
  INSERT INTO anchor_baseline_stats (anchor_set_id, metric, median, mad, n)
  SELECT new_id, s.metric, s.median, s.mad, s.n
  FROM compute_anchor_stats(p_start, p_end) s
  WHERE s.n >= p_min_n;

  RETURN new_id;
END;
$$;


-- ============================================================
-- Access:
-- Both functions read the existing RLS-protected tables. Slice 7.3's
-- server actions call them via the service client (bypasses RLS), so
-- no explicit grants needed. If the authenticated dashboard ever calls
-- these directly, add EXECUTE grants here.
-- ============================================================
