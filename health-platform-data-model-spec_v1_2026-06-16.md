# Health Platform — Data Model & Ingestion Architecture Spec

**Version:** 1.0  
**Date:** 2026-06-16  
**Status:** Draft — awaiting review  
**Feeds into:** Slice 0 (Foundations) and Slice 1 (Whoop adapter)

---

## Purpose of this document

This spec defines the normalised schema, the adapter contract, the unit normalisation rules, the deduplication strategy, and the ingestion flow for Irfan's personal health data platform. It is written to be handed directly to Claude Code for implementation. Nothing here should require interpretation — every name, type, constraint, and rule is stated explicitly.

What this spec is not: it is not a feature spec, not a dashboard spec, and not a deployment guide. Those come later.

---

## Section 1 — Schema tables

The schema lives in a **dedicated Supabase project**, isolated from all other Supabase projects (Seamlify People, Seamlify Ops). It is single-user and treats all data as PHI.

Six tables. Two are infrastructure (`sources`, `ingestion_log`). Four are data (`health_observations`, `bp_readings`, `lab_panels`, `lab_values`).

---

### Table 1: `sources`

Registry of all data adapters. One row per source, inserted at setup time and not modified by ingestion jobs.

```sql
CREATE TABLE sources (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text        UNIQUE NOT NULL,
  display_name    text        NOT NULL,
  adapter_version text        NOT NULL DEFAULT '0.1.0',
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

**Initial rows (seed data):**

| slug | display_name |
|---|---|
| `whoop` | Whoop |
| `withings` | Withings |
| `nightscout` | Nightscout (CGM) |
| `tidepool` | Tidepool (fingerstick) |
| `oxylink_csv` | Oxylink / ViHealth CSV |
| `labs_pdf` | Lab report (PDF import) |
| `manual` | Manual entry |

The wearable swap in November 2026 (Oura or Fitbit Air) adds one new row here (`oura` or `fitbit_air`) and requires no other schema change.

---

### Table 2: `ingestion_log`

Every ingestion run — scheduled or manual — writes one row here before any normalised data is written. This is the audit trail and the re-processing safety net.

```sql
CREATE TABLE ingestion_log (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug          text        NOT NULL REFERENCES sources(slug),
  triggered_at         timestamptz NOT NULL DEFAULT now(),
  fetch_window_start   timestamptz,          -- null for episodic imports (labs, CSV)
  fetch_window_end     timestamptz,          -- null for episodic imports
  raw_payload          jsonb,                -- full API response or parsed file content
  records_found        int,
  records_written      int,
  records_skipped      int,                  -- duplicates / no-change upserts
  status               text        NOT NULL DEFAULT 'pending',
  error_detail         text,
  completed_at         timestamptz
);

-- status must be one of these values
ALTER TABLE ingestion_log
  ADD CONSTRAINT chk_status
  CHECK (status IN ('pending', 'success', 'partial', 'error'));
```

The `raw_payload` column stores exactly what the source API returned (or the parsed file content for CSV/PDF imports), before any normalisation. If a unit conversion bug is found later, this column is what enables re-processing historical records without re-pulling from the source.

---

### Table 3: `health_observations`

The workhorse table. Handles three of the four data shapes: `time_series`, `daily_summary`, and `discrete`. (Episodic lab data goes to `lab_panels`/`lab_values`; BP goes to `bp_readings`.)

One row = one value of one metric at one point in time (or one period).

```sql
CREATE TABLE health_observations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug      text        NOT NULL REFERENCES sources(slug),
  source_record_id text        NOT NULL,
  data_shape       text        NOT NULL,
  metric_type      text        NOT NULL,
  recorded_at      timestamptz,              -- set for time_series and discrete
  period_start     timestamptz,              -- set for daily_summary
  period_end       timestamptz,              -- set for daily_summary
  numeric_value    numeric,
  unit             text,                     -- as reported by source (e.g. 'mg/dL')
  canonical_value  numeric,
  canonical_unit   text,                     -- normalised unit (e.g. 'mmol/L')
  extras           jsonb,                    -- source/shape-specific metadata
  ingestion_log_id uuid        REFERENCES ingestion_log(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_slug, source_record_id)
);

-- Either recorded_at must be set, or both period dates must be set
ALTER TABLE health_observations
  ADD CONSTRAINT chk_time_coverage
  CHECK (
    recorded_at IS NOT NULL
    OR (period_start IS NOT NULL AND period_end IS NOT NULL)
  );

-- data_shape must be one of the four defined shapes
ALTER TABLE health_observations
  ADD CONSTRAINT chk_data_shape
  CHECK (data_shape IN ('time_series', 'daily_summary', 'discrete', 'episodic'));
```

**Indexes:**

```sql
-- Primary trend query: a metric over a date range
CREATE INDEX idx_obs_metric_recorded
  ON health_observations (metric_type, recorded_at DESC)
  WHERE recorded_at IS NOT NULL;

-- Daily summary trend query
CREATE INDEX idx_obs_metric_period
  ON health_observations (metric_type, period_start DESC)
  WHERE period_start IS NOT NULL;

-- Source-level queries (e.g. "what did Whoop send last night")
CREATE INDEX idx_obs_source_date
  ON health_observations (source_slug, recorded_at DESC);
```

**How each source maps into this table:**

| Source | data_shape | Rows per ingestion unit |
|---|---|---|
| Whoop | `daily_summary` | ~8 rows per day (one per metric: recovery, strain, HRV, resting HR, sleep score, total sleep, deep sleep, REM, respiratory rate) |
| Nightscout (CGM) | `time_series` | ~288 rows per day (one per 5-min glucose reading) |
| Tidepool / Apple Health fingerstick | `discrete` | One row per fingerstick event |
| Oxylink CSV | `daily_summary` | 2 rows per overnight session (SpO2 avg, SpO2 min) |
| Manual entry (weight, glucose) | `discrete` | One row per entry |

**`extras` JSONB usage examples by source:**

- Whoop daily summary: `{"cycle_id": "abc123", "sleep_stages": {"rem_pct": 22, "deep_pct": 18, "light_pct": 52, "awake_pct": 8}}`
- Nightscout CGM reading: `{"trend": "Flat", "trend_arrow": "→", "noise": 1, "device": "G7"}`
- Oxylink overnight: `{"session_duration_min": 482, "movement_events": 14, "pulse_avg_bpm": 58}`

---

### Table 4: `bp_readings`

Blood pressure is always queried as a unit (systolic + diastolic + pulse from the same moment). It gets its own table with explicit typed columns rather than going into the generic `health_observations` envelope.

```sql
CREATE TABLE bp_readings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug      text        NOT NULL REFERENCES sources(slug),
  source_record_id text        NOT NULL,
  measured_at      timestamptz NOT NULL,
  systolic_mmhg    smallint    NOT NULL,
  diastolic_mmhg   smallint    NOT NULL,
  pulse_bpm        smallint,               -- nullable: not always captured
  position         text,                   -- 'sitting' | 'lying' | null
  extras           jsonb,                  -- e.g. Withings arrhythmia flag
  ingestion_log_id uuid        REFERENCES ingestion_log(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_slug, source_record_id)
);

-- Trend query: all BP readings in a date range
CREATE INDEX idx_bp_measured
  ON bp_readings (measured_at DESC);
```

Blood pressure is always stored in mmHg. Withings returns mmHg natively; no conversion required. If a future source returns in kPa, the adapter converts before writing.

`position` is captured if the source provides it. Withings does not currently surface this via the API but the column is there for manual entry.

---

### Table 5: `lab_panels`

One row per blood draw or lab visit. The anchor for all lab imports.

```sql
CREATE TABLE lab_panels (
  id                 uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug        text  NOT NULL REFERENCES sources(slug),  -- default: 'labs_pdf'
  drawn_at           date  NOT NULL,
  lab_name           text,              -- e.g. 'Fakeeh University Hospital'
  ordering_physician text,
  notes              text,
  raw_file_ref       text,              -- identifier or path of the source PDF
  ingestion_log_id   uuid  REFERENCES ingestion_log(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lp_drawn
  ON lab_panels (drawn_at DESC);
```

There is no `source_record_id` / unique constraint here because a PDF import has no natural deduplication key. The labs adapter guards against accidental re-import by checking for an existing row with the same `(source_slug, drawn_at, lab_name)` before inserting, and prompts the user to confirm if a match is found. This is handled in application logic, not a DB constraint, because two draws from the same lab on the same day (different panels) is a valid scenario.

---

### Table 6: `lab_values`

Individual markers from a panel. These are the rows you trend over time (e.g., LDL across six draws).

```sql
CREATE TABLE lab_values (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id         uuid    NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,
  marker_slug      text    NOT NULL,     -- controlled vocabulary (see §2)
  raw_marker_name  text    NOT NULL,     -- exactly as it appeared on the report
  numeric_value    numeric,              -- null if result is text-only
  text_value       text,                 -- for results like 'Negative' or '<5'
  unit             text,
  canonical_value  numeric,
  canonical_unit   text,
  ref_low          numeric,              -- reference range low, as on the report
  ref_high         numeric,              -- reference range high, as on the report
  ref_unit         text,
  flag             text,                 -- 'H' | 'L' | 'HH' | 'LL' | 'N' as on report
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Trend query: a specific marker across all panels
CREATE INDEX idx_lv_marker
  ON lab_values (marker_slug, panel_id);

-- All values in a panel
CREATE INDEX idx_lv_panel
  ON lab_values (panel_id);
```

---

### Row Level Security

Every table has RLS enabled. For a single-user project the policy is simple: only an authenticated user can read or write. Since there is only one user (Irfan), there is no per-row user ID needed — authenticated = authorised.

```sql
ALTER TABLE sources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_readings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_panels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_values       ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated session can do anything; no anonymous access
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
```

The Vercel backend (ingestion functions) connects using the Supabase **service role key**, which bypasses RLS. This key is stored as a Vercel environment secret and never committed to git. The dashboard frontend connects using the **anon key** with a valid user session — RLS applies.

---

## Section 2 — Enums and controlled vocabularies

These are not Postgres ENUMs (which require a migration to extend). They are plain `text` columns with application-level validation. Adding a new metric type or source slug requires no schema migration — only a new row in `sources` or a new entry in the controlled vocabulary documented here.

---

### `data_shape` values

| Value | Meaning | Time fields used |
|---|---|---|
| `time_series` | A continuous stream of readings at sub-day intervals (CGM, raw HR) | `recorded_at` |
| `daily_summary` | One aggregated value per day (Whoop recovery, daily sleep) | `period_start`, `period_end` |
| `discrete` | A single point-in-time reading with no implied series (BP is in its own table; this covers weight, fingerstick glucose, manual entries) | `recorded_at` |
| `episodic` | Data imported in a batch covering a defined window (Oxylink overnight session) | `period_start`, `period_end` |

---

### `metric_type` controlled vocabulary

Used in `health_observations.metric_type`. Values are lowercase snake_case strings.

**Cardiac / circulatory:**

| Value | Description | Canonical unit |
|---|---|---|
| `heart_rate_resting` | Daily resting HR from wearable | bpm |
| `heart_rate_instant` | Point-in-time HR reading | bpm |
| `hrv_rmssd` | HRV, RMSSD method | ms |

**Sleep and recovery (Whoop primary source):**

| Value | Description | Canonical unit |
|---|---|---|
| `sleep_score` | Wearable sleep quality score | dimensionless (0–100) |
| `sleep_duration_total` | Total sleep | minutes |
| `sleep_duration_deep` | Deep / slow-wave sleep | minutes |
| `sleep_duration_rem` | REM sleep | minutes |
| `sleep_duration_light` | Light sleep | minutes |
| `sleep_duration_awake` | Awake time during sleep window | minutes |
| `recovery_score` | Whoop daily recovery score | dimensionless (0–100) |
| `strain_score` | Whoop daily strain score | dimensionless (0–21) |
| `respiratory_rate` | Nightly average respiratory rate | breaths/min |
| `skin_temperature_deviation` | Nightly skin temp deviation from baseline (Oura-style) | °C |

**Oxygen:**

| Value | Description | Canonical unit |
|---|---|---|
| `spo2_overnight_avg` | Average overnight SpO2 | % |
| `spo2_overnight_min` | Lowest overnight SpO2 | % |
| `spo2_instant` | Point-in-time SpO2 reading | % |

**Glucose:**

| Value | Description | Canonical unit |
|---|---|---|
| `glucose_cgm` | Continuous glucose reading from CGM sensor | mmol/L |
| `glucose_fingerstick` | Manual fingerstick glucose reading | mmol/L |

**Body composition:**

| Value | Description | Canonical unit |
|---|---|---|
| `weight` | Body weight | kg |
| `bmi` | Body mass index (if calculated by device) | kg/m² |

Blood pressure is not in this vocabulary — it lives in `bp_readings`.

---

### `marker_slug` controlled vocabulary for `lab_values`

These are the lab markers of clinical relevance given Irfan's cardiac picture. The list is not exhaustive — any marker on a lab report gets a `raw_marker_name` regardless; the `marker_slug` is the standardised identifier for markers we can trend.

**Lipids:**

| slug | Description |
|---|---|
| `ldl_cholesterol` | LDL cholesterol |
| `hdl_cholesterol` | HDL cholesterol |
| `total_cholesterol` | Total cholesterol |
| `triglycerides` | Triglycerides |
| `lipoprotein_a` | Lipoprotein(a) — see unit warning in §4 |
| `non_hdl_cholesterol` | Non-HDL cholesterol |
| `vldl_cholesterol` | VLDL cholesterol |

**Metabolic:**

| slug | Description |
|---|---|
| `fasting_glucose` | Fasting plasma glucose |
| `hba1c` | HbA1c / glycated haemoglobin |
| `insulin_fasting` | Fasting insulin |

**Renal / electrolytes:**

| slug | Description |
|---|---|
| `creatinine` | Serum creatinine |
| `egfr` | eGFR |
| `sodium` | Sodium |
| `potassium` | Potassium |
| `urea` | Blood urea nitrogen / urea |

**Haematology:**

| slug | Description |
|---|---|
| `haemoglobin` | Haemoglobin |
| `wbc` | White blood cell count |
| `platelets` | Platelet count |
| `haematocrit` | Haematocrit |

**Inflammation / cardiac enzymes:**

| slug | Description |
|---|---|
| `crp` | C-reactive protein |
| `hs_crp` | High-sensitivity CRP |
| `troponin_i` | Troponin I |
| `bnp` | BNP (brain natriuretic peptide) |
| `nt_pro_bnp` | NT-proBNP |

**Thyroid:**

| slug | Description |
|---|---|
| `tsh` | Thyroid-stimulating hormone |
| `free_t4` | Free T4 |

**Liver:**

| slug | Description |
|---|---|
| `alt` | ALT (alanine aminotransferase) — monitored on statins |
| `ast` | AST |
| `ggt` | GGT |
| `alk_phos` | Alkaline phosphatase |
| `bilirubin_total` | Total bilirubin |

Any marker on a report that does not match a slug in this list receives `marker_slug = 'unknown'` and `raw_marker_name` captures exactly what the report says. This ensures no data is lost; the slug can be standardised later.

---

### Unit strings

Units are stored as plain text strings. The following strings are canonical — adapters must emit exactly these in `canonical_unit`:

| Canonical string | Meaning |
|---|---|
| `mmol/L` | Millimoles per litre (glucose, lipids) |
| `nmol/L` | Nanomoles per litre (Lp(a) canonical) |
| `mmHg` | Millimetres of mercury (BP) |
| `bpm` | Beats per minute |
| `ms` | Milliseconds (HRV) |
| `%` | Percentage (SpO2, body fat) |
| `min` | Minutes (sleep durations) |
| `kg` | Kilograms (weight) |
| `kg/m2` | BMI |
| `breaths/min` | Respiratory rate |
| `°C` | Celsius (temperature) |
| `g/dL` | Grams per decilitre (haemoglobin) |
| `U/L` | Units per litre (liver enzymes) |
| `pmol/L` | Picomoles per litre (thyroid) |
| `mU/L` | Milli-international units per litre (TSH) |
| `mg/L` | Milligrams per litre (CRP, hs-CRP) |
| `dimensionless` | Scores and ratios with no unit (recovery, strain, sleep score) |

Source units (what the API returns, stored in `unit`) can be any string — common examples: `mg/dL`, `lbs`, `g`, `seconds`, `hours`, `°F`.

---

## Section 3 — The adapter contract

Every data source is implemented as a TypeScript module conforming to this contract. The contract is the only interface between a source and the rest of the platform — adapters do not call each other, do not share state, and do not write to tables they do not own.

---

### Interfaces

```typescript
// The shape every adapter must export
interface Adapter {
  readonly sourceSlug: string            // must match a row in sources.slug
  fetchAndIngest(config: AdapterConfig): Promise<IngestionResult>
}

// Configuration passed to every adapter at runtime
interface AdapterConfig {
  supabase: SupabaseClient               // authenticated admin client (service role)
  credentials: AdapterCredentials        // source-specific auth data
  fromDate?: Date                        // optional: start of backfill window
  toDate?: Date                          // optional: end of window; default = now()
}

// Source-specific credentials — shape varies by source but always resolved from env
interface AdapterCredentials {
  [key: string]: string                  // e.g. { accessToken, refreshToken } for OAuth
}

// What fetchAndIngest returns
interface IngestionResult {
  ingestionLogId: string
  recordsFound: number
  recordsWritten: number
  recordsSkipped: number
  errors: string[]                       // non-fatal per-record errors
  status: 'success' | 'partial' | 'error'
}
```

---

### Responsibilities of every adapter

An adapter must do the following, in this order:

1. **Resolve the fetch window.** If `fromDate` is provided, use it. Otherwise, query `ingestion_log` for the most recent successful run for this `sourceSlug` and use its `fetch_window_end` as the start. On the very first run, use a configured backfill date (defined per-adapter as a constant).

2. **Insert an `ingestion_log` row** with `status = 'pending'` and the resolved fetch window. Capture the returned `id` as `ingestionLogId`. All subsequent writes stamp this ID.

3. **Authenticate with the source.** For OAuth2 sources: check if the access token is expired; if so, use the refresh token to obtain a new one and update the stored credentials. Tokens are read from and written to Vercel/Supabase environment secrets — never to the database.

4. **Fetch from the source API** for the resolved window. Store the raw API response in `ingestion_log.raw_payload`.

5. **Normalise each record.** For each record in the response:
   - Map source fields to the destination table's columns
   - Call `normaliseUnit(value, fromUnit, toUnit)` (see §4) to populate `canonical_value` and `canonical_unit`
   - Populate `extras` with any source-specific fields not captured in top-level columns
   - Set `source_record_id` to the source's unique identifier for that record (see §5 for the deduplication strategy)

6. **Upsert to the destination table.** Use `INSERT ... ON CONFLICT (source_slug, source_record_id) DO UPDATE SET ...` (see §5 for the full upsert semantics). Stamp `ingestion_log_id` on every row.

7. **Update `ingestion_log`** with final counts, status, and `completed_at`. If any records failed normalisation (e.g. an unknown unit), set `status = 'partial'` and log the per-record error in the adapter's `errors` array. If the API call itself failed, set `status = 'error'` and write `error_detail`.

---

### What adapters must NOT do

- Write to tables they do not own (e.g. the Whoop adapter must not write to `bp_readings`).
- Silently swallow errors. A normalisation failure must be logged in `errors` and must not produce a row with null canonical values where a canonical value was expected.
- Store credentials in the database or in source code.
- Apply any business logic or interpretation beyond normalisation (e.g. flagging a BP as "high" — that is dashboard logic, not adapter logic).

---

### Source-record ID conventions

Each source has a natural ID for its records. Adapters must use these:

| Source | `source_record_id` |
|---|---|
| Whoop | `cycle_id` (for daily summaries) or `sleep_id` (for sleep records) appended with the metric type: e.g. `cycle_123456_recovery_score` |
| Withings | Withings `devid` + `date` for weight; Withings measurement `grpid` for BP |
| Nightscout | Nightscout entry `_id` |
| Tidepool | Tidepool `id` field |
| Oxylink CSV | SHA-256 hash of `(session_date + metric_type)` — CSVs have no native IDs |
| Manual entry | UUID generated at entry time by the frontend, stored and returned to the adapter |

---

## Section 4 — Unit normalisation

Normalisation happens inside the adapter, before any row is written. The rule is: always store both the original value (as the source reported it) and the canonical value (the platform's standard for that metric). Never discard the original.

The shared utility function:

```typescript
// Pure function — throws if the conversion pair is unknown
function normaliseUnit(
  value: number,
  fromUnit: string,
  toUnit: string
): number
```

If `fromUnit === toUnit`, the function returns `value` unchanged. If the conversion is not in the lookup table, the function throws — this surfaces missing conversions at ingestion time rather than silently producing wrong data.

---

### Conversion table

| From unit | To unit (canonical) | Factor / formula | Notes |
|---|---|---|---|
| `mg/dL` | `mmol/L` | ÷ 18.018 | Glucose |
| `mg/dL` | `mmol/L` | ÷ 38.67 | LDL, HDL, total cholesterol |
| `mg/dL` | `mmol/L` | ÷ 88.57 | Triglycerides |
| `mg/dL` | `nmol/L` | × 2.5 | Lp(a) — **see warning below** |
| `lbs` | `kg` | ÷ 2.2046 | Weight |
| `g` | `kg` | ÷ 1000 | Weight (some scales) |
| `seconds` | `min` | ÷ 60 | Sleep durations (some APIs) |
| `hours` | `min` | × 60 | Sleep durations (some APIs) |
| `°F` | `°C` | (F − 32) × 5/9 | Temperature |
| `kPa` | `mmHg` | × 7.50062 | Blood pressure (future-proofing) |

Units with 1:1 identity (no conversion needed): `mmHg`, `bpm`, `ms`, `%`, `breaths/min`, `mmol/L`, `nmol/L`, `kg`, `min`, `°C`, `dimensionless`, `g/dL`, `U/L`, `pmol/L`, `mU/L`, `mg/L`.

---

### Lipoprotein(a) unit warning

Lp(a) is clinically reported in two incompatible unit systems — mg/dL and nmol/L — and the conversion between them is approximate (the factor varies by particle size distribution). The canonical unit for this platform is `nmol/L`, matching current European cardiology guidelines. The conversion factor `mg/dL × 2.5 → nmol/L` is a population average approximation.

**Adapter behaviour for Lp(a):**
- If the lab report unit is `nmol/L`, store as-is (canonical_value = numeric_value, canonical_unit = nmol/L).
- If the lab report unit is `mg/dL`, apply the × 2.5 factor and set `canonical_unit = nmol/L`.
- If the lab report unit is anything else (e.g. `mg/L`, which some labs use incorrectly), set `canonical_value = null`, log a non-fatal error, and let the user correct it via manual edit.

---

### Where normalisation happens

Normalisation is called by the adapter, not by a DB trigger and not by the dashboard. The reason: normalisation requires knowing the source context (which device, which API version) to interpret the raw unit correctly. A generic DB trigger cannot carry that context. The adapter has full context and is the right place.

---

## Section 5 — Deduplication and idempotency

The ingestion pipeline must be safe to run multiple times without creating duplicate rows. Whoop's API is polled on a schedule — every run will return records that overlap with the previous run. Backfills deliberately re-request historical data.

---

### Primary deduplication mechanism

The UNIQUE constraint on `(source_slug, source_record_id)` in `health_observations` and `bp_readings` is the primary guard.

Adapters write using upsert:

```sql
INSERT INTO health_observations (
  source_slug, source_record_id, data_shape, metric_type,
  recorded_at, period_start, period_end,
  numeric_value, unit, canonical_value, canonical_unit,
  extras, ingestion_log_id
)
VALUES (...)
ON CONFLICT (source_slug, source_record_id)
DO UPDATE SET
  numeric_value    = EXCLUDED.numeric_value,
  unit             = EXCLUDED.unit,
  canonical_value  = EXCLUDED.canonical_value,
  canonical_unit   = EXCLUDED.canonical_unit,
  extras           = EXCLUDED.extras
  -- created_at is intentionally NOT updated (preserves first-seen timestamp)
  -- ingestion_log_id is intentionally NOT updated (preserves first ingestion reference)
WHERE
  health_observations.numeric_value    IS DISTINCT FROM EXCLUDED.numeric_value
  OR health_observations.canonical_value IS DISTINCT FROM EXCLUDED.canonical_value
  OR health_observations.extras          IS DISTINCT FROM EXCLUDED.extras;
```

The `WHERE` clause on the DO UPDATE means the update only fires if something actually changed. If the row already exists with identical values, Postgres treats it as a no-op. The adapter counts rows where the upsert was a no-op as `records_skipped`.

The same pattern applies to `bp_readings`.

---

### Why DO UPDATE, not DO NOTHING

Some sources retroactively update records. Whoop occasionally revises a recovery score after additional data is processed. Withings may correct a weight measurement if the sync was partial. Using DO UPDATE means corrections propagate to the canonical store. Using DO NOTHING would silently preserve the wrong value.

The cost is one extra row comparison per record per run. For the volumes involved (hundreds of rows per day at most), this is negligible.

---

### Lab panel deduplication

Lab panels have no natural `source_record_id` from a PDF. The labs adapter applies a soft guard in application logic:

1. Before inserting a new panel, query: `SELECT id FROM lab_panels WHERE source_slug = 'labs_pdf' AND drawn_at = $drawn_at AND lab_name = $lab_name LIMIT 1`.
2. If a match is found, surface it to the user in the import UI: "A panel from this lab on this date already exists. Import anyway?" The user must confirm.
3. If the user confirms a re-import, the existing panel's `lab_values` rows are deleted (CASCADE) and new ones are inserted. This handles corrected lab reports.
4. If the lab name is unknown or the drawn date is ambiguous, the adapter errors and prompts the user to provide both before proceeding.

This is application-level logic, not a DB constraint, because two different panels (e.g. routine bloods + thyroid function) drawn at the same hospital on the same day is a valid scenario.

---

## Section 6 — Ingestion flow

---

### Scheduled pulls (Whoop, Withings)

These run on a cron schedule via Vercel Cron Jobs. Suggested cadences:

- Whoop: every 6 hours (Whoop daily summaries are finalised a few hours after midnight)
- Withings: every 12 hours (BP and weight are entered infrequently)

**Step-by-step sequence:**

1. The Vercel cron job triggers the adapter's `fetchAndIngest` function via an internal API route (authenticated with a shared secret, not exposed publicly).

2. The adapter resolves the fetch window: reads `ingestion_log` for the most recent `status = 'success'` row for this `source_slug` and uses its `fetch_window_end` as `fromDate`. On first run, uses the adapter's hardcoded `BACKFILL_START_DATE` constant.

3. A new `ingestion_log` row is inserted with `status = 'pending'`, `source_slug`, and the resolved window. The `id` is captured.

4. The adapter checks the stored OAuth access token's expiry. If expired, it calls the source's token refresh endpoint using the stored refresh token. The new access token and its expiry are written back to environment secrets via the Supabase Management API or Vercel API. The old token is overwritten, not appended.

5. The adapter calls the source API with the resolved fetch window. The raw response body is written to `ingestion_log.raw_payload`.

6. The adapter iterates over each record in the response. For each record:
   a. Map source fields to platform schema fields.
   b. Call `normaliseUnit` for each numeric field that requires conversion.
   c. Upsert to the destination table, stamping `ingestion_log_id`.
   d. If `normaliseUnit` throws (unknown unit), log the error in the `errors` array and skip the row. Do not abort the full run.

7. After all records are processed, update `ingestion_log`: set `records_found`, `records_written`, `records_skipped`, `status` (`success` if zero errors, `partial` if some records errored, `error` if the API call itself failed), and `completed_at = now()`.

8. If the API call in step 5 fails entirely (network error, auth failure, rate limit), update `ingestion_log` with `status = 'error'` and `error_detail`. No partial data remains uncommitted.

---

### Episodic imports (Oxylink CSV, Lab PDF)

These are manually triggered by the user via the dashboard UI.

1. User uploads the file in the dashboard.

2. The frontend sends the file to a Vercel serverless function (the adapter's HTTP endpoint). The request is authenticated via the user's Supabase session.

3. The adapter:
   - For **Oxylink CSV**: parses the CSV, extracts the overnight session date and SpO2 columns. Writes a `daily_summary` row for `spo2_overnight_avg` and one for `spo2_overnight_min`.
   - For **Lab PDF**: parses the PDF into structured marker data (implementation deferred to Slice 6). Runs the lab panel deduplication check. If clear, inserts the `lab_panels` row then the `lab_values` rows.

4. The ingestion result (records added, any warnings) is returned to the dashboard and displayed to the user. For the Lp(a) unit warning or other flagged values, the user sees a clear message identifying the specific marker and the issue.

---

### Token storage

OAuth tokens (Whoop, Withings; and later Oura or Google Health API for the wearable swap) are **never stored in the database**. They are stored as:

- **Access tokens**: Vercel environment variables (project-level, encrypted at rest). Rotated on each token refresh.
- **Refresh tokens**: Same. Refresh tokens are long-lived and must be treated as secrets equivalent to passwords.
- **Client ID / Client Secret** for each OAuth app: same Vercel environment variables, set once at setup.

The ingestion functions read tokens from `process.env` (Vercel) or `Deno.env.get()` (Supabase Edge Functions) at runtime. Token rotation (writing back new tokens after a refresh) is handled via the Vercel API from within the adapter — this is the one external call the adapter makes outside its source's API.

---

## Appendix — Open decisions not resolved by this spec

The following decisions are deferred and do not block the spec or Slice 0:

1. **Wearable swap (November 2026):** Oura vs Fitbit Air. One new adapter, one new `sources` row. No schema change required.

2. **CGM brand for next stint:** Libre vs Dexcom. Both route through Nightscout and use the same Nightscout adapter. No schema change required.

3. **Fingerstick path:** Confirm whether the Contour meter is Tidepool-supported, or switch to an Apple Health Bluetooth meter. This affects the Tidepool adapter's `source_record_id` strategy but not the schema.

4. **Lab PDF parsing approach (Slice 6):** The labs adapter spec is deferred. Options include LLM-based extraction (Claude API against the PDF text), a structured OCR pipeline, or manual structured entry. The schema is ready for all three approaches.

5. **Medication adherence tracking:** Flagged in the handover as a useful future feature given Irfan's seven-medication regimen. Not in this schema. Would require a `medications` table and a `medication_log` table. Deferred until the core data model is proven.

---

*End of spec. Next: review and approve, then proceed to Slice 0 — Supabase project setup, schema migration, Vercel skeleton, single-user auth.*
