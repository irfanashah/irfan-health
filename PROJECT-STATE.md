# Project State — Irfan's Health Platform

_Last updated: 2026-06-19 (session: Slice 7.2 — Connections tab built end-to-end; dashboard now complete)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Dashboard is feature-complete. Slice 7.2 (Connections) just built locally end-to-end: 5 cross-source panels + honesty layer + Cardiac Readiness composite + latest-complete fallback for "today" + associational-only prose. Correlations tab flipped on in the header. `npm run build` clean. Slice 7.1 visual verification still in flight on Irfan's side — fixes from that land as small commits alongside.

## Slice ledger
- ✅ Slice 0 — Scaffold (Next.js, auth, UI foundations, Vercel Pro auto-deploy)
- ✅ Slice 1 — Whoop adapter end-to-end (OAuth, 6-hourly cron, ingest/diagnose)
- ✅ Slice 1.5 — Incremental backfill (chunked sweep — superseded by refill)
- ✅ Slice 1.6 — Refill (ID-diff full-history load)
- ✅ Slice 2 — Withings BP adapter end-to-end (OAuth, 12-hourly cron, ID-diff refill → `bp_readings`)
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ⏸ Slice 4 — Oxylink SpO2 (PARKED 2026-06-17)
- ✅ Slice 5 — Nightscout agnostic CGM adapter — deployed + verified gap=0 2026-06-19
- ⊘ Slice 5a (Dexcom Clarity CSV import) — DEFERRED 2026-06-18
- ✅ Slice 7.1 — Trend dashboard (baseline) — built + pushed 2026-06-19; deeper visual verification in progress
- ✅ Slice 7.2 — Connections (Correlation Explorer + 5 cross-source views + Cardiac Readiness) — built locally 2026-06-19; not yet pushed
- → Withings weight extension (small follow-on) — NEXT; unblocks the Weight panel + the Weight metric in the Correlation Explorer
- ⬜ Slice 6 — Labs PDF; medication-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer

## Data state
- **Whoop:** `health_observations` complete — Diagnose gap = 0; 6-hourly cron running clean.
- **Withings:** `bp_readings` complete — Diagnose gap = 0; 12-hourly cron running clean. (Adapter only ingests BP, not weight — see open items.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows; Diagnose gap = 0 over the last 30 days. 12-hourly cron live. xDrip+ pipeline armed; new G7 sensor pending.
- **`daily_metrics` view:** applied 2026-06-19; spot-check green. Now read by both dashboard tabs.

## Next action
1. Hold for Irfan's deeper visual verification of the dashboard (both tabs); fix anything that surfaces.
2. **Small Withings-weight extension slice**: extend `adapters/withings/{api,index}.ts` to pull `meastype=1` and write `metric_type='weight'` rows. Unblocks the Weight panel + the Correlation Explorer's `weight` metric + the `Weight → BP` preset.
3. Then **Slice 6 — Labs PDF spec + build** (no spec yet — draft from data-model spec §1.5–1.6; open decision: LLM-based extraction vs structured OCR vs manual structured entry).

## Open items (non-blocking)
- **Slice 7.1 + 7.2 deeper visual verification** — both tabs live for Irfan to walk through.
- **Withings adapter ingests BP only, NOT weight** — see Next action #2.
- **xDrip+ ongoing CGM capture** — new G7 sensor pending, then confirm one live reading lands.
- **`daily_metrics` view aggregates full history per query** — future perf item once CGM accumulates.
- **Slice 4 Oxylink** parked.
- No cron failure alerting — small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
