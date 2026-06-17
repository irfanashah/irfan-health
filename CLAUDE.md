@AGENTS.md

# Irfan's Personal Health Data Platform — Working Notes

**Owner:** Irfan Ali Shah (single-user app). **Repo:** `irfanashah/irfan-health` (private). **Deploy:** Vercel **Pro**, auto on `main`.

## Stack

- Next.js 16.2.9 (App Router, Turbopack) + TypeScript
- Tailwind CSS v4 (CSS-based config via `@theme` in `app/globals.css` — **no `tailwind.config.ts`**)
- shadcn/ui (preset `base-nova`, neutral base, CSS variables enabled)
- next-themes (dark default, `enableSystem={false}`, `attribute="class"`)
- Supabase (auth + Postgres). Dedicated project; URL/keys in `.env.local` — never committed.
- lucide-react for icons
- Schema: `migration_001_initial_schema.sql` (6 tables) + `migration_002_oauth_tokens.sql` (OAuth token store) — both applied.

## Status

### Done
- **Slice 0 — Scaffold:** Next.js app, three Supabase clients (browser/server/service), middleware-based auth + route protection, login page, callback route, dashboard placeholder with sign-out server action, empty `adapters/` directory. All 5 manual auth checks pass on local + Vercel.
- **UI foundations:** shadcn init, `next-themes` wired (dark default), `components/ThemeToggle.tsx` (Sun/Moon), dashboard + login painted with semantic tokens. Accent colours `accent-teal #00C896`, `accent-purple #9B59B6`, `accent-amber #F59E0B` in `@theme`.
- **Slice 1 — Whoop adapter, end-to-end:** `adapters/_lib/` (types, normalise, ingestion-log, token-store), `adapters/whoop/` (typed v2 API client + main adapter implementing §3 contract), `/api/auth/whoop` + `/callback` (OAuth handshake with CSRF state cookie), `/api/ingest/whoop` (session-auth manual trigger), `/api/cron/whoop` (CRON_SECRET-auth bearer), `vercel.json` cron `0 */6 * * *`, `components/RunNowButton.tsx`. Deployed; OAuth tokens in `oauth_tokens`; first ingestion verified — `recordsFound`/`written`/`skipped` reported correctly and dedup confirmed across runs.
- **Slice 1.5 — Incremental backfill:** `/api/backfill/whoop` (frontier-based chunked load, modes `auto`/`sweep`, 30-day chunks, 240 s wall-clock budget per click, maxDuration 800 s) + `components/BackfillButton.tsx` (cursor persisted in `localStorage` so refreshes don't restart from "now"). Useful for incremental gap-filling, but **superseded by the refill route for full historical loads** (see next).
- **Slice 1.6 — Refill (ID-diff load):** `/api/refill/whoop` + `components/RefillButton.tsx`. Single-invocation: fetches every Whoop cycle/recovery/sleep for `[2025-01-01, today]` in parallel, pulls every existing `source_record_id` from `health_observations` (paginated to bust Supabase JS's 1000-row cap), diffs in memory, batch-upserts only the missing rows 200 at a time. Plus `/api/diagnose/whoop` + `components/DiagnoseButton.tsx` to show side-by-side Whoop-vs-DB counts per metric. **Final state**: 5,637 rows in `health_observations` for `source_slug = 'whoop'`, exactly matching Whoop's `5,642 expected − 5 in-progress cycle skips`. Sleep metrics fully ingested (469 each). Recovery metrics at 468/469 (the missing 1 is the current in-progress cycle). Strain at 482/483 (same in-progress cycle). Next 6-hourly cron run will close those 5 once Whoop scores the cycle.
- **Slice 2 — Withings BP adapter, end-to-end:** `adapters/withings/{api,index}.ts` (typed Withings v2 OAuth + `getmeas` paginated client, adapter mapping measurement groups to `bp_readings`). `app/api/auth/withings/{route,callback/route}.ts` (state-cookie CSRF, code exchange to `oauth_tokens(source_slug='withings')`). `/api/ingest/withings` (session auth), `/api/cron/withings` (`CRON_SECRET` bearer, schedule `0 */12 * * *`), `/api/refill/withings` (ID-diff full-history, shares `buildBpRow` with the adapter so the filter logic is canonical — gotcha #25). `/api/diagnose/withings` mirrors the Whoop diagnose route. `components/DiagnoseButton.tsx` extended to render both Whoop + Withings panels from a single click via `Promise.allSettled`. `vercel.json` has both crons. **No new migration** — `bp_readings` already in `migration_001_initial_schema.sql`. **Final state:** Vercel env vars set; deployed; OAuth handshake done (token row in `oauth_tokens` for `source_slug = 'withings'`); first refill via dev-console fetch inserted 17 / 17 BP readings in 2.4 s with zero filter or insert errors; Diagnose confirms gap = 0. Only **scheduled-cron verification** still pending (first 00:00 / 12:00 UTC tick after deploy).

### Pending
- ~~**Vercel Supabase URL config**~~ — ✅ DONE 2026-06-17. Site URL = `https://irfan-health.vercel.app`; Redirect URLs allow-list = `https://irfan-health.vercel.app/**` + `http://localhost:3000/**` (wildcards cover `/auth/callback` and any `next=` target). Set on project `dvaouajfwmzitlpbofsi`. Email-link / Supabase-OAuth flows now unblocked for when they're added.
- **Dashboard design language (Slice 7):** layout, chart styles, data-viz palette deliberately deferred — foundations only are locked.
- **Orphan `ingestion_log` rows from timed-out runs** — harmless (next-window resolution only reads `status = 'success'`), but worth a `chk_status` cleanup utility someday.
- **Cron monitoring / alerting** — both Whoop (every 6 h) and Withings (every 12 h) crons write to `ingestion_log` but there's no notification if they start failing silently (API change, refresh token revoked, Supabase quota, etc.). Worth a small "last successful run > 24 h ago → notify" job before this is relied on for clinical decisions.
- **Slice 2 cron verification:** all of Steps 11–14 of `slice-2-withings-bp-spec.md` are done (env vars on Vercel, deployed, handshake complete, refill landed 17/17, Diagnose gap = 0). Only Step 15 remains — wait for the first 00:00 / 12:00 UTC cron tick and confirm a `source_slug = 'withings'` row appears in `ingestion_log` with `status = 'success'`.
- **Slice-1 5-row residual gap** (in-progress cycle `1572138504`) — closes on the first cron run after Whoop scores it (typically 04:00 GST). If Diagnose still shows it after 24 h, something is wrong with the cron or with Whoop's scoring of that specific cycle.

### Next concrete action
**Start Slice 3 (Manual entry + quick-log UI).** Per the handover roadmap (§7): weight (Xiaomi/Zepp scale — manual), fingerstick glucose, symptoms/notes. New territory — first slice with no OAuth/API adapter, primarily a UI/UX problem. Writes go through `manual` source slug (already seeded) into `health_observations` (`discrete` data shape) and possibly `bp_readings` for manual BP cuff readings not captured by Withings. Draft spec from handover + data-model, confirm scope, then execute.

## Decisions made

- **Dark mode default**, light toggle available, no system-preference following. Persists in localStorage per page load.
- **No `tailwind.config.ts`.** Tailwind v4 reads config from CSS (`app/globals.css`). Spec assumed v3; translated to v4 equivalents.
- **shadcn base preset = `base-nova` (neutral)**, not Zinc as the original spec asked. Visually near-identical; not worth hand-editing 30+ oklch variables.
- **Single-user auth.** Supabase email signup disabled. Only Irfan's account exists.
- **Vercel deploys from `main`.** Every push triggers production. No preview-branch strategy.
- **Vercel Pro plan** (upgraded mid-Slice-1). Required because Hobby caps cron at 2 invocations/day and our `0 */6 * * *` schedule runs 4×/day. Pro also gives function `maxDuration` up to 800 s — the refill/backfill/diagnose routes set `export const maxDuration = 800` to use the full ceiling.
- **OAuth tokens live in Supabase `oauth_tokens` table**, NOT Vercel env vars. Deliberate deviation from data-model spec §6 — documented at top of `slice-1-whoop-adapter-spec.md`. Service-role client reads/writes the table; tokens never reach the browser.
- **Whoop history starts at 2025-02-06** (first day Irfan wore Whoop). The cron-run `BACKFILL_START_DATE` in `adapters/whoop/index.ts` is set to `2026-04-15` (just before the 2026-04-28 STEMI) for routine catch-up runs. Full historical loads use `/api/refill/whoop` (ID-diff approach), which is faster and more reliable than the chunked sweep.
- **`adapters/whoop/api.ts` targets Whoop Developer API v2.** v1 endpoints return 404s — Whoop deprecated them.
- **Dashboard is intentionally minimal post-Slice-1.** Only `DiagnoseButton` is rendered (now showing both Whoop and Withings panels in one click). The Slice-1-era `RunNow`, `Refill`, and `Backfill` buttons + components remain in `components/` and their routes are live; just unrendered. Routine sync runs on cron; reconciliation is a manual job that re-imports the relevant button when needed.
- **Slice 2 default refill `targetStart` is `2025-01-01`**, same as Whoop. The Withings adapter `BACKFILL_START_DATE` matches. POSTing `/api/refill/withings` with `{ fromDate: '…' }` overrides per-call.
- **Withings `attrib` filter:** the adapter and refill both accept `0` (device-recorded), `1` (manual entry via app), `2` (manual override) only. They skip `4` (user objective), `5` (flagged wrong), `7` (creation stub), and any unrecognised value. The `ACCEPTED_ATTRIB` set lives in `adapters/withings/index.ts` and is mirrored inline (with a comment) in `app/api/diagnose/withings/route.ts` — change all three together if loosening.
- **Withings `buildBpRow` is the single source of truth for "what's a valid BP row"**, exported from `adapters/withings/index.ts` and imported by both the cron adapter (via the `withingsAdapter.fetchAndIngest` loop) and `/api/refill/withings`. Avoids drift (gotcha #25).

## Gotchas

### Build / project setup
1. **Hardcoded Tailwind colours kill dark mode silently.** `bg-gray-50` on a full-viewport wrapper covers the dark `body` even though `<html class="dark">` is being set correctly. Always use semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `border-input`, `ring-ring`, `bg-primary`, `text-primary-foreground`, `text-destructive`, `text-accent-teal/purple/amber`) on any new page.
2. **Next.js 16 deprecated `middleware.ts` → `proxy.ts`.** Warning only; still works. Rename in a future small slice.
3. **`create-next-app` refuses to scaffold into a directory containing arbitrary files.** Slice 0 worked around this by scaffolding in `/tmp` and copying in.
4. **`.gitignore` from `create-next-app` blocks `.env.local.example`** via the broad `.env*` rule. Added `!.env.local.example` exception.
5. **next-themes requires `suppressHydrationWarning` on `<html>`.**
6. **The `@AGENTS.md` import at the top of this file is load-bearing** — it pulls in the "this is Next.js 16, not your training data" notice. Keep it.

### Supabase
7. **`createClient` (server) is async** (`cookies()` is async in Next 16) — must be `await`ed. **`createServiceClient` (service) is sync.** Slice 1 spec mixed these up; fixed inline.
8. **Postgres `numeric` round-trips as either number or string** through PostgREST. The dedup pre-check in `upsertObservation` coerces both sides via `Number()` before `===` — without that, the "skipped" counter never increments even though dedup at DB level still works.
9. **Middleware must not redirect `/api/*` routes.** Spec's Slice 0 middleware redirected every non-`/login` route to login if unauthenticated; that swallowed Whoop's OAuth callback (the `code` param was lost on the redirect to `/login`). API routes self-enforce auth — session for `/api/ingest/whoop`, `CRON_SECRET` for `/api/cron/whoop`, public for OAuth callbacks.
10. **Supabase JS `.select()` silently caps at 1000 rows by default.** Bit us twice — first in the diagnose route (per-metric counts were truncated), then in the refill route's "fetch all existing IDs" step. Fix: either use `.select('*', { count: 'exact', head: true })` for count-only, or paginate with `.range(offset, offset + 999)` for actual rows.
11. **Batch upserts are all-or-nothing per statement.** One row with a check-constraint violation (e.g. null `period_end` from an in-progress Whoop cycle) fails the entire 200-row batch. Filter invalid rows before the batch call, don't rely on the DB to skip them.
12. **Frontend cursor state must be persisted in `localStorage`** for multi-click backfill UIs — React `useState` resets on page refresh, which silently restarts the cursor from "now" and re-walks the dense recent window. Cost us hours debugging the sweep before figuring this out.

### Source APIs — Whoop
13. **Whoop's developer API is v2 only** at `https://api.prod.whoop.com/developer/v2`. The v1 paths in the original spec returned 404.
14. **Sleep is at `/activity/sleep`, not `/sleep`.** Spec was wrong; cycle and recovery are at `/cycle` and `/recovery` (no `/activity/` prefix).
15. **Whoop requires the OAuth `state` parameter** on the authorization request, not just optional. We generate 32 random bytes hex, store in an httpOnly cookie (`sameSite: 'lax'`, 10 min TTL), and verify on callback. Without it Whoop returns `{"error":"invalid_state"}` immediately, before even rendering its approval page.
16. **OAuth handshake must happen on the live Vercel URL**, not localhost — Whoop's app registration only allows HTTPS redirect URIs. Local dev reads tokens from Supabase so this is fine post-handshake.
17. **In-progress cycles and sleeps have `null` start/end.** The current day's cycle (and sometimes the most recent sleep) won't have an `end` until Whoop finalises overnight. Inserting them violates the `chk_obs_time_coverage` constraint on `health_observations`. The refill route filters these out into `buildErrors`; the next cron run picks them up once Whoop scores them.
18. **Recoveries inside a fetch window can link to cycles just before it.** A recovery scored on 2025-01-01 morning links to a cycle that started on 2024-12-31 evening. If you only fetch cycles for `[fromDate, toDate]`, those recoveries silently drop because their `cycle_id` isn't in your `cycleMap`. Fix: widen the cycle fetch backwards by 14 days, but only emit `strain_score` rows for cycles whose `start >= fromDate` so you don't pollute pre-window data.
19. **Whoop rate-limits aggressively.** Stacking diagnose + refill + ingest in quick succession trips 429 on `/cycle`. Wait ~2 minutes and retry, or — better — verify in Supabase with a SQL `COUNT(*) GROUP BY metric_type` instead of re-hitting Whoop.

### Source APIs — Withings
- **Withings uses form-encoded POST for everything** — both the token endpoint (`/v2/oauth2`) and the measure endpoint (`/measure`) accept `application/x-www-form-urlencoded` POST bodies, including an `action` form field (`requesttoken`, `getmeas`). Don't send JSON.
- **Withings responses are wrapped**: `{ status: number, body: {...}, error?: string }`. `status === 0` means success; anything else is an API-level error even on HTTP 200. Always unwrap and check `status` before reading `body`. Surface `error` text on non-zero status.
- **Withings tokens rotate on every refresh.** New `refresh_token` returned in each `requesttoken` response. Persist the rotated pair to `oauth_tokens` immediately (handled in `refreshAccessToken`). Lose the new refresh token and you have to re-handshake from scratch.
- **Withings `getmeas` paginates via `{ more, offset }`.** Stop when `more !== 1`. Defensive: also stop if `more === 1` but `offset` didn't advance — prevents infinite loop on a misbehaving response.
- **Withings unit field is a base-10 exponent**, not a unit string. Real value = `value × 10^unit`. Example: `{ value: 1200, unit: -1 }` → 120 mmHg. Don't forget to `Math.round()` before storing in `smallint` columns.
- **Withings `attrib` codes encode measurement provenance**, not just metadata. `0` = device, `1` = manual app, `2` = manual override are real; `4` = objective (a target, NOT an actual reading), `5` = flagged wrong, `7` = creation stub. Filter against an explicit allow-list, don't reject only the obvious bad codes.
- **Measurement groups can contain non-BP measurements.** A pulse reading without systolic+diastolic isn't a BP reading and must not land in `bp_readings`. Filter on presence of both `type === 9` and `type === 10` before building a row.

### Vercel
20. **Vercel function timeouts:** Hobby caps at 60 s regardless of `maxDuration`. Pro defaults to ~180 s; `maxDuration = 800` is the Pro ceiling. When the function exceeds its budget, Vercel returns a plain-text "An error occurred…" page — the frontend's `JSON.parse` chokes on it with `"Unexpected token 'A'…"`. That error means "function timed out", not "adapter bug".
21. **Vercel cron limits:** Hobby allows 2 invocations/day total. `0 */6 * * *` = 4/day blocks the entire deploy (not just disables the cron). Required Pro upgrade.
22. **GitHub-App webhook can go stale after a Vercel plan upgrade.** Pushes silently stop triggering deploys despite the Git settings page still showing "Connected". Fix: Settings → Git → Disconnect → reconnect. Confirmed in Slice 1.

### Operational
23. **Session-authenticated routes can't be hit by `curl` from the terminal.** `/api/ingest/*` and `/api/refill/*` check `supabaseUser.auth.getUser()` against the Supabase session cookie. Without the cookie, you get `{"error":"Unauthorised"}` and 401 — even when logged into the dashboard in another tab, because the cookie lives in the browser, not the shell. Quickest one-off: while logged in, paste a `fetch('/api/refill/...', {...})` snippet into the browser dev console — runs in your authenticated tab, cookie tags along automatically. Alternatively re-import a button into `app/page.tsx` and click it.

### Loading patterns
24. **Prefer ID-diff refill over chunked sweep for any "full historical load" task.** The chunked sweep approach (walk windows in N-day chunks, dedup per row via SELECT-then-upsert) is slow (~50 ms × N rows per chunk for the dedup SELECT) and error-prone (cursor management, partial timeouts, every chunk creates an `ingestion_log` row). The ID-diff pattern — fetch the full list of IDs from the source, pull existing IDs from the DB (paginated), diff in memory, batch-upsert only the missing ones — completed the entire 17-month Whoop history in ~13 s after we landed on it. Use the sweep only when memory diff is impractical (millions of records) or when the source doesn't expose stable IDs.
25. **When you fix a row-validity filter in the refill route, back-port it to the main adapter too.** The refill route (`/api/refill/whoop`) was hardened with null-`period_start`/`period_end` filters for in-progress cycles/sleeps. The main adapter (`adapters/whoop/index.ts`) — which the cron uses — was missed initially. Every cron run silently landed as `status = 'partial'` for ~5 errors against the in-progress cycle until we noticed and ported the same filter across. The two paths share the same `health_observations` constraints; whatever the refill skips, the adapter must skip. Same rule will apply per-source going forward: `adapters/<source>/index.ts` (incremental cron) and `/api/refill/<source>/route.ts` (full-history reconciliation) must agree on what gets filtered.

## Reference

- Specs and handover docs at repo root: `slice-0-scaffold-spec.md`, `slice-1-whoop-adapter-spec.md`, `slice-2-withings-bp-spec.md`, `health-platform-data-model-spec_v1_2026-06-16.md`, `health-platform-handover_v1_2026-06-16.md`, `migration_001_initial_schema.sql`, `migration_002_oauth_tokens.sql`.
- Dashboard surface: `ThemeToggle` (header), `DiagnoseButton` (only ingestion UI — proves Whoop vs DB row counts match). The other Slice-1 buttons (`RunNowButton`, `RefillButton`, `BackfillButton`) and their components are still in `components/` and wired to live API routes (`/api/ingest`, `/api/refill`, `/api/backfill`) — just no longer rendered. Cron handles routine sync; re-expose any of these by importing + rendering in `app/page.tsx` if needed for a one-off.
- Slice 2+ specs aren't written yet — generate from the handover roadmap (§7) + data-model spec when starting.
- Irfan's working preferences (challenge level, communication style, file safety) are in his global `~/.claude/CLAUDE.md` — they apply here, do not duplicate.
