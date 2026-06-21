# Project State — Irfan's Health Platform

_Last updated: 2026-06-19 (session: Slice 7.1 — Trend dashboard built end-to-end + pushed; Irfan running deeper UI verification)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Slices 0–3, 5, 7.1 all built and on `main`. Slice 7.1 (trend dashboard) shipped: `daily_metrics` Postgres view + typed server data module + ported SVG charts + 7 panels at `/`; DiagnoseButton demoted to `/diagnostics`. `npm run build` clean. Vercel building on push. Irfan running deeper visual verification on the live dashboard.

## Slice ledger
- ✅ Slice 0 — Scaffold (Next.js, auth, UI foundations, Vercel Pro auto-deploy)
- ✅ Slice 1 — Whoop adapter end-to-end (OAuth, 6-hourly cron, ingest/diagnose)
- ✅ Slice 1.5 — Incremental backfill (chunked sweep — superseded by refill)
- ✅ Slice 1.6 — Refill (ID-diff full-history load)
- ✅ Slice 2 — Withings BP adapter end-to-end (OAuth, 12-hourly cron, ID-diff refill → `bp_readings`)
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`: Weight · Glucose · Symptom · BP + always-visible Note; recent list with edit/delete; manual-only guard)
- ⏸ Slice 4 — Oxylink SpO2 (PARKED 2026-06-17 — see `slice-4-oxylink-ingestion-options_2026-06-17.md`)
- ✅ Slice 5 — Nightscout agnostic CGM adapter — deployed + verified gap=0 (2,995 rows) 2026-06-19
- ⊘ Slice 5a (Dexcom Clarity CSV import) — DEFERRED 2026-06-18; Clarity history loaded into Nightscout via the throwaway loader
- ✅ Slice 7.1 — Trend dashboard (baseline) — built + pushed 2026-06-19; deeper visual verification in progress
- → Slice 7.2 — Connections (Correlation Explorer + 5 cross-source views + Cardiac Readiness composite) — NEXT; spec to write from `prototype-src/05-connections.jsx`
- ⬜ Slice 6 — Labs PDF; medication-adherence panel (deferred — needs dose-logging path); doctor-record export
- ⬜ Slice 8 — Discipline layer · Final wearable swap (Nov 2026)

## Data state
- **Whoop:** `health_observations` complete — Diagnose gap = 0; 6-hourly cron running clean.
- **Withings:** `bp_readings` complete — Diagnose gap = 0; 12-hourly cron running clean. (Adapter only ingests BP, not weight — see open items.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows for `source_slug='nightscout'`; Diagnose gap = 0 over the last 30 days. 12-hourly cron live. xDrip+ on the Fold pipeline armed; awaiting a new G7 sensor to start the live feed.
- **`daily_metrics` view:** applied 2026-06-19; spot-check against raw rows green (BP/recovery/sleep/CGM patterns all expected; weight column null across all days — no source writes weight yet).

## Next action
Irfan finishes deeper visual verification on the live dashboard; any follow-on fixes land as small commits. Once green, **draft the Slice 7.2 spec** (Connections — port `prototype-src/05-connections.jsx` with the Cardiac Readiness composite formula already in `02-data-layer.jsx`, plus small-n honesty guardrails). The Correlations tab in the dashboard header is already a disabled stub waiting to flip on.

## Open items (non-blocking)
- **Slice 7.1 deeper UI verification** — push landed 2026-06-19; Irfan eyeballing each panel against real data on Vercel. Fixes land as small commits.
- **Withings adapter ingests BP only, NOT weight** — `weight` column is null on every `daily_metrics` row because no source writes `metric_type='weight'` except deleted manual entries. Worth a small follow-on slice to extend `adapters/withings/` to pull `meastype=1` and write into `health_observations`. Dashboard already handles the empty state.
- **xDrip+ ongoing CGM capture** — installed + configured on the Fold 2026-06-19. Apply new G7 sensor, then confirm one live reading lands.
- **`daily_metrics` view aggregates full history per query** — trivial at current ~3k CGM rows; switch to a materialised view or date-parameterised function once CGM accumulates many months of data. Future perf item.
- **Slice 4 Oxylink** parked — see `slice-4-oxylink-ingestion-options_2026-06-17.md`.
- No cron failure alerting — "last successful run > 24h → notify" worth a small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless; a `chk_status` cleanup utility someday.
