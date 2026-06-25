-- ============================================================
-- Health Platform — Slice 6: Labs PDF import
-- Version: 008
-- Date: 2026-06-25
-- Idempotent (INSERT … ON CONFLICT + CREATE TABLE IF NOT EXISTS).
-- ============================================================
--
-- Two changes to support the labs import flow:
--   1. Seed a `labs` row in `sources` (the FK target for lab_panels).
--   2. Create `lab_marker_aliases` — the learned-mapping table that
--      makes the importer get smarter per-source over time. First
--      report from a new lab needs the most review; repeats are near-
--      automatic because the (raw_marker_name, lab_name) → marker_slug
--      mappings persist on commit.
--
-- `lab_panels` + `lab_values` already exist (reserved in migration_001);
-- this migration does NOT touch them.
--
-- NOTE: a Supabase Storage bucket for raw lab PDFs is required and is
-- created via the Supabase Studio UI (Storage → New Bucket) — not via
-- a migration (storage.buckets DDL is owned by the storage role and
-- not freely writeable in SQL editor). Recommended:
--   bucket name: lab-reports
--   public: false
--   file size limit: 25 MB
-- ============================================================

-- 1. Source seed — `lab_panels.source_slug` FK target.
INSERT INTO sources (slug, display_name, adapter_version) VALUES
  ('labs', 'Labs (PDF import)', '0.1.0')
ON CONFLICT (slug) DO NOTHING;


-- 2. lab_marker_aliases — the learning table.
--
-- Each row is "for THIS lab (or globally, NULL), the raw marker name
-- printed on the report maps to THIS canonical marker_slug". Applied
-- BEFORE the LLM's suggested mapping during extraction, so repeated
-- raw names auto-map deterministically with no LLM round-trip.
--
-- `lab_name IS NULL` = global mapping (applies to any lab).
-- `lab_name = '...'` = scoped to that specific lab (lets one raw name
--                       like "Cholesterol" map differently if a lab
--                       happens to use it ambiguously vs another).
--
-- UNIQUE (raw_marker_name, lab_name) — NULL is treated as distinct
-- per Postgres convention, so a global entry + a lab-scoped entry can
-- coexist for the same raw name (the lab-scoped one wins per the
-- application's lookup order: scoped first, then global).
CREATE TABLE IF NOT EXISTS lab_marker_aliases (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_marker_name   text        NOT NULL,
  lab_name          text,
  marker_slug       text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_marker_name, lab_name)
);

CREATE INDEX IF NOT EXISTS idx_lma_lookup
  ON lab_marker_aliases (raw_marker_name);


-- 3. RLS — matches the data-table pattern from migration_001
--    (`authenticated_full_access`), NOT the deny_all pattern that
--    oauth_tokens uses for credentials. Idempotent: DROP POLICY IF
--    EXISTS before CREATE.
ALTER TABLE lab_marker_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full_access" ON lab_marker_aliases;
CREATE POLICY "authenticated_full_access" ON lab_marker_aliases
  FOR ALL USING (auth.role() = 'authenticated');
