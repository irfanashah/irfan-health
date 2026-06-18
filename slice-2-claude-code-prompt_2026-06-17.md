# Claude Code Kickoff Prompt — Slice 2 (Withings BP Adapter)

> Paste everything below the line into Claude Code, run from the `irfan-health` repo root.

---

You are implementing **Slice 2 — Withings BP adapter** for my personal health platform.

**Before writing any code, read these three files in full and treat them as authoritative:**
1. `CLAUDE.md` (repo root) — the live build record. The "Decisions made", "Gotchas" (all 24), and the per-slice status are binding. Do not re-litigate decisions or repeat known mistakes.
2. `slice-2-withings-bp-spec.md` — the full spec for this slice. This is your build instruction set.
3. The existing Whoop implementation as the reference pattern — `adapters/whoop/api.ts`, `adapters/whoop/index.ts`, `app/api/auth/whoop/route.ts`, `app/api/auth/whoop/callback/route.ts`, `app/api/ingest/whoop/route.ts`, `app/api/cron/whoop/route.ts`, `app/api/refill/whoop/route.ts`, `app/api/diagnose/whoop/route.ts`, and `components/DiagnoseButton.tsx`. Also skim `adapters/_lib/{types,normalise,ingestion-log,token-store}.ts`.

Also reference `health-platform-data-model-spec_v1_2026-06-16.md` for the `bp_readings` table shape.

## Scope

Build the Withings BP adapter end-to-end, mirroring the Whoop slice's architecture. Destination table is `bp_readings` (already exists in `migration_001_initial_schema.sql` — **no new migration**). The `sources` row `slug = 'withings'` already exists — **no insert**.

**Build these (the code steps — Steps 2–10 of the spec):**
- `adapters/withings/api.ts` — typed Withings API client incl. OAuth token exchange + refresh.
- `adapters/withings/index.ts` — the adapter implementing the same `Adapter` contract Whoop uses.
- `app/api/auth/withings/route.ts` + `app/api/auth/withings/callback/route.ts` — OAuth handshake.
- `app/api/ingest/withings/route.ts` — session-auth manual trigger.
- `app/api/cron/withings/route.ts` — `CRON_SECRET`-auth, schedule `0 */12 * * *`.
- `app/api/refill/withings/route.ts` — ID-diff full-history load.
- `app/api/diagnose/withings/route.ts` — Withings-vs-DB count comparison.
- Wire a Withings panel into `components/DiagnoseButton.tsx` (or a sibling component — your call, whichever is cleaner).
- Add the second cron entry to `vercel.json`.

## Hard constraints — do not deviate

- **Do NOT modify `adapters/_lib/*`, the Whoop adapter, or the Whoop routes.** Reuse `_lib` as-is.
- **Build the ID-diff refill route, not a chunked sweep** (gotcha #23). Pull all Withings `grpid`s for the window, pull all existing `source_record_id`s from `bp_readings` (paginate past Supabase's 1000-row `.select()` cap — gotcha #10), diff in memory, batch-upsert only missing rows (200 at a time, all-or-nothing per batch so filter invalid rows first — gotcha #11).
- **Apply the null/invalid-field filter in BOTH `adapters/withings/index.ts` AND `app/api/refill/withings/route.ts` from the start** (gotcha #24). The two paths must agree on what gets skipped.
- **Skip any measuregrp missing systolic OR diastolic** — only-pulse groups are not BP and must not land in `bp_readings` (spec mapping section).
- **Unit math:** each measure's real value is `value × 10^unit`; round to integer for the `smallint` columns. Verify with the spec's worked example (1200,−1 → 120 mmHg).
- **`source_record_id` = `bp_${grpid}`.** Dedup rides on this.
- **Withings token response is wrapped:** `{ status, body: { access_token, refresh_token, ... } }`. `status !== 0` = error — surface `body.error`. **Persist the rotating refresh token after every use** to `oauth_tokens` (keyed on `source_slug = 'withings'`), same as Whoop.
- **State param is required** — mirror the Whoop CSRF pattern exactly (32 random bytes hex, httpOnly cookie `sameSite: 'lax'`, 10-min TTL, verify on callback).
- **`redirect_uri` is built from `NEXT_PUBLIC_APP_URL`** (same as the Whoop route): `${NEXT_PUBLIC_APP_URL}/api/auth/withings/callback`. It must exactly match the URI registered in the Withings developer portal. The OAuth handshake only works on the live Vercel URL, not localhost (gotcha #16).
- **PostgREST returns `numeric` as string** — coerce with `Number()` before any comparison (gotcha #8).
- **Service-role client is sync; server client is async (`await`)** (gotcha #7).
- **Routes that do bulk work set `export const maxDuration = 800`** and `export const runtime = 'nodejs'` where the Whoop equivalents do.
- **UI: semantic Tailwind tokens only**, never hardcoded colours (gotcha #1).

## What I (Irfan) handle, not you — flag these, don't attempt

- Registering the Withings developer app + obtaining `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET` (Steps 1 & 11).
- Adding those env vars to `.env.local` and to Vercel.
- Deploy, OAuth handshake, first refill, and cron verification (Steps 12–15).

You can and should build all the code before those creds exist; just don't expect the handshake to run locally.

## Process

1. First, give me a **brief build plan** — file list, the order you'll build in, and any decision points you see in the spec that need my call. **Wait for my go-ahead before writing code.**
2. Build in logical commits (adapter → OAuth routes → ingest/cron → refill → diagnose → UI → vercel.json), not one giant diff.
3. `npm run build` must pass clean before you call it done.
4. When done, **update `CLAUDE.md`**: add a "Slice 2 — Withings BP" entry under Done, record any new decisions, append any new gotchas you hit, and update the "Next concrete action" to Slice 3. Keep the same style as the existing entries.

Do not push or merge — I drive deploys.
