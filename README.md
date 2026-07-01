# Irfan's Health Platform

A personal, single-user health data platform for a post-STEMI cardiac patient. It pulls
data from wearables and devices (Whoop, Withings, Nightscout/CGM, Oxylink SpO2, Contour
fingerstick), lets Irfan log manual entries, meds, and meals, and turns all of it into a
trend dashboard, a personal-baseline drift engine, a lagged-correlation discovery engine,
and a printable doctor record — with an explicit honesty discipline (associational, not
causal; provisional clinical thresholds always labelled as such).

This is a solo, Claude-Code-driven build. The **authoritative build record** is
[`CLAUDE.md`](./CLAUDE.md) (full history, every decision, the gotchas list) and
[`PROJECT-STATE.md`](./PROJECT-STATE.md) (the current concise snapshot — read this first
when picking up work). Slice/feature specs live at the repo root as
`*-spec_YYYY-MM-DD.md`.

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript, `strict: true`
- **Tailwind CSS v4** (CSS-based `@theme` config, no `tailwind.config.ts`) + shadcn/ui
- **Supabase** — Postgres + Auth + Storage (single dedicated project, RLS on every table)
- **Vercel Pro** — hosting, cron jobs, deploys auto on `main`
- **Anthropic API** (`@anthropic-ai/sdk`) — Labs PDF extraction + food-diary macro estimation
- **Resend** — transactional email (pipeline-health + adherence-reminder crons)
- **Google Drive API** (`googleapis`) — file-drop ingestion (Oxylink, Contour)
- **Vitest** — unit tests over the platform's pure statistical/clinical-classifier core

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in what you have. Nothing here is
committed. Missing optional keys degrade gracefully (documented per-row below) rather than
crashing routes.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (browser + server, RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service-role key — server-only, bypasses RLS. Every adapter/cron/action reads via this; never import client-side. |
| `CRON_SECRET` | Yes | Bearer token every `/api/cron/*` route checks. Must always be set — an unset value degrades to the literal string `"Bearer undefined"`. |
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` | For Whoop | OAuth app credentials (Whoop Developer Dashboard) |
| `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET` | For Withings | OAuth app credentials (Withings Developer) |
| `NIGHTSCOUT_URL` / `NIGHTSCOUT_TOKEN` | For CGM | Self-hosted Nightscout base URL + read-only token (static auth, not OAuth) |
| `GDRIVE_SA_KEY` | For file-drop | Google service-account JSON, **base64-encoded** (`base64 -i key.json`), not raw JSON |
| `GDRIVE_ROOT_FOLDER_ID` | For file-drop | Drive folder ID containing `inbox/<source>/` subfolders (Oxylink, Contour) |
| `ANTHROPIC_API_KEY` | For Labs + Food diary | Missing key → those routes return a clear error / manual-entry fallback, never a 500 |
| `RESEND_API_KEY` | For email alerts | Missing key → cron email is a silent no-op (`console.warn`), cron still completes |
| `ALERT_EMAIL_TO` | For email alerts | Destination for pipeline-health digest + adherence-reminder nudge |
| `ALERT_EMAIL_FROM` | Optional | Defaults to Resend's verified test sender (`onboarding@resend.dev`) — zero DNS setup |
| `NEXT_PUBLIC_APP_URL` | Optional | Base URL used in a couple of absolute links |

## Database — migration apply order

Migrations are applied **by hand** in the Supabase SQL editor (there's no migration
runner yet — tracked as tech debt). Apply in numeric order. Views and functions are
`CREATE OR REPLACE` and safe to re-run any time the SQL changes; tables use
`CREATE TABLE IF NOT EXISTS`; everything is idempotent.

| # | File | What it does | Re-run behavior |
|---|---|---|---|
| 001 | `migration_001_initial_schema.sql` | Core schema: `sources`, `ingestion_log`, `health_observations`, `bp_readings`, plus reserved `lab_panels`/`lab_values` | Idempotent tables |
| 002 | `migration_002_oauth_tokens.sql` | `oauth_tokens` (deny-all RLS — only the service role reads it) | Idempotent |
| 003 | `migration_003_daily_metrics_view.sql` | `daily_metrics` VIEW — the one-row-per-day aggregation everything else reads | **`CREATE OR REPLACE` — re-run whenever this file changes** (it has, many times) |
| 004 | `migration_004_baselines_drift.sql` | `anchor_sets`, `context_periods`, `med_changes` tables + the `metric_drift` VIEW | Tables idempotent; **view is `CREATE OR REPLACE`** |
| 005 | `migration_005_set_anchor_functions.sql` | `compute_anchor_stats()` / `set_anchor()` PL/pgSQL functions | **`CREATE OR REPLACE FUNCTION` — safe to re-run** |
| 006 | `migration_006_contour_source.sql` | Seeds the `contour` row in `sources` | `ON CONFLICT DO NOTHING` |
| 007 | `migration_007_whoop_spo2_rename.sql` | One-time in-place re-stamp: `spo2_overnight_avg` → `spo2_whoop` for Whoop rows | Idempotent (`WHERE` clause matches nothing after the first run) |
| 008 | `migration_008_labs.sql` | Seeds `labs` source + `lab_marker_aliases` table | Idempotent |
| 009 | `migration_009_labs_ref_ranges.sql` | `lab_marker_ref_ranges` table + `lab_values.ref_source` column | Idempotent |
| 010 | `migration_010_medications.sql` | `medications` table, seeded with the current regimen | Idempotent |
| 011 | `migration_011_med_adherence.sql` | `med_adherence` table (one-tap daily DAPT tracking) | Idempotent |
| 012 | `migration_012_food_diary.sql` | `meals` table | Idempotent |
| 013 | `migration_013_perf_indexes.sql` | Hot-path indexes on `ingestion_log` + `health_observations` | Idempotent |

Also required, created via the Supabase Studio UI (not SQL): a private Storage bucket
named `lab-reports` (~25 MB limit) for Labs PDF uploads.

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in what you have
npm run dev                        # http://localhost:3000
```

Useful scripts:

```bash
npm run build       # production build (Turbopack)
npm run lint        # eslint — currently has pre-existing findings in a few
                     # live dashboard components (see PROJECT-STATE.md Open items);
                     # not enforced as a hard CI gate yet
npx tsc --noEmit     # typecheck only
npm run test         # vitest — pure-function unit tests (no DB/network required)
npm run test:watch   # vitest in watch mode
```

CI (`.github/workflows/ci.yml`) runs typecheck + lint (advisory) + tests on every push
and PR against `main`.

### Tests

`npm run test` covers the platform's pure, deterministic, high-consequence logic — the
statistical engine (`components/dashboard/charts/stats.ts`, `connections/engine.ts`), the
drift gate (`drift/evaluate.ts`), the clinical classifiers (`bpCategory`,
`evaluateLabMarker`, `computeFlag`), the glucose unit conversion, the GST calendar-day
helpers, and the Oxylink/Contour file-drop parsers (fed fixed CSV byte strings, no Drive
needed). It does **not** cover anything requiring a live Supabase/Anthropic/Google Drive
connection — those paths are verified manually against the deployed app per the "Expected
after deploy" notes in `CLAUDE.md`.

## Where to look next

- **`PROJECT-STATE.md`** — current state, next action, open items. Start here after a
  context reset.
- **`CLAUDE.md`** — the full build record: every slice, every decision, the complete
  gotchas list. The authoritative source when `PROJECT-STATE.md` and the code disagree.
- **`*-spec_YYYY-MM-DD.md`** — per-feature build specs at the repo root.
