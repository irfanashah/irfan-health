# Project State — Irfan's Health Platform

_Last updated: 2026-06-22 (session: Slice 7.3 — Personal Baseline & Drift Engine built end-to-end; dashboard early-warning layer live)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
Dashboard layer feature-complete across single-source (7.1), cross-source (7.2), and personal-baseline drift (7.3). Slice 7.3 just built locally end-to-end: `migration_004` (4 RLS-protected tables + `metric_drift` view) + `migration_005` (`set_anchor` PL/pgSQL function for atomic supersede) + drift-config + low-side clinical floors + data module + drift evaluator + Baselines & Drift panel + `/baselines` page with set-anchor / context / med-change forms + exclude-today quick action. `npm run build` clean. Migrations 004 + 005 applied in Supabase; spot-check on RHR/HRV view output behaved exactly as the config predicts.

## Slice ledger
- ✅ Slice 0 — Scaffold
- ✅ Slice 1 — Whoop adapter end-to-end · ✅ 1.5 backfill · ✅ 1.6 refill
- ✅ Slice 2 — Withings BP adapter end-to-end
- ✅ Slice 3 — Manual entry + quick-log UI (`/log`)
- ⏸ Slice 4 — Oxylink SpO2 (PARKED 2026-06-17)
- ✅ Slice 5 — Nightscout agnostic CGM adapter — deployed + verified gap=0
- ⊘ Slice 5a (Dexcom Clarity CSV import) — DEFERRED 2026-06-18
- ✅ Slice 7.1 — Trend dashboard (baseline)
- ✅ Slice 7.2 — Connections (Correlation Explorer + Cardiac Readiness + cross-source views)
- ✅ Slice 7.3 — Personal Baseline & Drift Engine — built locally 2026-06-22 (not yet pushed)
- → Withings weight extension (small follow-on) — NEXT; unblocks the Weight panel + the Weight metric in the Correlation Explorer + Slice 7.3 weight drift
- ⬜ Anchor population (manual, post-rehab — form is ready); confirm Dr. Jose low floors; Slice 6 — Labs PDF; med-adherence + meal-logging paths; doctor-record export; Slice 8 — Discipline layer

## Data state
- **Whoop:** `health_observations` complete — Diagnose gap = 0; 6-hourly cron running clean.
- **Withings:** `bp_readings` complete — Diagnose gap = 0; 12-hourly cron running clean. (Adapter still BP-only — weight extension queued.)
- **Manual:** live on Vercel; smoke test passed.
- **Nightscout (CGM):** `glucose_cgm` = 2,995 rows; Diagnose gap = 0 (last 30 d). 12-hourly cron live. xDrip+ pipeline armed; new G7 sensor pending.
- **`daily_metrics` view:** applied 2026-06-19.
- **`metric_drift` view + 4 new tables (Slice 7.3):** applied 2026-06-22 with RLS; spot-check green (RHR/HRV `active` with rolling_n≈24/short_n=7/prior_n≈17, BP `establishing` due to sparse readings, weight empty by design).
- **Anchor not yet set** — by design until post-rehab. Set form ready at `/baselines`.

## Next action
Push Slice 7.3 to `main` when ready. Then the small **Withings-weight extension** (extend `adapters/withings/{api,index}.ts` to pull `meastype=1` and write `metric_type='weight'`) — unblocks the Weight panel, the Correlation Explorer's Weight metric, the BP-vs-weight preset, and the 7.3 weight-drift evaluation. After that, decide between Slice 6 (Labs PDF) and population-side tasks (anchor set, Dr. Jose floor confirmation).

## Open items (non-blocking)
- **Slice 7.3 push + visual verification** — locally built; deploy when convenient. Expect RHR/HRV `active+stable`, BP `establishing`, CGM `no-recent-data`, weight empty until logged.
- **Slice 7.3 confirm-Dr-Jose low floors** — provisional numbers in `LOW_FLOORS` (rhr <50, sys <90, dia <60) carry the visible `LOW_FLOOR_PROVISIONAL_NOTE` footer; replace once Dr. Jose lands on the right numbers.
- **Anchor population** — `/baselines` set-anchor form is built and ready; populate post-rehab when "stable normal" is clinically true.
- **Withings adapter ingests BP only, NOT weight** — small follow-on slice (see Next action).
- **xDrip+ ongoing CGM capture** — new G7 sensor pending, then confirm one live reading lands.
- **`daily_metrics` + `metric_drift` views both scan full history per query** — trivial at current ~3k CGM rows; future perf item once CGM accrues months.
- **Slice 4 Oxylink** parked.
- No cron failure alerting — small slice before clinical reliance.
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
