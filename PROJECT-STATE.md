# Project State — Irfan's Health Platform

_Last updated: 2026-06-17 (session: Slice 3 — manual entry + quick-log UI built end-to-end)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Slices 0–3 built. Whoop + Withings cron pipelines reconciled; `/log` manual-entry UI shipped locally (`npm run build` clean). No deploy yet — Slice 3 push to main is Irfan's call.

## Slice ledger
- ✅ Slice 0 — Scaffold (Next.js, auth, UI foundations, Vercel Pro auto-deploy)
- ✅ Slice 1 — Whoop adapter end-to-end (OAuth, 6-hourly cron, ingest/diagnose)
- ✅ Slice 1.5 — Incremental backfill (chunked sweep — superseded by refill)
- ✅ Slice 1.6 — Refill (ID-diff full-history load)
- ✅ Slice 2 — Withings BP adapter end-to-end (OAuth, 12-hourly cron, ID-diff refill → `bp_readings`)
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`: Weight · Glucose · Symptom · BP + always-visible Note; recent list with edit/delete; manual-only guard)
- → Slice 4 — Oxylink SpO2 (NEXT; spec not yet written)
- ⬜ Slice 5 CGM/Nightscout + Tidepool · 6 Labs PDF · 7 Trend dashboard + doctor-record export · 8 Discipline layer · Final wearable swap (Nov 2026)

## Data state
- **Whoop:** 5,637 rows in `health_observations` (`source_slug='whoop'`); 5-row residual gap = one in-progress cycle (`1572138504`), self-heals on next cron.
- **Withings:** 17/17 BP readings in `bp_readings`; Diagnose gap = 0.
- **Manual:** schema exercised locally; first production rows pending Slice-3 smoke test on Vercel.
- **Pending verification:** first scheduled Withings `0 */12 * * *` cron tick; Slice 3 post-deploy smoke (one of each type, edit one, delete one, confirm canonical values + `ingestion_log` counts).

## Next action
Push Slice 3 to `main`, then run the smoke test on Vercel per the spec (Step 7). Once green, draft the Slice 4 spec (Oxylink SpO2) from the handover roadmap + data-model spec — decide upload mechanism (CSV vs Apple Health vs both) up-front.

## Open items (non-blocking)
- Slice 2 scheduled-cron tick verification.
- Slice 3 production smoke test (post-deploy).
- No cron failure alerting — "last successful run > 24h → notify" worth a small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless; a `chk_status` cleanup utility someday.
