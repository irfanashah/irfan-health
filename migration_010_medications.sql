-- ============================================================
-- Health Platform — Medications (doctor-record-export prerequisite)
-- Version: 010
-- Date: 2026-06-26
-- Idempotent (CREATE TABLE IF NOT EXISTS + INSERT ON CONFLICT).
-- ============================================================
--
-- Small editable medications table. The doctor-record export reads the
-- ACTIVE meds (active=true) into the page-1 snapshot's "Current
-- medications" line. The platform's never-delete rule applies: meds
-- are deactivated (active=false), not removed — past-meds history is
-- a meaningful clinical signal in itself.
--
-- Seeded with Irfan's current post-STEMI cardiology regimen so the
-- report is useful on first load:
--   - Concor 5mg          (bisoprolol)    — beta-blocker, morning
--   - Crestor 40mg        (rosuvastatin)  — statin, morning
--   - Brilinta 90mg       (ticagrelor)    — antiplatelet, BD
--   - Ezetrol 10mg        (ezetimibe)     — cholesterol absorption inhibitor, morning
--   - Tritace 10mg        (ramipril)      — ACE inhibitor
--   - Aspirin Protect 100mg               — antiplatelet, morning
--   - Pantozol 40mg       (pantoprazole)  — PPI (gastric protection on dual antiplatelet), morning
-- ============================================================


-- 1. medications table — one row per current/past prescription.
CREATE TABLE IF NOT EXISTS medications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,           -- brand or generic as printed on the bottle
  dose         text,                            -- "5mg", "10mg", "90mg" — free text so combos / units stay flexible
  frequency    text,                            -- "morning", "BD", "TDS", "as needed" — free text
  notes        text,                            -- e.g. "with food", "post-procedure protocol"
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medications_active
  ON medications (active, name) WHERE active = true;


-- 2. RLS — data-table pattern.
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full_access" ON medications;
CREATE POLICY "authenticated_full_access" ON medications
  FOR ALL USING (auth.role() = 'authenticated');


-- 3. Seed. Idempotent: insert only if NO row with the same (name, dose)
--    already exists — active OR inactive (L2). The guard used to check
--    `active = true`, so a re-run after Irfan deactivated a med (never-
--    delete: stopped meds live on as active=false) found no *active* row
--    and RESURRECTED the stopped med into the doctor-record list. Checking
--    for any row keeps the seed a true one-time bootstrap and respects the
--    deactivation. The DO block lets the migration re-run safely.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Concor' AND dose = '5mg') THEN
    INSERT INTO medications (name, dose, frequency, notes) VALUES
      ('Concor', '5mg', 'morning', 'bisoprolol — beta-blocker');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Crestor' AND dose = '40mg') THEN
    INSERT INTO medications (name, dose, frequency, notes) VALUES
      ('Crestor', '40mg', 'morning', 'rosuvastatin — statin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Brilinta' AND dose = '90mg') THEN
    INSERT INTO medications (name, dose, frequency, notes) VALUES
      ('Brilinta', '90mg', 'BD', 'ticagrelor — antiplatelet');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Ezetrol' AND dose = '10mg') THEN
    INSERT INTO medications (name, dose, frequency, notes) VALUES
      ('Ezetrol', '10mg', 'morning', 'ezetimibe — cholesterol absorption inhibitor');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Tritace' AND dose = '10mg') THEN
    INSERT INTO medications (name, dose, frequency, notes) VALUES
      ('Tritace', '10mg', 'morning', 'ramipril — ACE inhibitor');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Aspirin Protect' AND dose = '100mg') THEN
    INSERT INTO medications (name, dose, frequency, notes) VALUES
      ('Aspirin Protect', '100mg', 'morning', 'antiplatelet');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM medications WHERE name = 'Pantozol' AND dose = '40mg') THEN
    INSERT INTO medications (name, dose, frequency, notes) VALUES
      ('Pantozol', '40mg', 'morning', 'pantoprazole — PPI, gastric protection on dual antiplatelet');
  END IF;
END $$;
