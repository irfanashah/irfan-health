-- ============================================================
-- migration_011_med_adherence.sql
-- One row per GST calendar day. Tri-state status:
--   taken    — Irfan confirmed today's meds (one tap)
--   skipped  — Irfan marked the day as skipped (with optional note)
--   cleared  — undo of an accidental tap; treated as no-record by all reads.
--             Keeps the never-delete contract (gotchas #103 family).
-- Day PK makes the one-tap an idempotent UPSERT.
-- Idempotent (CREATE TABLE IF NOT EXISTS; DROP+CREATE POLICY).
-- No seed — history starts the first day Irfan taps.
-- ============================================================

CREATE TABLE IF NOT EXISTS med_adherence (
  day         date        PRIMARY KEY,
  status      text        NOT NULL DEFAULT 'taken'
              CHECK (status IN ('taken','skipped','cleared')),
  note        text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE med_adherence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_full_access" ON med_adherence;
CREATE POLICY "authenticated_full_access" ON med_adherence
  FOR ALL USING (auth.role() = 'authenticated');
