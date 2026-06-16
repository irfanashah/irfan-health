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
- **Slice 1.5 — Incremental backfill:** `/api/backfill/whoop` (frontier-based chunked load, 60-day chunks, 180 s wall-clock budget per click) + `components/BackfillButton.tsx`. Walks backwards from oldest existing `period_start` to `2025-01-01` across multiple clicks. Verified end of useful history at 2025-02-06 (when Irfan started wearing Whoop). 1105 rows in `health_observations` covering 2025-02-06 → 2026-06-15, zero null periods.

### Pending
- **Vercel Supabase URL config:** add the live Vercel URL to **Supabase → Auth → URL Configuration → Site URL** + Redirect URLs (`/auth/callback`). Not blocking password login; required before any email-link / OAuth-via-Supabase flows.
- **Dashboard design language (Slice 7):** layout, chart styles, data-viz palette deliberately deferred — foundations only are locked.
- **Orphan `ingestion_log` rows from timed-out runs** — harmless (next-window resolution only reads `status = 'success'`), but worth a `chk_status` cleanup utility someday.

### Next concrete action
**Start Slice 2 (Withings BP).** Per the handover roadmap (§7) and data-model spec (`bp_readings` table). Same shape as Slice 1: OAuth handshake + adapter + ingest/cron routes + manual-trigger button. Reuse `adapters/_lib/` as-is. Confirm scope, plan, then execute.

## Decisions made

- **Dark mode default**, light toggle available, no system-preference following. Persists in localStorage per page load.
- **No `tailwind.config.ts`.** Tailwind v4 reads config from CSS (`app/globals.css`). Spec assumed v3; translated to v4 equivalents.
- **shadcn base preset = `base-nova` (neutral)**, not Zinc as the original spec asked. Visually near-identical; not worth hand-editing 30+ oklch variables.
- **Single-user auth.** Supabase email signup disabled. Only Irfan's account exists.
- **Vercel deploys from `main`.** Every push triggers production. No preview-branch strategy.
- **Vercel Pro plan** (upgraded mid-Slice-1). Required because Hobby caps cron at 2 invocations/day and our `0 */6 * * *` schedule runs 4×/day. Pro also gives function `maxDuration` up to 300 s.
- **OAuth tokens live in Supabase `oauth_tokens` table**, NOT Vercel env vars. Deliberate deviation from data-model spec §6 — documented at top of `slice-1-whoop-adapter-spec.md`. Service-role client reads/writes the table; tokens never reach the browser.
- **Whoop backfill starts at `2026-04-15`** (just before the 2026-04-28 STEMI). Older history (back to 2025-01-01) is loaded incrementally via the BackfillButton.
- **`adapters/whoop/api.ts` targets Whoop Developer API v2.** v1 endpoints return 404s — Whoop deprecated them.

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

### Whoop API
10. **Whoop's developer API is v2 only** at `https://api.prod.whoop.com/developer/v2`. The v1 paths in the original spec returned 404.
11. **Sleep is at `/activity/sleep`, not `/sleep`.** Spec was wrong; cycle and recovery are at `/cycle` and `/recovery` (no `/activity/` prefix).
12. **Whoop requires the OAuth `state` parameter** on the authorization request, not just optional. We generate 32 random bytes hex, store in an httpOnly cookie (`sameSite: 'lax'`, 10 min TTL), and verify on callback. Without it Whoop returns `{"error":"invalid_state"}` immediately, before even rendering its approval page.
13. **OAuth handshake must happen on the live Vercel URL**, not localhost — Whoop's app registration only allows HTTPS redirect URIs. Local dev reads tokens from Supabase so this is fine post-handshake.

### Vercel
14. **Vercel function timeouts:** Hobby caps at 60 s regardless of `maxDuration`. Pro defaults to ~180 s; `maxDuration = 300` lifts the cap to 300 s. When the function exceeds its budget, Vercel returns a plain-text "An error occurred…" page — the frontend's `JSON.parse` chokes on it with `"Unexpected token 'A'…"`. That error means "function timed out", not "adapter bug".
15. **Vercel cron limits:** Hobby allows 2 invocations/day total. `0 */6 * * *` = 4/day blocks the entire deploy (not just disables the cron). Required Pro upgrade.
16. **GitHub-App webhook can go stale after a Vercel plan upgrade.** Pushes silently stop triggering deploys despite the Git settings page still showing "Connected". Fix: Settings → Git → Disconnect → reconnect. Confirmed in Slice 1.

## Reference

- Specs and handover docs at repo root: `slice-0-scaffold-spec.md`, `slice-1-whoop-adapter-spec.md`, `health-platform-data-model-spec_v1_2026-06-16.md`, `health-platform-handover_v1_2026-06-16.md`, `migration_001_initial_schema.sql`, `migration_002_oauth_tokens.sql`.
- Slice 2+ specs aren't written yet — generate from the handover roadmap (§7) + data-model spec when starting.
- Irfan's working preferences (challenge level, communication style, file safety) are in his global `~/.claude/CLAUDE.md` — they apply here, do not duplicate.
