# Baselines & Drift Panel — Redesign Build Spec (mockup version)

**Version:** 1.0
**Date:** 2026-06-22
**Status:** View-layer redesign of the existing `BaselinesDriftPanel`. This is the spec for the **mockup version** (summary verdict + severity hierarchy). To be built and compared against a parallel Claude Design exploration before a final choice. Build only when picked.
**Scope:** Presentation only. **No change** to `migration_003`/`migration_004`, the `metric_drift` view, `drift-config.ts`, `evaluate.ts`, `app/lib/dashboard/baselines.ts`, or any data/query layer. The redesign consumes the **exact same `DriftVerdict[]`** the current panel already computes. No migration, no new deps.

---

## Why

User feedback on the current panel: two problems — **no glanceable answer** (a flat, uniform 10-row list with no "am I okay?" summary) and **visual style** (monochrome rows, weak hierarchy). The stats themselves and the wording were *not* flagged. So: keep the engine, the verdicts, and the nine detail stats; restructure how they're presented.

The current panel renders one identical row per metric, each expandable to a 9-stat grid. The redesign keeps the expand and the stats verbatim but reorganises the default view into a calm, severity-ordered hierarchy with a one-line overall verdict.

## What stays exactly as-is
- `evaluateMetric(...)` and the whole `DriftVerdict` shape — unchanged.
- The 9-stat expand grid (`DetailRow`, `statBlock`, `fmtZ`, `fmtShift`) — reused verbatim, just triggered from the new card/tile instead of the old row.
- `ExcludeTodayButton` — unchanged, stays in the header.
- The anchor-provenance note, the "interpretable signal, not a diagnosis" footer, the `LOW_FLOOR_PROVISIONAL_NOTE`, and the acute-path reminder — all retained.
- All honesty/clinical rules (suppressed labels, clinical-low precedence, associational callouts) — unchanged.

## New structure (four zones, top to bottom)

Compute `verdicts: DriftVerdict[]` exactly as today (`DRIFT_METRICS.map(evaluateMetric...)`). Then a new pure helper buckets and orders them.

### Zone 1 — Summary verdict band (the glanceable answer)
A single prominent strip derived from the verdict set. Pick the overall headline by worst-present state, in this precedence:
1. Any `clinicalLow === 'breach'` → **red**, "Something's below a safe line — look now" (this is the one place the panel can lean firm; still not the acute path).
2. Else any `tier === 'drift'` (state `active`, not suppressed) → **red/amber**, "Drift detected — worth raising with Dr. Jose".
3. Else any `tier === 'watch'` or `clinicalLow === 'caution'` → **amber**, "One signal worth a look" (pluralise on count).
4. Else (everything steady / win / establishing / no-data) → **teal**, "Holding steady".
Sub-line: a plain-language census, e.g. "10 tracked · 4 steady · 1 watching · 5 still settling in". Right side: small count chips per bucket (steady / watch / drift / establishing / no-data) — only show buckets with ≥1 member.

### Zone 2 — "Needs a look" (only if any member)
Full-width cards for the metrics that need attention: tier ∈ {`drift`, `watch`} (state `active`, not suppressed) **or** `clinicalLow` ∈ {`breach`, `caution`}. Sort by severity: breach → drift → watch → caution. Each card:
- metric label + the existing tier pill (and the clinical-low pill when breach/caution, with `LOW_FLOORS[metric].label`);
- the existing `callout` sentence (associational, already computed);
- a **Sparkline** (`components/dashboard/charts/Sparkline`) of the metric's recent trend — feed it the `today_value` series from `payload.drift[metric]` rows (drop nulls); colour by tier;
- the latest value, right-aligned, with unit.
- Click anywhere on the card → expand the existing 9-stat grid.

### Zone 3 — "Steady" (grid of compact tiles)
Metrics in state `active` with tier ∈ {`stable`, `win`}. A responsive tile grid (`grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))`). Each tile:
- metric label (small) + a status dot (teal for stable/win; if `win`, a small "improving" tag);
- latest value + unit (medium, tabular-nums);
- a small Sparkline (neutral/muted stroke for stable, teal for win).
- Click → expand the same 9-stat grid (inline below the tile, or a popover — builder's call, keep it calm).

### Zone 4 — "Still settling in / no recent data" (muted chips)
Metrics in state `establishing` or `no-recent-data`, grouped under two muted labels ("Still settling in:" / "No recent data:") as small chips (metric label only). These must NOT take a full row each — that's the current waste. A chip may still be clickable to expand stats if cheap; otherwise non-interactive is fine for these.

### Footer (retained)
The existing info note (interpretable-signal + acute-path + `LOW_FLOOR_PROVISIONAL_NOTE`) and the "drift callouts are observed patterns… worth mentioning to Dr. Jose" line when any drift is present.

## Language
Section headers and the verdict band use plain language ("Needs a look", "Steady", "Still settling in", "Holding steady"). The **per-metric pills keep the existing tier words** (Stable / Watch / Drift / Win) and the existing state pills — language wasn't flagged, and the words tie to the stats in the expand. (If, on review, the tier words should also soften, that's a one-place change in the `tierWord`/`STATE_PILL` maps — flag, don't assume.)

## Sparkline data note
The panel currently receives `payload.drift[metric]` = the recent bounded window of `MetricDriftRow`s (~14 days, per `baselines.ts`). That's enough for a sparkline. If a longer sparkline is wanted later, widen the window in `fetchMetricDrift` — but **don't** do that speculatively; 14 points is a fine sparkline and keeps the view's full-history scan bounded.

## Implementation
- Refactor `components/dashboard/panels/BaselinesDriftPanel.tsx` into the four zones. Extract a small pure helper (same file or a `drift/summary.ts`) that takes `DriftVerdict[]` and returns `{ headline, headlineTone, census, attention[], steady[], establishing[], noData[] }`.
- Reuse `Sparkline`, `Card`, `PanelHeader`, the existing `DetailRow`/`statBlock`/`fmtZ`/`fmtShift`, `ExcludeTodayButton`.
- Keep it `'use client'`; verdict computation stays in `useMemo` over `payload`.
- Match the dark dashboard aesthetic (teal/amber/red accents, calm). Reference the mockup for spacing/feel — but the mockup is illustrative, not pixel-spec.
- `npm run build` clean.

## Acceptance criteria
- [ ] Default view answers "am I okay?" in one glance via the verdict band; no need to read all 10 rows
- [ ] Attention-worthy metrics (drift/watch/clinical) are visually dominant and severity-ordered; steady metrics are quiet tiles; establishing/no-data collapse into chips (no full row each)
- [ ] Every metric still reaches the full 9-stat expand (unchanged content)
- [ ] Clinical-low precedence preserved — a breach/caution surfaces and a "win" never visually overrides it
- [ ] Suppressed, med-reset, anchor-provenance, and the provisional/acute-path notes all still render
- [ ] No change to views, drift-config, evaluate.ts, or the data layer; `DriftVerdict` consumed unchanged; no migration; no new deps; `npm run build` clean
- [ ] SpO2 (`spo2_avg`, `spo2_min`) flows through naturally once the SpO2-surfacing slice lands (this redesign is metric-count-agnostic — it maps `DRIFT_METRICS`)

---

*End of spec. Presentation refactor only. Build after comparing with the Claude Design exploration.*
