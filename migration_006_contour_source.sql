-- ============================================================
-- Health Platform — Contour fingerstick source seed
-- Version: 006
-- Date: 2026-06-24
-- Idempotent (ON CONFLICT DO NOTHING).
-- ============================================================
--
-- Adds the `contour` source row so file-drop ingest rows referencing
-- `source_slug='contour'` satisfy the FK to `sources.slug`. The Contour
-- Next One parser (adapters/file-drop/contour/parser.ts) writes
-- `glucose_fingerstick` rows shaped identically to the Slice 3 manual
-- entry path. No new table; no view change.
-- ============================================================

INSERT INTO sources (slug, display_name, adapter_version) VALUES
  ('contour', 'Contour (fingerstick)', '0.1.0')
ON CONFLICT (slug) DO NOTHING;
