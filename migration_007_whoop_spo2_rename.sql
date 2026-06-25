-- ============================================================
-- Health Platform — Whoop SpO2 metric_type rename (in-place)
-- Version: 007
-- Date: 2026-06-25
-- Idempotent. NEVER deletes — UPDATE in place.
-- ============================================================
--
-- The adapter (and refill) historically wrote Whoop's recovery SpO2 under
-- metric_type='spo2_overnight_avg' — the same type Oxylink writes for its
-- overnight averages. The `daily_metrics` `spo2_daily` CTE filtered on
-- source_slug='oxylink_csv' so Whoop's copy was stored but never surfaced.
-- That left a latent type collision + a semantic muddle (Whoop's single
-- recovery SpO2 ≠ an "overnight average").
--
-- Fix (spec: whoop-spo2-skintemp-spec_2026-06-25.md):
--   Rename metric_type 'spo2_overnight_avg' → 'spo2_whoop' for Whoop-sourced
--   rows. The adapter + refill emit the new name going forward; this
--   migration re-stamps the history in place so there are no orphan
--   old-name rows and the renamed adapter doesn't create duplicates on
--   the next cron tick.
--
-- IMPORTANT — only Whoop rows are touched. Oxylink's spo2_overnight_avg
-- rows live under source_slug='oxylink_csv' (a different source) and are
-- the authoritative SpO2 — explicitly NOT touched here.
--
-- The source_record_id substring also gets updated so the new adapter
-- writes line up cleanly with the existing pattern
-- `recovery_<cycle_id>_<metric_type>`.
--
-- Idempotent: after the first run the WHERE clause matches zero rows.
-- ============================================================

UPDATE health_observations
SET metric_type = 'spo2_whoop',
    source_record_id = replace(source_record_id, 'spo2_overnight_avg', 'spo2_whoop')
WHERE source_slug = 'whoop'
  AND metric_type = 'spo2_overnight_avg';
