# Slice 3 — Manual Entry + Quick-Log UI

**Version:** 1.0
**Date:** 2026-06-17
**Prerequisites:** Slices 0, 1, 1.5, 1.6, and 2 complete (scaffold + auth + UI foundations + Whoop + Withings BP).

---

## Overview

The first **UI-led** slice. No OAuth, no API adapter, no cron, no refill — this is a forms-and-writes problem. The user logs data by hand; entries write through the `manual` source slug into `health_observations` (`discrete` shape) and `bp_readings` (manual cuff readings).

Four entry types:
1. **Weight** → `health_observations`, `metric_type = 'weight'`, canonical `kg`.
2. **Fingerstick glucose** → `health_observations`, `metric_type = 'glucose_fingerstick'`, entry in mg/dL or mmol/L, canonical `mmol/L`.
3. **Symptom** → `health_observations`, `metric_type = 'symptom'`, coded value from a controlled vocabulary (dropdown) + severity + optional note.
4. **Manual BP** → `bp_readings` (the data-model reserves `position` "for manual entry").

Plus a **recent-entries list** with **edit-in-place** and **delete (with confirm)** — manual entries are hand-typed and need correction. This edit/delete capability applies to `source_slug = 'manual'` rows ONLY; API-sourced rows (Whoop, Withings) remain immutable.

**No new migration.** `health_observations`, `bp_readings`, and the `manual` source row all already exist (`migration_001_initial_schema.sql`). `symptom` and `note` are new `metric_type` values added to the controlled vocabulary — per data-model spec §2, metric types are application-validated text, so no schema change is required.

---

## Pre-conditions

- `sources` row `slug = 'manual'` exists from the migration_001 seed. No insert.
- Single-user Supabase session auth (Slice 0). The `/log` page and all write actions are session-protected; no `CRON_SECRET` path exists in this slice.
- `adapters/_lib/` is **not** used here — there is no adapter. Writes go straight to the tables via a server-side Supabase client inside Next.js **server actions** (not API routes). Rationale: manual entry is a same-origin authenticated form submit; server actions are simpler and avoid the session-cookie-vs-fetch friction documented in CLAUDE.md gotcha #23.

---

## Data model usage

### `source_record_id` generation (manual rows)

Manual entries have no natural external ID. Generate: `manual_<type>_<uuid>` where `<type>` ∈ `weight | glucose | symptom | note | bp` and `<uuid>` is `crypto.randomUUID()`. Satisfies the `UNIQUE (source_slug, source_record_id)` constraint and makes the row's origin self-describing.

### `recorded_at` / `measured_at`

Default to `now()` but **editable** — the user can backdate an entry (e.g. logging this morning's reading at noon). UI presents a datetime field pre-filled with now.

### Per-type mapping

| Entry | Table | Key fields |
|---|---|---|
| Weight | `health_observations` | `data_shape='discrete'`, `metric_type='weight'`, `numeric_value`=kg, `unit='kg'`, `canonical_value`=same, `canonical_unit='kg'`, `recorded_at` |
| Glucose | `health_observations` | `data_shape='discrete'`, `metric_type='glucose_fingerstick'`, `numeric_value`=as entered, `unit`=`'mg/dL'`\|`'mmol/L'`, `canonical_value`=mmol/L, `canonical_unit='mmol/L'`, `recorded_at` |
| Symptom | `health_observations` | `data_shape='discrete'`, `metric_type='symptom'`, `numeric_value`=severity (1–5, nullable), `unit`=null, `recorded_at`, `extras`={symptom_code, symptom_label, group, red_flag, note} |
| Note | `health_observations` | `data_shape='discrete'`, `metric_type='note'`, `numeric_value`=null, `recorded_at`, `extras`={text} |
| BP | `bp_readings` | `measured_at`, `systolic_mmhg`, `diastolic_mmhg`, `pulse_bpm` (nullable), `position` (`'sitting'`\|`'lying'`\|null), `extras`={arm?} |

All writes set `source_slug='manual'` and a generated `source_record_id`. All `health_observations` writes set `data_shape='discrete'` (satisfies `chk_data_shape`); `recorded_at` is always set (satisfies `chk_time_coverage`).

### Glucose unit conversion

`mmol/L = mg/dL ÷ 18.0` (standard glucose conversion factor). Round canonical to 1 decimal place. If entered in mmol/L, `numeric_value = canonical_value`, `unit = canonical_unit = 'mmol/L'`. Store both reported and canonical always (unit-awareness constraint, handover §8).

### `ingestion_log` for manual writes

Preserve the data-model invariant ("every ingestion run — scheduled or manual — writes one `ingestion_log` row"). Each manual **insert** creates one `ingestion_log` row: `source_slug='manual'`, `status='success'`, `records_found=1`, `records_written=1`, `raw_payload`=the submitted form values (pre-normalisation). Link `ingestion_log_id` on the written row. **Edits and deletes do NOT create ingestion_log rows** — they are corrections to existing data, not ingestion events. (Edit/delete may optionally append an audit note to the row's `extras`, but no new log row.)

---

## Controlled vocabulary additions

### New `metric_type` values (documented, no migration)

| Value | Description | Canonical unit | numeric_value |
|---|---|---|---|
| `symptom` | A logged symptom event from the controlled list below | — (null unit) | severity 1–5 (nullable) |
| `note` | A free-text note not tied to a symptom | — | null |

(`weight` and `glucose_fingerstick` already exist in the data-model §3 vocabulary.)

### Symptom controlled vocabulary

Stored as `extras.symptom_code` (snake_case). The dropdown is grouped by `group`. `red_flag = true` marks symptoms matching Irfan's cardiologist emergency guidance. This list is the starter set — extendable by adding entries here, no migration.

**Cardiac / circulatory**
- `chest_pain` — Chest pain **(red flag)**
- `chest_tightness` — Chest tightness **(red flag)**
- `palpitations` — Palpitations / racing heart
- `dizziness_standing` — Dizziness or lightheadedness on standing/walking **(red flag)**
- `lightheadedness` — Lightheadedness (general)
- `syncope` — Fainting / blackout
- `ankle_swelling` — Ankle or leg swelling (oedema)

**Respiratory**
- `shortness_of_breath` — Shortness of breath / breathlessness **(red flag)**
- `breathlessness_exertion` — Breathlessness on exertion
- `cough` — Cough
- `wheezing` — Wheezing

**General**
- `fatigue` — Fatigue / unusual tiredness
- `weakness` — Generalised weakness
- `sweating` — Cold sweat / sweating (diaphoresis)
- `fever` — Fever
- `chills` — Chills

**Gastrointestinal**
- `nausea` — Nausea
- `vomiting` — Vomiting
- `indigestion` — Indigestion / heartburn
- `appetite_loss` — Loss of appetite

**Neurological**
- `headache` — Headache
- `blurred_vision` — Blurred vision
- `numbness_tingling` — Numbness or tingling

**Other**
- `poor_sleep` — Poor sleep
- `anxiety` — Anxiety / unease
- `other` — Other (requires free-text note)

### Red-flag handling (safety)

When a `red_flag` symptom is selected, the form shows a calm, factual reminder of the cardiologist's standing guidance — *"Your cardiologist's guidance: chest pain, shortness of breath, chest tightness, or dizziness while standing or walking means go to hospital immediately. This log is for tracking, not for emergencies."* It does not block logging; it does not diagnose; it does not call anything. This mirrors handover §2 (the early-warning system is symptom-based and routes to hospital; the data system is for drift, not acute alarms).

---

## UI / UX

### Route

`/log` — new page, session-protected (redirects to `/login` if unauthenticated, same pattern as the dashboard). Phone-first layout (Irfan logs on the go); single column, large touch targets, semantic tokens only (gotcha #1).

### Entry forms

Four entry types presented as a segmented control / tabs at the top: **Weight · Glucose · Symptom · BP**. One active form at a time. Every form has a datetime field defaulting to now (editable, for backdating) and a Save button.

- **Weight:** single numeric field (kg). Plausibility guard 30–250 kg.
- **Glucose:** numeric field + unit toggle (mg/dL | mmol/L), default mmol/L. Show the converted value inline as the user types. Plausibility guard 2–30 mmol/L (≈36–540 mg/dL).
- **Symptom:** grouped dropdown (the vocabulary above) + severity selector (1–5) + optional note textarea. Selecting `other` requires the note. Red-flag reminder appears on red-flag selection.
- **BP:** systolic + diastolic (required), pulse (optional), position select (sitting | lying | —), optional arm note. Plausibility guards systolic 70–260, diastolic 40–160, pulse 30–220; reject diastolic ≥ systolic.

Validation is client-side for UX plus server-side in the action (never trust the client). Out-of-range values are rejected with a clear message, not silently clamped.

### Recent entries

Below the forms, a "Recent" list — the last ~20 manual entries across all four types, newest first, each showing type, value/summary, and timestamp. Each row has **Edit** (re-opens the relevant form pre-filled, writes in place) and **Delete** (confirmation dialog: *"Delete this entry? This can't be undone."* → hard delete of that single manual row). Edit/Delete are available for `source_slug='manual'` rows only.

### Dashboard

Out of scope for visualisation (that's Slice 7). Optionally add a single nav link from the dashboard to `/log`. No charts.

---

## Implementation steps

### Step 1: `/log` route + auth guard
`app/log/page.tsx` — server component, session check mirroring the dashboard, renders the client logging UI.

### Step 2: Server actions
`app/log/actions.ts` — `'use server'` actions: `createWeight`, `createGlucose`, `createSymptom`, `createNote`, `createBp`, plus `updateEntry` and `deleteEntry`. Each verifies the session, validates server-side, generates `source_record_id`, writes the `ingestion_log` row (inserts only), and writes the data row with `ingestion_log_id` linked. `updateEntry`/`deleteEntry` guard `source_slug='manual'` and operate by row `id`.

### Step 3: Shared validation + conversion helpers
`app/log/_lib/` (local to this slice; not the adapter `_lib`) — plausibility ranges, the glucose mg/dL↔mmol/L conversion, the symptom vocabulary as a typed constant (grouped, with `red_flag`).

### Step 4: Entry forms (client components)
The segmented control + four forms + inline glucose conversion + red-flag reminder. Semantic tokens throughout.

### Step 5: Recent-entries list + edit/delete
Fetch last ~20 manual rows (union across `health_observations` where `source_slug='manual'` + `bp_readings` where `source_slug='manual'`), render newest-first, wire Edit (pre-fill) and Delete (confirm dialog).

### Step 6: Build + verify locally
`npm run build` must pass clean.

### Step 7 (MANUAL — Irfan): smoke test on Vercel
After deploy: log one of each type; confirm rows land with correct `canonical_value`/`canonical_unit`; edit one; delete one (confirm it's gone); confirm an `ingestion_log` row exists per insert and none per edit/delete.

---

## Verification checklist

- [ ] `/log` is session-protected and renders all four forms
- [ ] Weight writes `health_observations` discrete row, `kg` canonical
- [ ] Glucose entered in mg/dL stores correct mmol/L canonical (e.g. 126 mg/dL → 7.0 mmol/L)
- [ ] Symptom writes `metric_type='symptom'`, severity in `numeric_value`, code/label/group/red_flag/note in `extras`
- [ ] `other` symptom requires a note; red-flag reminder shows on red-flag selection
- [ ] BP writes `bp_readings` with `source_slug='manual'`, position captured, diastolic<systolic enforced
- [ ] Each insert creates exactly one `ingestion_log` row (`status='success'`, `records_written=1`); edit/delete create none
- [ ] Recent list shows last ~20 manual entries across types; Edit writes in place; Delete (after confirm) removes the single row
- [ ] Edit/Delete refuse to touch non-`manual` rows
- [ ] Out-of-range values rejected server-side, not clamped
- [ ] `npm run build` clean

---

## Out of scope

- Charts, trends, dashboard visualisation (Slice 7)
- CGM and lab fingerstick imports (Slices 5–6) — this is *manual* fingerstick only
- Reminders / notifications to prompt logging
- Bulk import / CSV of historical manual data
- Any auto-population from other sources

---

*End of Slice 3 spec. Next: Slice 4 — Oxylink SpO2 (Apple Health and/or CSV import).*
