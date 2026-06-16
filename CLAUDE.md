@AGENTS.md

# Irfan's Personal Health Data Platform — Working Notes

**Owner:** Irfan Ali Shah (single-user app). **Repo:** `irfanashah/irfan-health` (private). **Deploy:** Vercel, auto on `main`.

## Stack

- Next.js 16.2.9 (App Router, Turbopack) + TypeScript
- Tailwind CSS v4 (CSS-based config via `@theme` in `app/globals.css` — **no `tailwind.config.ts`**)
- shadcn/ui (preset `base-nova`, neutral base, CSS variables enabled)
- next-themes (dark default, `enableSystem={false}`, `attribute="class"`)
- Supabase (auth + Postgres). Project URL in `.env.local` — never committed.
- lucide-react for icons
- Dedicated Supabase project; database schema already exists (see `migration_001_initial_schema.sql`)

## Status

### Done
- **Slice 0 — Scaffold:** Next.js app, three Supabase clients (browser/server/service), middleware-based auth + route protection, login page, callback route, dashboard placeholder with sign-out server action, empty `adapters/` directory. Pushed to GitHub, deployed to Vercel, all 5 manual auth checks pass on both local and Vercel URL.
- **UI foundations:** shadcn init, `next-themes` wired (dark default), `components/ThemeToggle.tsx` (Sun/Moon), dashboard + login repainted with semantic tokens (`bg-background`, `bg-card`, `text-foreground`, etc.). Accent colours `accent-teal #00C896`, `accent-purple #9B59B6`, `accent-amber #F59E0B` registered in `@theme`.

### Pending on current slice (UI foundations)
- **Decide dashboard-specific design language at Slice 7** — layout, chart styles, data-viz palette. Foundations only are locked.
- Vercel Supabase URL config: add the live Vercel URL to **Supabase → Auth → URL Configuration → Site URL** + Redirect URLs (`/auth/callback`). Not blocking password login; required before any email-link / OAuth flows.

### Next concrete action
**Resume Slice 1 (Whoop adapter, end-to-end).** Scope was drafted in conversation and Irfan paused before any code was written. See "Paused — Slice 1 scope draft" below; the gate question is the first thing to settle on resume.

### Paused — Slice 1 scope draft (not yet written to `slice-1-*.md`)

**Goal:** prove the normalise-into-common-schema pattern end-to-end with Whoop — the cleanest source.

**In scope:**
- Apply `migration_001_initial_schema.sql` to Supabase (if not already applied) — see gate below.
- Whoop developer-app registration + one-time OAuth handshake (tokens land in Vercel env, never in DB).
- Shared adapter scaffolding under `adapters/_lib/`: TypeScript types from data-model spec §3 (`Adapter`, `AdapterConfig`, `IngestionResult`), the `normaliseUnit` utility with the §4 conversion table, and an `ingestion_log` helper.
- `adapters/whoop/` implementing the §3 contract: resolve window → log pending → refresh token if needed → fetch Whoop API → map ~8 daily metrics to `health_observations` rows → upsert with §5 dedup semantics → update log with final counts/status.
- `app/api/ingest/whoop/route.ts` — POST, shared-secret auth (`INGESTION_SECRET`), invokes adapter, returns `IngestionResult` JSON.
- `vercel.json` cron entry: every 6 hours.
- A single "Run now" button on the dashboard wired to the same route — for manual triggering during dev before cron is verified live.
- Backfill from a `BACKFILL_START_DATE` constant (decide on resume — likely 2026-04-28 STEMI day, or earlier).

**Out of scope** (later slices):
- Visualising the data (Slice 7).
- Any UI beyond the single trigger button.
- BP, CGM, labs, manual entry, Oxylink — own slices.
- Writing refreshed OAuth tokens back to Vercel env via the Vercel API. Slice 1 will refresh within a single invocation; persistent rotation can land as a small Slice 1.5 if manual rotation gets tedious. Decide on resume.

**Gate question (blocks the rest of Slice 1):** Has `migration_001_initial_schema.sql` been applied to the Supabase project? If no → spec begins with applying it. If unsure → I can introspect via service-role key. If yes → spec starts at the Whoop OAuth setup.

**Other open decisions to settle on resume:** backfill start date; Whoop OAuth app registration status (client_id/client_secret in hand?); token-rotation-back-to-Vercel automation in Slice 1 vs Slice 1.5.

## Decisions made

- **Dark mode default**, light toggle available, no system-preference following. Persists in localStorage per page load → `/login` correctly remembers user's last choice across sign-out.
- **No `tailwind.config.ts`.** Tailwind v4 reads config from CSS (`app/globals.css`). Spec was written assuming v3; translated to v4 equivalents.
- **shadcn base preset = `base-nova` (neutral)**, not Zinc as the original spec called for. Zinc has a faint cool tint; Neutral is pure gray. Visually near-identical; not worth hand-editing 30+ oklch variables. Swap later if it matters.
- **Single-user auth.** Email signup is **disabled** in Supabase (Auth → Providers → Email → "Allow new users to sign up" OFF). Only Irfan's account exists.
- **`adapters/` directory created up-front** so the import path is stable from Slice 1 onward.
- **Vercel deployment is connected to `main`.** Every push to main triggers a production deploy. No preview-branch strategy yet — fine for single-user.

## Gotchas

1. **Hardcoded Tailwind colours kill dark mode silently.** A `bg-gray-50` on a full-viewport wrapper covers the dark `body` and makes the toggle look broken even though `<html class="dark">` is being set correctly. Always use semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `border-input`, `ring-ring`, `bg-primary`, `text-primary-foreground`, `text-destructive`) on any new page.
2. **Next.js 16 deprecated `middleware.ts` → `proxy.ts`.** Build emits a warning; still works. Rename in a future small slice — don't bundle with feature work.
3. **`create-next-app` won't initialise into a directory containing arbitrary files** (only its own whitelist). Slice 0 worked around this by scaffolding in `/tmp` and copying in — preserves any pre-existing `.md` / `.sql` artefacts.
4. **`.gitignore` from `create-next-app` blocks `.env.local.example`** via the broad `.env*` rule. Added `!.env.local.example` exception so the reference file commits while real secrets stay ignored.
5. **next-themes requires `suppressHydrationWarning` on `<html>`** — otherwise the console fills with hydration mismatches on every page load.
6. **`.env.local` placeholder values fail at runtime, not at build.** A successful `npm run build` does not mean the Supabase config is valid. Always smoke-test a live auth flow when env vars change.
7. **The `@AGENTS.md` import at the top of this file is required.** It pulls in the "this is Next.js 16, not your training data" notice — keep it.

## Reference

- Specs and handover docs live at repo root: `slice-0-scaffold-spec.md`, `health-platform-data-model-spec_v1_2026-06-16.md`, `health-platform-handover_v1_2026-06-16.md`, `migration_001_initial_schema.sql`.
- Irfan's working preferences (challenge level, communication style, file safety) are in his global `~/.claude/CLAUDE.md` — they apply here, do not duplicate.
