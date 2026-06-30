-- ============================================================
-- migration_012_food_diary.sql
--
-- Food diary — one row per logged meal. Macros are LLM-estimated
-- (Sonnet) at log time, then user-reviewed before commit. The
-- numeric totals are denormalised onto the row so the daily_metrics
-- view can aggregate cheaply via SUM(...) GROUP BY GST eaten-day.
--
-- items JSONB carries the per-item LLM breakdown (name, qty, carbs/
-- protein/fat/fiber/sugar/sodium/calories) so the review UI can
-- edit individual rows. The numeric totals on the row are the
-- committed truth; the JSONB is audit detail.
--
-- estimated/edited/source track provenance:
--   estimated=true  → LLM estimated the macros (current sole path)
--   edited=true     → user changed the LLM output before commit
--   source          → 'llm_estimate' (only v1 source; future: 'manual',
--                     'open_food_facts', etc.)
--
-- Honesty rule: macros are ESTIMATES — for pattern-spotting in the
-- correlation engine, not clinical macro-counting. The UI labels
-- this everywhere; the table just stores the numbers.
--
-- Never-delete contract (gotcha #103 family) does NOT apply here:
-- meals are user-correctable; an accidental log is the kind of
-- data point that warrants hard delete (mirrors Slice 3 manual
-- entries, not the meds/adherence cleared-status pattern).
--
-- Idempotent (CREATE TABLE IF NOT EXISTS; DROP+CREATE POLICY).
-- No seed.
-- ============================================================

CREATE TABLE IF NOT EXISTS meals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  eaten_at    timestamptz NOT NULL,
  meal_label  text,                                 -- auto from time, editable: breakfast/lunch/dinner/snack
  description text        NOT NULL,                 -- verbatim NL input
  items       jsonb,                                -- LLM per-item breakdown
  carbs_g     numeric,
  protein_g   numeric,
  fat_g       numeric,
  fiber_g     numeric,
  sugar_g     numeric,
  sodium_mg   numeric,
  calories    numeric,
  estimated   boolean     NOT NULL DEFAULT true,
  edited      boolean     NOT NULL DEFAULT false,
  source      text        NOT NULL DEFAULT 'llm_estimate',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meals_eaten_at ON meals (eaten_at);

ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_full_access" ON meals;
CREATE POLICY "authenticated_full_access" ON meals
  FOR ALL USING (auth.role() = 'authenticated');
