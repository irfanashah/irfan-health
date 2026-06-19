# Slice 5 — Nightscout CGM Adapter (device-agnostic diabetes layer)

**Version:** 1.0
**Date:** 2026-06-18
**Prerequisites:** Slices 0–3 complete. Reuses `adapters/_lib/` and the Slice 3 glucose helper. Nightscout is live (see below).

---

## Overview

The device-agnostic CGM layer. Reads glucose readings from Irfan's self-hosted Nightscout REST API and normalises them into `health_observations` as `glucose_cgm` (`time_series`). Architecturally identical to the Whoop/Withings adapters (typed API client + adapter + cron + manual ingest + ID-diff refill + diagnose), with three differences: the source auth is a **static URL + read token** (not OAuth), the data is **dense** (~288 readings/day during a sensor stint), and it is **episodic** (no data between stints — a cron run that finds nothing is success, not an error).

Device-agnostic by construction: the adapter only ever talks to Nightscout, which presents an identical `sgv` schema regardless of which CGM/bridge produced the reading (Dexcom G7 via xDrip+, Libre via Juggluco, the one-time Clarity backfill, etc.). The originating device just lands in `extras.device`. Swapping CGM brands needs zero adapter changes.

**No new migration.** `glucose_cgm` (canonical mmol/L) and `source_slug='nightscout'` are both already in the data-model controlled vocabulary.

## Live environment (as of 2026-06-18)

- Nightscout: `https://srv1014733.hstgr.cloud` (self-hosted, Hostinger Docker Manager; private, valid TLS).
- Read-only token exists (subject `irfan-health`). **Token value is NOT in the repo** — it goes in a Vercel env var.
- History already loaded: ~2,995 `sgv` readings (2026-05-28 → 06-08), `device='clarity-import'`, via the one-time `clarity-to-nightscout-loader.py`. This is real data to build and verify against now — no live sensor needed.
- Ongoing capture: xDrip+ on the Fold → Nightscout, starting at the next sensor stint. The adapter treats live and backfilled readings identically.

## Auth & config (NOT OAuth)

Nightscout auth is a static URL + token. Store as Vercel environment variables (no `oauth_tokens` row, no refresh):
- `NIGHTSCOUT_URL` = `https://srv1014733.hstgr.cloud`
- `NIGHTSCOUT_TOKEN` = the read-only token (subject `irfan-health`)
- `CRON_SECRET` reused from Slice 1.

Pass the token as the `token` query param on every request. Read-only is sufficient (we only GET).

---

## Nightscout API

- Endpoint: `GET {NIGHTSCOUT_URL}/api/v1/entries.json`
- Query params:
  - `token={NIGHTSCOUT_TOKEN}`
  - `find[type]=sgv` — **only sensor glucose values**; ignore `mbg` (manual BG), `cal` (calibration), etc.
  - `find[date][$gte]=<epoch_ms>` and `find[date][$lte]=<epoch_ms>` — window bounds (NS `date` is epoch ms, UTC).
  - `count=<n>` — NS defaults to 10; set high (e.g. 100000) so a window isn't truncated.
- Response: JSON array of entries. An `sgv` entry looks like:
  ```json
  {
    "_id": "66f3a1b2c9e4...",        // Mongo ObjectId string — STABLE unique id
    "type": "sgv",
    "sgv": 115,                       // mg/dL
    "date": 1748450000000,            // epoch ms (UTC)
    "dateString": "2026-05-28T14:32:13.000Z",
    "device": "clarity-import",       // or e.g. "xDrip-DexcomG7" for live
    "direction": "Flat",              // trend (may be absent on backfilled rows)
    "noise": 1                        // may be absent
  }
  ```

---

## Mapping: `sgv` entry → `health_observations`

| Column | Source | Notes |
|---|---|---|
| `source_slug` | constant `'nightscout'` | |
| `source_record_id` | the entry `_id` | stable Mongo id; the dedup key |
| `data_shape` | constant `'time_series'` | |
| `metric_type` | constant `'glucose_cgm'` | |
| `recorded_at` | `new Date(entry.date).toISOString()` | `date` is epoch ms UTC |
| `numeric_value` | `entry.sgv` | mg/dL as reported |
| `unit` | constant `'mg/dL'` | |
| `canonical_value` | `sgv ÷ 18.0`, 1 dp | reuse Slice 3 `app/log/_lib/glucose.ts` |
| `canonical_unit` | constant `'mmol/L'` | |
| `extras` | `{ direction, device, noise }` (omit missing keys) | trend/source/quality context |
| `ingestion_log_id` | from the run's `ingestion_log` row | |

`period_start`/`period_end` null (time_series uses `recorded_at` — satisfies `chk_obs_time_coverage`).

**Skip a row if:** `type !== 'sgv'`, `sgv` missing/non-numeric, or `sgv` outside the plausibility guard **40–500 mg/dL** (decided 2026-06-18). Rationale: real CGM output starts at 40 (Dexcom G7 range 40–400, Libre 40–500); anything below 40 is a sentinel/special code (0, 1, single digits, LOW encodings), not a real reading. 40–500 covers both devices' valid ranges and excludes all sub-40 sentinels. If real readings ever get filtered, the `ingestion_log` skip count surfaces it — widen then.

---

## Routes (mirror Whoop/Withings)

- `adapters/nightscout/{api,index}.ts` — typed NS client (`api.ts`: GET entries with token + `find` window + count) and the adapter (`index.ts`: map sgv → rows, batch-upsert). Export a `buildCgmRow` used by both the cron adapter and the refill route (gotcha #25 — keep the filter canonical in one place).
- `app/api/cron/nightscout/route.ts` — `CRON_SECRET` bearer; pulls a recent window (**48 h** — decided 2026-06-18; ~4 cron cycles of overlap, resilient to a missed run, dedup makes overlap free) and upserts. Episodic: empty result = `status='success'`, `records_found=0`. Add to `vercel.json` on `0 */12 * * *` (12-hourly; trends, not live).
- `app/api/ingest/nightscout/route.ts` — session-auth manual trigger, optional `{ fromDate, toDate }`.
- `app/api/refill/nightscout/route.ts` — ID-diff full-history load: fetch all `sgv` `_id`s for `[2026-05-01, today]` (**default decided 2026-06-18** — Irfan's entire CGM history starts 2026-05-28, so a 2025-01-01 default would waste ~17 empty chunks; `POST { fromDate }` overrides for the rare case) (paginate by date-window chunks — see below), pull existing `source_record_id`s from `health_observations` where `source_slug='nightscout'` (paginated past Supabase's 1000-row cap, gotcha #10), diff in memory, batch-upsert only missing rows 200 at a time (gotcha #11). `maxDuration = 800`.
- `app/api/diagnose/nightscout/route.ts` — NS `sgv` count vs DB `glucose_cgm` count. **Default window = last 30 days, with an override (decided 2026-06-18) — do NOT mirror Whoop's full-history default**; CGM volume (~288/day) makes a full-history diagnose expensive. Diagnose is the quick health check; the refill is the full-reconciliation tool. Extend `components/DiagnoseButton.tsx` to render a Nightscout panel alongside Whoop + Withings (`Promise.allSettled`).

## Density / pagination (the one new wrinkle)

CGM is ~288 readings/day during a stint, so a multi-month window is large. Don't pull it all in one request. The refill should **window by date** (e.g. 30-day chunks), each chunk a single `entries.json` call with `find[date][$gte/$lte]` + a high `count`, accumulate, then diff + batch-upsert. The cron only ever pulls a small recent window, so it's cheap. (Between stints every chunk returns `[]` — expected.)

## Dedup

`UNIQUE (source_slug, source_record_id)` on the table, keyed by the NS `_id`. Upsert is idempotent — re-running cron/refill over an overlapping window inserts nothing new. `Number()`-coerce on any value compare (gotcha #8).

## Cross-source note (Slice 7)

Both `nightscout` and (deferred) `dexcom_clarity` could write `glucose_cgm`. Not an issue here — there is no `dexcom_clarity` source (history was loaded into Nightscout instead, so it's all `source_slug='nightscout'`). Single source; nothing to reconcile.

---

## Implementation steps

1. Add the three env vars to `.env.local` and Vercel (`NIGHTSCOUT_URL`, `NIGHTSCOUT_TOKEN`; `CRON_SECRET` exists).
2. `adapters/nightscout/api.ts` + `index.ts` (with shared `buildCgmRow`).
3. `/api/ingest/nightscout`, `/api/cron/nightscout`, `/api/refill/nightscout`, `/api/diagnose/nightscout`.
4. `vercel.json` — add the Nightscout cron `0 */12 * * *` (alongside Whoop + Withings).
5. Extend `DiagnoseButton.tsx` with a Nightscout panel.
6. `npm run build` clean.
7. (MANUAL — Irfan) After deploy: run the refill once to pull the ~2,995 backfilled readings; Diagnose should show gap = 0.

## Verification checklist

- [ ] Refill imports the backfilled history → ~2,995 `glucose_cgm` rows for `source_slug='nightscout'`
- [ ] Canonical conversion correct (e.g. 115 mg/dL → 6.4 mmol/L)
- [ ] `source_record_id` = NS `_id`; re-running refill/cron inserts 0 new (dedup)
- [ ] Only `sgv` ingested (no mbg/cal); out-of-range/blank skipped
- [ ] Diagnose shows NS sgv count == DB glucose_cgm count (gap = 0)
- [ ] Cron with an empty window returns `status='success'`, `records_found=0` (episodic — not an error)
- [ ] `npm run build` clean

## Out of scope

- Fingerstick (stays on Slice 3 manual `/log`)
- Charts/trends (Slice 7)
- Treatments/care-portal data, calibrations, device events — `sgv` only

---

*End of Slice 5 spec. Next: Slice 6 — Labs PDF import, or Slice 7 — trend dashboard.*
