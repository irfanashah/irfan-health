# Project State — Irfan's Health Platform

_Last updated: 2026-06-17 (session: Slice 2 Withings BP closeout + records sync)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Whoop pipeline live and reconciled through Slice 1.6; Withings BP (Slice 2) built and deployed. Both adapters running on cron. No build in progress.

## Slice ledger
- ✅ Slice 0 — Scaffold (Next.js, auth, UI foundations, Vercel Pro auto-deploy)
- ✅ Slice 1 — Whoop adapter end-to-end (OAuth, 6-hourly cron, ingest/diagnose)
- ✅ Slice 1.5 — Incremental backfill (chunked sweep — superseded by refill)
- ✅ Slice 1.6 — Refill (ID-diff full-history load)
- ✅ Slice 2 — Withings BP adapter end-to-end (OAuth, 12-hourly cron, ID-diff refill → `bp_readings`)
- → Slice 3 — Manual entry + quick-log UI (NEXT; spec not yet written)
- ⬜ Slice 4 Oxylink SpO2 · 5 CGM/Nightscout + Tidepool · 6 Labs PDF · 7 Trend dashboard + doctor-record export · 8 Discipline layer · Final wearable swap (Nov 2026)

## Data state
- **Whoop:** 5,637 rows in `health_observations` (`source_slug='whoop'`); 5-row residual gap = one in-progress cycle (`1572138504`), self-heals on next cron run after Whoop scores it.
- **Withings:** first refill landed 17/17 BP readings into `bp_readings`; Diagnose gap = 0.
- **Pending verification:** first scheduled `0 */12 * * *` Withings cron tick lands a `source_slug='withings'` row in `ingestion_log` with `status='success'`.

## Next action
Draft the Slice 3 spec (manual entry + quick-log UI) from the handover roadmap (§7) + data-model spec — weight, fingerstick glucose, symptoms/notes via the `manual` source slug into `health_observations` (and possibly manual BP into `bp_readings`). First slice with no OAuth/API adapter — primarily a UI/UX problem. Confirm scope, then build.

## Open items (non-blocking)
- Slice 2 scheduled-cron tick verification (see Data state).
- No cron failure alerting — worth a "last successful run > 24h → notify" job before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless; a `chk_status` cleanup utility someday.
