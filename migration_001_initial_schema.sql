-- ============================================================
-- Health Platform — Initial Schema Migration
-- Version: 001
-- Date: 2026-06-16
-- Run this once in the Supabase SQL Editor for your irfan-health project.
-- Safe to re-run: all statements use IF NOT EXISTS or CREATE OR REPLACE.
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

-- gen_random_uuid() is available by default in Supabase (pgcrypto).
-- No extension install needed.


-- ============================================================
-- TABLE 1: sources
-- Registry of all data adapters. One row per source.
-- ============================================================

CREATE TABLE IF NOT EXISTS sources (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text        UNIQUE NOT NULL,
  display_name    text        NOT NULL,
  adapter_version text        NOT NULL DEFAULT '0.1.0',
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- TABLE 2: ingestion_log
-- One row per ingestion run. Written before any data rows.
-- Stores the raw API/file payload for re-processing safety.
-- ============================================================

CREATE TABLE IF NOT EXISTS ingestion_log (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug          text        NOT NULL REFERENCES sources(slug),
  triggered_at         timestamptz NOT NULL DEFAULT now(),
  fetch_window_start   timestamptz,
  fetch_window_end     timestamptz,
  raw_payload          jsonb,
  records_found        int,
  records_written      int,
  records_skipped      int,
  status               text        NOT NULL DEFAULT 'pending',
  error_detail         text,
  completed_at         timestamptz,

  CONSTRAINT chk_ingestion_status
    CHECK (status IN ('pending', 'success', 'partial', 'error'))
);


-- ============================================================
-- TABLE 3: health_observations
-- Workhorse table for all single-value metrics.
-- Handles time_series, daily_summary, discrete, and episodic shapes.
-- Blood pressure is NOT here — it has its own table (bp_readings).
-- ============================================================

CREATE TABLE IF NOT EXISTS health_observations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug      text        NOT NULL REFERENCES sources(slug),
  source_record_id text        NOT NULL,
  data_shape       text        NOT NULL,
  metric_type      text        NOT NULL,
  recorded_at      timestamptz,
  period_start     timestamptz,
  period_end       timestamptz,
  numeric_value    numeric,
  unit             text,
  canonical_value  numeric,
  canonical_unit   text,
  extras           jsonb,
  ingestion_log_id uuid        REFERENCES ingestion_log(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Deduplication key: one row per source record, never duplicated on re-run
  CONSTRAINT uq_obs_source_record
    UNIQUE (source_slug, source_record_id),

  -- Either recorded_at must be set, or both period dates must be set
  CONSTRAINT chk_obs_time_coverage
    CHECK (
      recorded_at IS NOT NULL
      OR (period_start IS NOT NULL AND period_end IS NOT NULL)
    ),

  -- data_shape must be one of the four defined values
  CONSTRAINT chk_obs_data_shape
    CHECK (data_shape IN ('time_series', 'daily_summary', 'discrete', 'episodic'))
);

-- Index: trend query by metric over a date range (recorded_at sources)
CREATE INDEX IF NOT EXISTS idx_obs_metric_recorded
  ON health_observations (metric_type, recorded_at DESC)
  WHERE recorded_at IS NOT NULL;

-- Index: trend query by metric over a date range (period sources)
CREATE INDEX IF NOT EXISTS idx_obs_metric_period
  ON health_observations (metric_type, period_start DESC)
  WHERE period_start IS NOT NULL;

-- Index: source-level queries (e.g. "what did Whoop send last night")
CREATE INDEX IF NOT EXISTS idx_obs_source_date
  ON health_observations (source_slug, recorded_at DESC);


-- ============================================================
-- TABLE 4: bp_readings
-- Blood pressure sessions.
-- Always three values (systolic, diastolic, pulse) from one moment.
-- Always stored in mmHg — Withings returns mmHg natively.
-- ============================================================

CREATE TABLE IF NOT EXISTS bp_readings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug      text        NOT NULL REFERENCES sources(slug),
  source_record_id text        NOT NULL,
  measured_at      timestamptz NOT NULL,
  systolic_mmhg    smallint    NOT NULL,
  diastolic_mmhg   smallint    NOT NULL,
  pulse_bpm        smallint,
  position         text,
  extras           jsonb,
  ingestion_log_id uuid        REFERENCES ingestion_log(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_bp_source_record
    UNIQUE (source_slug, source_record_id),

  CONSTRAINT chk_bp_position
    CHECK (position IN ('sitting', 'lying', 'standing') OR position IS NULL)
);

-- Index: trend query — all BP readings in a date range
CREATE INDEX IF NOT EXISTS idx_bp_measured
  ON bp_readings (measured_at DESC);


-- ============================================================
-- TABLE 5: lab_panels
-- One row per blood draw / lab visit.
-- Anchor for all lab imports; child rows live in lab_values.
-- ============================================================

CREATE TABLE IF NOT EXISTS lab_panels (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug        text        NOT NULL REFERENCES sources(slug),
  drawn_at           date        NOT NULL,
  lab_name           text,
  ordering_physician text,
  notes              text,
  raw_file_ref       text,
  ingestion_log_id   uuid        REFERENCES ingestion_log(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Index: chronological panel list
CREATE INDEX IF NOT EXISTS idx_lp_drawn
  ON lab_panels (drawn_at DESC);


-- ============================================================
-- TABLE 6: lab_values
-- Individual markers from a panel.
-- These are the rows you trend over time (e.g. LDL across 6 draws).
-- ============================================================

CREATE TABLE IF NOT EXISTS lab_values (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id         uuid        NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,
  marker_slug      text        NOT NULL,
  raw_marker_name  text        NOT NULL,
  numeric_value    numeric,
  text_value       text,
  unit             text,
  canonical_value  numeric,
  canonical_unit   text,
  ref_low          numeric,
  ref_high         numeric,
  ref_unit         text,
  flag             text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_lv_flag
    CHECK (flag IN ('H', 'L', 'HH', 'LL', 'N') OR flag IS NULL)
);

-- Index: trend a specific marker across all panels
CREATE INDEX IF NOT EXISTS idx_lv_marker
  ON lab_values (marker_slug, panel_id);

-- Index: all values in a given panel
CREATE INDEX IF NOT EXISTS idx_lv_panel
  ON lab_values (panel_id);


-- ============================================================
-- ROW LEVEL SECURITY
-- Single-user project: any authenticated session can read and write.
-- The service role key (used by ingestion functions) bypasses RLS entirely.
-- The anon key + user session (used by the dashboard) is governed by these policies.
-- ============================================================

ALTER TABLE sources           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_readings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_panels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_values        ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist (makes this script re-runnable)
DROP POLICY IF EXISTS "authenticated_full_access" ON sources;
DROP POLICY IF EXISTS "authenticated_full_access" ON ingestion_log;
DROP POLICY IF EXISTS "authenticated_full_access" ON health_observations;
DROP POLICY IF EXISTS "authenticated_full_access" ON bp_readings;
DROP POLICY IF EXISTS "authenticated_full_access" ON lab_panels;
DROP POLICY IF EXISTS "authenticated_full_access" ON lab_values;

CREATE POLICY "authenticated_full_access" ON sources
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON ingestion_log
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON health_observations
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON bp_readings
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON lab_panels
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON lab_values
  FOR ALL USING (auth.role() = 'authenticated');


-- ============================================================
-- SEED DATA: sources
-- One row per adapter. Insert order does not matter.
-- The wearable swap in November adds one new row here — no schema change.
-- ============================================================

INSERT INTO sources (slug, display_name, adapter_version) VALUES
  ('whoop',       'Whoop',                       '0.1.0'),
  ('withings',    'Withings',                    '0.1.0'),
  ('nightscout',  'Nightscout (CGM)',             '0.1.0'),
  ('tidepool',    'Tidepool (fingerstick)',        '0.1.0'),
  ('oxylink_csv', 'Oxylink / ViHealth CSV',       '0.1.0'),
  ('labs_pdf',    'Lab report (PDF import)',       '0.1.0'),
  ('manual',      'Manual entry',                 '0.1.0')
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- DONE
-- Expected result: 6 tables, 7 indexes, 6 RLS policies, 7 source rows.
-- Verify in Table Editor that all tables appear and sources has 7 rows.
-- ============================================================
