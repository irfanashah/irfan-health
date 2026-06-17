# Slice 2 — Withings BP Adapter

**Version:** 1.0
**Date:** 2026-06-17
**Prerequisites:** Slices 0, 1, and 1.6 complete (scaffold + auth + UI foundations + Whoop adapter end-to-end + refill route).

---

## Overview

Second source adapter. Proves the contract generalises to a **different data shape** (discrete BP readings, not daily summaries) and a **different destination table** (`bp_readings`, not `health_observations`). Same architectural shape as Slice 1, with two improvements baked in from the start:

- **ID-diff refill route built first**, not last. Skip the chunked-sweep dead end entirely (CLAUDE.md gotcha #23).
- **Null-field filter is applied in both the adapter and the refill route from day one** (CLAUDE.md gotcha #24).

The `bp_readings` table already exists in `migration_001_initial_schema.sql`. No new migration. Withings BP measurements come back as **measurement groups** keyed on `grpid` — one group per BP reading containing systolic + diastolic + (optionally) pulse. One `grpid` → one row in `bp_readings`.

---

## Pre-conditions

- Withings developer app registered at https://developer.withings.com. Application type = "Public API integration". Redirect URI registered as exactly `https://irfan-health.vercel.app/api/auth/withings/callback`. Scopes include `user.metrics`. `WITHINGS_CLIENT_ID` + `WITHINGS_CLIENT_SECRET` in hand.
- Vercel Pro (already on it post-Slice-1).
- `adapters/_lib/` exists with `types.ts`, `normalise.ts`, `ingestion-log.ts`, `token-store.ts`. **No changes to these** — they're reused as-is.
- `oauth_tokens` table exists (`migration_002_oauth_tokens.sql`). It's per-source, keyed on `source_slug`. The Whoop row stays; we add a Withings row via the handshake.

---

## Withings API specifics

### OAuth2

- Authorization URL: `https://account.withings.com/oauth2_user/authorize2`
- Token URL: `https://wbsapi.withings.net/v2/oauth2` with body param `action=requesttoken`
- Token response is wrapped: `{ status: 0, body: { access_token, refresh_token, expires_in, ... } }`. Status non-zero = error; surface `body.error` or `error` field.
- Scopes: `user.metrics` is sufficient for BP.
- State parameter is required (same as Whoop — generate 32 random bytes hex, set in httpOnly cookie, verify on callback).

### Measurement fetch

- Endpoint: `https://wbsapi.withings.net/measure` with `action=getmeas` as a form body param.
- Headers: `Authorization: Bearer <access_token>`.
- Body (form-encoded): `action=getmeas`, `meastypes=9,10,11` (diastolic, systolic, pulse), `category=1` (real measurements, not objectives), `startdate=<unix>`, `enddate=<unix>`.
- Response shape:
  ```json
  {
    "status": 0,
    "body": {
      "measuregrps": [
        {
          "grpid": 123456789,
          "date": 1718611200,
          "category": 1,
          "attrib": 0,
          "created": 1718611205,
          "modified": 1718611210,
          "comment": "",
          "deviceid": "abc...",
          "measures": [
            { "value": 1200, "type": 10, "unit": -1, "algo": 0, "fm": 0 },
            { "value": 800,  "type": 9,  "unit": -1, "algo": 0, "fm": 0 },
            { "value": 72,   "type": 11, "unit": 0,  "algo": 0, "fm": 0 }
          ]
        }
      ]
    }
  }
  ```
- **Unit handling:** each measure's actual value is `value × 10^unit`. Example above: systolic = 1200 × 10⁻¹ = 120 mmHg, diastolic = 800 × 10⁻¹ = 80 mmHg, pulse = 72 × 10⁰ = 72 bpm. Round to nearest integer for `smallint` columns.

### Rate limits

- Withings allows ~60 requests/min per app. The 12-hourly cron + occasional refill is well inside that. Notes #16 from CLAUDE.md (Whoop 429) still applies — stacking diagnose + refill + ingest rapidly can trip rate limits.

### Push notifications (out of scope for Slice 2)

Withings supports webhook notifications via `notify` API. We're polling every 12 h instead. If real-time becomes useful, that's Slice 2.5.

---

## Mapping: Withings measuregrp → `bp_readings` row

| `bp_readings` column | Source | Notes |
|---|---|---|
| `source_slug` | constant `'withings'` | |
| `source_record_id` | `bp_${grpid}` | grpid is Withings' stable per-measurement ID |
| `measured_at` | `new Date(date * 1000).toISOString()` | `date` is unix seconds |
| `systolic_mmhg` | `round(value × 10^unit)` for measure with `type === 10` | NOT NULL — skip the whole grp if missing |
| `diastolic_mmhg` | `round(value × 10^unit)` for measure with `type === 9` | NOT NULL — skip the whole grp if missing |
| `pulse_bpm` | `round(value × 10^unit)` for measure with `type === 11`, else `null` | Nullable |
| `position` | `null` | Withings API doesn't surface this; reserved for future manual entry |
| `extras` | `{ deviceid, category, attrib, raw_measures }` | Full original payload for forensics |
| `ingestion_log_id` | from `createIngestionLog` | |

**Skip a measuregrp entirely if either systolic or diastolic is missing.** Withings sometimes returns measuregrps with only pulse (from non-BP measurements that share the `measures` array structure) — those aren't BP and shouldn't land in `bp_readings`.

---

## Source row already exists

The `sources` table has `slug = 'withings'` from the migration_001 seed. No insert needed.

---

## New environment variables

| Variable | Value | Notes |
|---|---|---|
| `WITHINGS_CLIENT_ID` | From Withings developer portal | Public identifier |
| `WITHINGS_CLIENT_SECRET` | From Withings developer portal | Treat as password |

`CRON_SECRET` and `NEXT_PUBLIC_APP_URL` from Slice 1 are reused.

---

## Implementation steps

### Step 1 (MANUAL — Irfan): Add Withings env vars to `.env.local`

> Append `WITHINGS_CLIENT_ID=...` and `WITHINGS_CLIENT_SECRET=...` to `.env.local` (real values from the Withings developer portal).

### Step 2: Build `adapters/withings/`

Two files: `api.ts` (typed wrapper around the Withings API including OAuth refresh) and `index.ts` (the adapter implementing the `Adapter` contract).

### Step 3: Build OAuth handshake routes

`app/api/auth/withings/route.ts` — generates random state, sets cookie, redirects to Withings authorization page.
`app/api/auth/withings/callback/route.ts` — verifies state, exchanges code for tokens, saves to `oauth_tokens`, redirects to dashboard with `?withings_auth=success`.

### Step 4: Build the manual trigger route

`app/api/ingest/withings/route.ts` — POST, session-authenticated, invokes the Withings adapter with optional `fromDate`/`toDate`.

### Step 5: Build the cron route

`app/api/cron/withings/route.ts` — GET, `CRON_SECRET`-authenticated, invokes the Withings adapter for the default window.

### Step 6: Build the refill route

`app/api/refill/withings/route.ts` — POST, session-authenticated, ID-diff full historical load. Fetches all Withings measuregrps for `[fromDate, today]`, pulls every existing `source_record_id` from `bp_readings`, diffs, batch-upserts missing rows.

### Step 7: Update `vercel.json` with the Withings cron

Add a second crons entry for `/api/cron/withings` on schedule `0 */12 * * *`.

### Step 8: Update the Diagnose component

Extend `components/DiagnoseButton.tsx` to also fetch from `/api/diagnose/withings` and show both Whoop and Withings panels side-by-side. Or create a sibling `DiagnoseWithingsButton.tsx` and render both. Pick whichever is cleaner.

### Step 9: Build `/api/diagnose/withings`

Mirrors `/api/diagnose/whoop` — fetches Withings counts, compares to `bp_readings` count for the window.

### Step 10: Build + verify locally

`npm run build` must pass clean.

### Step 11 (MANUAL — Irfan): Add Withings env vars to Vercel

> Vercel → Project → Settings → Environment Variables. Add `WITHINGS_CLIENT_ID` and `WITHINGS_CLIENT_SECRET`. Scope to all environments.

### Step 12 (MANUAL — Irfan): Deploy

> Push or merge to `main`. Vercel auto-deploys.

### Step 13 (MANUAL — Irfan): OAuth handshake

> In a fresh browser tab, visit `https://irfan-health.vercel.app/api/auth/withings`. Approve. Land on dashboard with `?withings_auth=success`. Verify a row appears in `oauth_tokens` for `source_slug = 'withings'`.

### Step 14 (MANUAL — Irfan): First refill

> On the dashboard, click the Withings refill button (or POST to `/api/refill/withings`). Should return a non-zero `inserted` count if you have BP history. Click Diagnose Withings — gap should be 0.

### Step 15 (MANUAL — Irfan): Verify cron fires

> Wait for next `0 */12 * * *` UTC tick (00:00 or 12:00 UTC = 04:00 or 16:00 GST). Re-check `ingestion_log` for a `source_slug = 'withings'` row with `status = 'success'`.

---

## Verification checklist

- [ ] `adapters/withings/{api,index}.ts` exist and TypeScript builds clean
- [ ] OAuth handshake routes work — token row appears in `oauth_tokens`
- [ ] `/api/ingest/withings`, `/api/cron/withings`, `/api/refill/withings` exist
- [ ] `vercel.json` has both Whoop and Withings cron entries
- [ ] First refill returns non-zero `inserted` matching your real BP history count
- [ ] Diagnose Withings shows gap = 0
- [ ] Cron run lands `status = 'success'` within 12 h

---

## Out of scope

- Withings weight, sleep, activity (different devices, future slice if owned)
- Position field on BP rows (API doesn't surface; reserved for manual entry slice)
- Push notifications via Withings webhook (Slice 2.5 if useful)
- Dashboard visualisations (Slice 7)

---

*End of Slice 2 spec. Next: Slice 3 — Manual entry + quick-log UI.*
