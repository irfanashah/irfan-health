-- ============================================================
-- migration_013_perf_indexes.sql
--
-- Performance indexes for the hot read paths the code review found
-- doing full table scans (report Phase 1 item #7).
--
-- 1. ingestion_log currently has ZERO indexes. The two queries that
--    hit it on every cron + diagnostics load:
--      - getLastSuccessfulWindowEnd (adapters/_lib/ingestion-log.ts):
--          WHERE source_slug = ? AND status = 'success'
--          ORDER BY completed_at DESC LIMIT 1
--      - fetchPipelineHealth (app/lib/diagnostics/pipeline-health.ts):
--          same shape, per monitored source.
--    A composite on (source_slug, status, completed_at DESC) lets both
--    use a single index range scan.
--
-- 2. health_observations latest-night SpO2 queries
--    (fetchLatestSpo2Night in app/lib/dashboard/daily-metrics.ts)
--    filter on `source_slug, metric_type, period_end IS NOT NULL` and
--    ORDER BY period_end DESC. The existing indexes are on
--    (source_slug, metric_type, period_start) and other shapes; none
--    matches a period_end order. The partial index narrows to the
--    non-null subset (the only one the SpO2 queries care about) so
--    it's small + fast.
--
-- Idempotent (CREATE INDEX IF NOT EXISTS). Postgres can build the
-- index online for the existing tables.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ingestion_source_status_completed
  ON ingestion_log (source_slug, status, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_obs_source_metric_period_end
  ON health_observations (source_slug, metric_type, period_end DESC)
  WHERE period_end IS NOT NULL;
