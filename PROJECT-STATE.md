# Project State — Irfan's Health Platform

_Last updated: 2026-06-19 (session: Slice 5 — Nightscout CGM adapter built end-to-end)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Slices 0–3 deployed and verified; Slice 5 (Nightscout CGM adapter) built locally end-to-end with `npm run build` clean. No deploy yet — env vars (`NIGHTSCOUT_URL` + `NIGHTSCOUT_TOKEN`) and the post-deploy refill are Irfan's call.

## Slice ledger
- ✅ Slice 0 — Scaffold (Next.js, auth, UI foundations, Vercel Pro auto-deploy)
- ✅ Slice 1 — Whoop adapter end-to-end (OAuth, 6-hourly cron, ingest/diagnose)
- ✅ Slice 1.5 — Incremental backfill (chunked sweep — superseded by refill)
- ✅ Slice 1.6 — Refill (ID-diff full-history load)
- ✅ Slice 2 — Withings BP adapter end-to-end (OAuth, 12-hourly cron, ID-diff refill → `bp_readings`)
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`: Weight · Glucose · Symptom · BP + always-visible Note; recent list with edit/delete; manual-only guard)
- ⏸ Slice 4 — Oxylink SpO2 (PARKED 2026-06-17 — ingestion path needs deeper work; see `slice-4-oxylink-ingestion-options_2026-06-17.md`)
- ✅ Slice 5 — Nightscout agnostic CGM adapter (token auth, 12-hourly cron pulling 48 h, ID-diff refill in 30-day chunks → `glucose_cgm`, diagnose with last-30-days default)
- ⊘ Slice 5a (Dexcom Clarity CSV import) — DEFERRED 2026-06-18; Clarity history loaded into Nightscout via the throwaway loader. Spec kept as reference (`slice-5a-dexcom-clarity-import-spec.md`).
- → Slice 6 (Labs PDF) or Slice 7 (Trend dashboard) — NEXT, Irfan to pick. Both unblocked; both need fresh specs.
- ⬜ Slice 8 Discipline layer · Final wearable swap (Nov 2026)

## Data state
- **Whoop:** `health_observations` complete — Diagnose gap = 0; 6-hourly cron running clean.
- **Withings:** `bp_readings` complete — Diagnose gap = 0; 12-hourly cron running clean.
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout:** ~2,995 readings sitting in Nightscout (Clarity backfill, `device='clarity-import'`); adapter not yet exercised against the DB — first refill is pending deploy + env vars.
- **Pending verification:** post-deploy Slice 5 smoke — set Vercel env vars, run refill once, confirm `~2,995 glucose_cgm` rows for `source_slug='nightscout'`, then Diagnose gap = 0 over the last 30 days.

## Next action
Push Slice 5 to `main` after setting `NIGHTSCOUT_URL` + `NIGHTSCOUT_TOKEN` on Vercel (reuse `CRON_SECRET`). Then run `/api/refill/nightscout` once from the browser dev console (or re-import a refill button) to load the ~2,995 readings. Diagnose should show gap = 0 for the last 30 days. Once green, **Irfan decides Slice 6 (Labs PDF import) vs Slice 7 (Trend dashboard)** — both unblocked; both need fresh specs.

## Open items (non-blocking)
- **Slice 4 ingestion-path investigation** (parked) — run the two Fold device checks, decide CSV vs Health Connect bridge vs Google Health API. Full analysis in `slice-4-oxylink-ingestion-options_2026-06-17.md`.
- **Slice 5 post-deploy verification** — env vars on Vercel, run refill once, Diagnose gap = 0.
- No cron failure alerting — "last successful run > 24h → notify" worth a small slice before clinical reliance (now covers Whoop + Withings + Nightscout).
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless; a `chk_status` cleanup utility someday.
