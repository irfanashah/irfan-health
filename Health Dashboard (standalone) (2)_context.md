# Context — Health Dashboard (standalone) (2).html

- **Source file:** `/Users/irfan/Documents/irfan-health/Health Dashboard (standalone) (2).html`
- **Date read:** 2026-06-22
- **Document type:** Claude Design standalone export (React + Babel-in-browser bundle) — a full visual redesign of the health dashboard, exported as a single self-contained HTML with assets gzip+base64-embedded.

## Summary
Claude Design's redesign of the dashboard, generated from `baselines-drift-design-brief_2026-06-22.md`. Irfan chose its **Baselines & Drift** design and decided to move that panel into its own third top-level tab. The file is a standalone artifact: line ~179 is the escaped HTML (CSS + font-faces + an empty `#root` + 7 `text/babel` script refs); line ~171 is a JSON blob mapping asset-UUID → gzip+base64 payload (React/ReactDOM/Babel libs, the app's 7 JSX modules, and Manrope woff2 fonts).

## How to read it again (don't re-derive)
Decode line 171 JSON → for each `application/javascript` entry, `gzip.decompress(base64decode(data))`. The 7 app modules were written to `outputs/decoded_js/app0..app6_*.jsx`. **app4 (`4d116873`) = the Baselines & Drift component** (`DriftPanel`, `SignalCard`, `SignalDetail`, `BandSpark`, `SteadyTier`, `MutedTier`). app6 (`5a07fb27`) = app shell + `.tabnav`. The decoded readable HTML (CSS + structure) is at `outputs/decoded_dashboard.html`.

## Key facts
- Design tokens: dark default, Manrope, `--teal #11D29E / --purple #B077DA / --amber #F4B14B / --red #F47C75` (dark), radius 18/12. Matches the live app's accent family.
- Baselines & Drift structure: an `overall-read` band (tone calm/attention/safety) → tiers **Below a safe line → Worth a look → Going the right way → Steady (chips) → Not reading yet (dashed chips)** → not-anchored footnote. Signal cards carry a plain lead sentence, latest + "your normal lo–hi", a `BandSpark` (line over shaded personal-normal band), and a "See the numbers" expand with plain-language stats (Your normal / Last 2 weeks / Pattern / Confidence).
- State vocabulary (renamed jargon): safety="Below a safe line", drift="Worth a look", improvement="An improvement", steady="Steady", settling="Still settling in", nodata="No recent data".
- Feeds off a precomputed `HEALTH_DATA.drift = { tone, title, body, safety[], drift[], improvement[], steady[], settling[], nodata[] }`; each signal has `{label, short, source, unit, fmt, latest, lo, hi, rMed, concern, state, dirWord, magWord, series, windowDays, total14, concernSideDays, goodSideDays, totalData, dataNights, lastSeen}`.

## Decisions / conclusions
- Build plan captured in `baselines-drift-tab-redesign-spec_2026-06-22.md`: tab move + panel rebuild + a TS mapping layer (`DriftVerdict[] + metric_drift rows → drift` shape). **Engine untouched** (no `metric_drift` / `drift-config` / `evaluate.ts` change); only `fetchMetricDrift` window widened to ~30 days.
- The richer per-signal shape (lo/hi band, pattern counts, magnitude words, source labels, tone/title/body) is **presentation-derived in TS** from existing stats — no new SQL.

## Open items (decisions flagged in the spec, pending Irfan)
1. "Your normal" band width `k` in `median ± k·MAD` (proposed 2). 2. `watch` tier mapping (proposed: fold into Steady). 3. `caution` low-floor (proposed: inline card note). 4. `magWord` z-bands (≈1.2 / 2.5). 5. Keep design copy verbatim (proposed yes).

## Dependencies
`baselines-drift-design-brief_2026-06-22.md` (the brief that produced it), `baselines-drift-tab-redesign-spec_2026-06-22.md` (the build spec), `migration_004_baselines_drift.sql` (`metric_drift` view — unchanged), `components/dashboard/drift/evaluate.ts` + `drift-config.ts` (engine — unchanged), `app/lib/dashboard/baselines.ts` (fetch window widen). Superseded in-house alternative: `baselines-drift-redesign-spec_2026-06-22.md`.
