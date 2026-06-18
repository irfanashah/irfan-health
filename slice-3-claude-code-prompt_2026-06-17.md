# Claude Code Kickoff Prompt — Slice 3 (Manual Entry + Quick-Log UI)

> Paste everything below the line into Claude Code, run from the `irfan-health` repo root.

---

You are implementing **Slice 3 — Manual entry + quick-log UI** for my personal health platform.

**Before writing any code, read these in full and treat them as authoritative:**
1. `CLAUDE.md` (repo root) — the live build record. "Decisions made", all gotchas, and the per-slice status are binding.
2. `slice-3-manual-entry-spec.md` — the full spec for this slice. This is your build instruction set.
3. `health-platform-data-model-spec_v1_2026-06-16.md` — for the `health_observations` and `bp_readings` column definitions, the `discrete` data shape, the `metric_type` controlled vocabulary, and the unit-string rules.
4. The existing app as the pattern reference — `app/page.tsx` (the dashboard: session guard + the existing sign-out **server action**), `app/login/page.tsx`, the Supabase client helpers (`browser`/`server`/`service`), and `app/globals.css` (semantic tokens + accent colours).

## Scope

This is the first **UI-led** slice — **no adapter, no OAuth, no cron, no refill**. Forms write through the `manual` source slug via Next.js **server actions** into `health_observations` (`discrete` shape) and `bp_readings`.

Build (per the spec's Implementation steps):
- `app/log/page.tsx` — session-protected `/log` route (mirror the dashboard's guard).
- `app/log/actions.ts` — `'use server'` actions: `createWeight`, `createGlucose`, `createSymptom`, `createNote`, `createBp`, plus `updateEntry` and `deleteEntry`.
- `app/log/_lib/` — local helpers: plausibility ranges, glucose mg/dL↔mmol/L conversion, and the symptom controlled vocabulary as a typed grouped constant (with `red_flag`). This is local to the slice — **do NOT touch `adapters/_lib/`** (irrelevant here).
- Client components: the four entry forms (segmented control: Weight · Glucose · Symptom · BP) + the recent-entries list with edit and confirmed-delete.

## Hard constraints — do not deviate

- **No migration.** `health_observations`, `bp_readings`, and the `manual` source row already exist. `symptom` and `note` are new `metric_type` text values (application-validated, no schema change) — see spec.
- **All writes:** `source_slug='manual'`, generated `source_record_id` = `manual_<type>_<crypto.randomUUID()>`, `data_shape='discrete'` for `health_observations`, `recorded_at`/`measured_at` always set (default now, user-editable for backdating).
- **One `ingestion_log` row per INSERT** (`status='success'`, `records_found=1`, `records_written=1`, `raw_payload`=submitted form values), linked via `ingestion_log_id`. **Edits and deletes create NO ingestion_log row.**
- **Glucose:** `mmol/L = mg/dL ÷ 18.0`, round canonical to 1 decimal. Store both reported (`numeric_value`/`unit`) and canonical (`canonical_value`/`canonical_unit`) always.
- **Symptom:** `metric_type='symptom'`, severity (1–5, nullable) in `numeric_value`, and `{symptom_code, symptom_label, group, red_flag, note}` in `extras`. `other` requires a note. On a `red_flag` selection, show the calm cardiologist-guidance reminder from the spec — it does not block, diagnose, or trigger anything.
- **Edit/delete guard:** `updateEntry`/`deleteEntry` operate by row `id` and MUST refuse any row where `source_slug != 'manual'`. Delete is a hard delete of a single manual row, behind a confirm dialog.
- **Validate server-side in every action** — never trust the client. Reject out-of-range values (weight 30–250 kg; glucose 2–30 mmol/L; systolic 70–260; diastolic 40–160 and < systolic; pulse 30–220) with a clear message; do not clamp.
- **Semantic Tailwind tokens only**, never hardcoded colours (gotcha #1). Phone-first layout.
- **Supabase:** server client is async (`await`), service client is sync (gotcha #7). `numeric` round-trips as string — `Number()`-coerce before comparing (gotcha #8).

## What I (Irfan) handle, not you — flag, don't attempt

- Deploy (push to `main`) and the post-deploy smoke test (spec Step 7: log one of each type, verify canonical values, edit one, delete one, confirm ingestion_log counts).

There are no credentials or external registrations for this slice — you can build the whole thing.

## Process

1. First, give me a **brief build plan** — file list, build order, and any decision points you see in the spec that need my call (e.g. the starter symptom list — flag if you'd add/remove any). **Wait for my go-ahead before writing code.**
2. Build in logical commits (route + guard → server actions → helpers/vocabulary → forms → recent list/edit/delete), not one giant diff.
3. `npm run build` must pass clean before you call it done.
4. When done, run the session closeout (`/closeout`, or follow `session-closeout-prompt.md`): update `CLAUDE.md` (add the Slice 3 Done entry, any new decisions/gotchas, set Next action to Slice 4) and `PROJECT-STATE.md`, then commit.

Do not push or merge — I drive deploys.
