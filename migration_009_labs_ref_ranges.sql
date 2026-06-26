-- ============================================================
-- Health Platform — Labs marker-system maturation
-- Version: 009
-- Date: 2026-06-26
-- Idempotent (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS).
-- ============================================================
--
-- Two structural changes to support the "auto-canonicals + AI-proposed
-- ranges + computed flags" enhancement:
--
--   1. lab_marker_ref_ranges — the remembered standard-range store.
--      Same learn-as-you-go pattern as lab_marker_aliases: once a
--      standard reference range is confirmed on commit, it persists
--      keyed by (marker_slug, sex). Future reports auto-apply the
--      remembered range deterministically — the AI is only asked for
--      genuinely-new markers.
--
--   2. lab_values.ref_source — provenance for the stored reference
--      range. Distinguishes a lab-reported range ('reported' —
--      authoritative for that specific draw + lab) from a confirmed
--      population standard ('standard' — population-typical adult
--      values, provisional). Powers the UI provenance badge + lets
--      future exports be honest about where the range came from.
--
-- lab_marker_aliases, lab_panels, lab_values otherwise unchanged.
-- ============================================================


-- 1. lab_marker_ref_ranges — remembered standard reference ranges per
--    canonical marker_slug, optionally scoped by sex (Irfan is the
--    single user; sex='M' for sex-specific markers like hemoglobin /
--    hematocrit / ferritin; NULL means the range applies to any sex).
--
--    critical_low / critical_high are nullable — populated for the
--    handful of markers where panic thresholds matter (potassium,
--    sodium, hemoglobin, glucose, …). They drive HH/LL flagging; an
--    explicit lab-printed flag still wins where present.
CREATE TABLE IF NOT EXISTS lab_marker_ref_ranges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marker_slug     text        NOT NULL,
  sex             text,                                                   -- 'M' / 'F' / NULL = any
  ref_low         numeric,
  ref_high        numeric,
  ref_unit        text,
  critical_low    numeric,
  critical_high   numeric,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marker_slug, sex),
  CONSTRAINT chk_lmrr_sex CHECK (sex IS NULL OR sex IN ('M', 'F'))
);

CREATE INDEX IF NOT EXISTS idx_lmrr_lookup
  ON lab_marker_ref_ranges (marker_slug);


-- 2. RLS — matches the data-table pattern (authenticated_full_access),
--    NOT the deny_all pattern oauth_tokens uses for credentials.
ALTER TABLE lab_marker_ref_ranges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full_access" ON lab_marker_ref_ranges;
CREATE POLICY "authenticated_full_access" ON lab_marker_ref_ranges
  FOR ALL USING (auth.role() = 'authenticated');


-- 3. lab_values.ref_source — provenance for the stored reference
--    range on each value row. 'reported' = the lab printed the range
--    on the report; 'standard' = confirmed population-standard range
--    pulled from lab_marker_ref_ranges (or proposed by the AI on the
--    first sighting of this marker, then confirmed at commit). NULL =
--    no range stored (very rare; the new flow always proposes one).
ALTER TABLE lab_values ADD COLUMN IF NOT EXISTS ref_source text;

ALTER TABLE lab_values DROP CONSTRAINT IF EXISTS chk_lv_ref_source;
ALTER TABLE lab_values
  ADD CONSTRAINT chk_lv_ref_source
  CHECK (ref_source IS NULL OR ref_source IN ('reported', 'standard'));
