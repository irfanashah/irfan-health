# Baselines & Drift — New Tab + Claude Design Redesign — Build Spec

**Version:** 1.0
**Date:** 2026-06-22
**Status:** Build spec for moving Baselines & Drift out of the Dashboard tab into its **own third top-level tab**, rebuilt to the **Claude Design** layout (decoded from `Health Dashboard (standalone) (2).html`; see `Health-Dashboard-standalone-2_context.md`). Supersedes the earlier `baselines-drift-redesign-spec_2026-06-22.md` (the in-house mockup version) — Irfan chose the Claude Design version.
**Scope:** Tab move + panel rebuild + a presentation/mapping layer. **The drift engine is untouched** — no change to `migration_004`'s `metric_drift` view, `drift-config.ts` thresholds, or `evaluate.ts`'s gate/persistence/recency logic. One small data-layer change (widen the fetch window). Same SQL-stats / TS-interpretation split as today: the new mapping layer is pure TS interpretation over the existing stats.

---

## What Claude Design produced (captured)

A calm, plain-language rebuild of the panel. Decoded source: `outputs/decoded_js/app4_4d116873.jsx` (component) + the `Baselines & Drift` CSS block in the decoded HTML (`.overall-read`, `.sig-card`, `.steady-chips`, `.muted-chips`, `.tabnav`, etc.). Structure:

- **Header:** "Baselines & drift" + a right-side pill: "Learning your normal · 4-week window".
- **Overall read band** (`.overall-read`, tone `calm` / `attention` / `safety`): an icon (check / activity / alert), a big plain-language `title`, and a one-paragraph `body`. This is the glanceable answer.
- **Tiers, in precedence:**
  1. **Below a safe line** (red) — hero cards. Clinical-floor breach.
  2. **Worth a look** (amber) — hero cards. Confirmed drift.
  3. **Going the right way** (teal) — medium cards, 2-up. Improvements.
  4. **Steady** (teal dot) — chips ("N holding at your normal"); click a chip to expand its detail.
  5. **Not reading yet** (dim) — dashed muted chips for "still settling in" and "no recent data", each with a plain note.
- **Signal card** (`SignalCard`): metric name + source label (Whoop/Withings/CGM), a status pill with a trend arrow, a plain lead sentence ("Has been running a little higher than your normal for about two weeks."), the latest value + "normal lo–hi", a **band sparkline** (`BandSpark` — the line drawn over a shaded "your normal" band, recent out-of-band points emphasised, today's point marked), and a "See the numbers" expand.
- **Depth-on-demand** (`SignalDetail`): plain-language stat rows — "Your normal: lo–hi", "Last 2 weeks: around X — a little higher", "Pattern: 9 of the last 14 mornings higher than usual", "Confidence: 23 readings over 4 weeks — solid" — plus the footnote "Compared against your own recent history — not population averages. A pattern to notice, not a diagnosis."
- **State vocabulary (renamed jargon):** safety → "Below a safe line"; drift → "Worth a look"; improvement → "An improvement"; steady → "Steady"; settling → "Still settling in"; nodata → "No recent data".
- **Footnote:** the not-yet-anchored note + "Not medical advice — bring anything notable to Dr. Jose."

The design feeds off a precomputed `HEALTH_DATA.drift` object: `{ tone, title, body, safety[], drift[], improvement[], steady[], settling[], nodata[] }`, where each signal carries `{ id, label, short, source, unit, fmt, latest, lo, hi, rMed, concern, state, dirWord, magWord, series, windowDays, total14, concernSideDays, goodSideDays, totalData, dataNights, lastSeen }`. **Our build's job is to produce that object from the real engine output.**

---

## Part A — Move to a third top-level tab

- The dashboard header tab nav currently branches Dashboard ↔ Correlations (`components/dashboard/DashboardClient.tsx`, with `ConnectionsTab.tsx` as the Correlations shell). Add a **third tab "Baselines & drift"** (tab id e.g. `baselines`). Match the decoded `.tabnav`/`.tab`/`.tab.active` styling (teal underline) — port those CSS rules into `app/dashboard.css`.
- **Remove `BaselinesDriftPanel` from the Dashboard tab** (it currently renders directly after `TodayAtAGlance` in `DashboardClient`). The Dashboard tab returns to its other panels; Baselines & drift no longer crowds it.
- Create a `BaselinesTab.tsx` shell (mirror `ConnectionsTab.tsx`): a kicker + section title + sub, then the rebuilt drift panel full-width on its own canvas. Tab switching stays in-place (no re-fetch) — the baselines payload is already fetched server-side and passed to `DashboardClient`; just route it to the new tab branch.
- The existing **`/baselines` route** (set-anchor / context / med-change forms) stays exactly as-is. The new tab is the read surface; the footnote's "set a healthy baseline" line should link to `/baselines`.
- Header note: the old in-dashboard `ExcludeTodayButton` lived in the panel header — keep an equivalent affordance in the new tab (header or footnote area).

## Part B — Rebuild the panel to the Claude Design layout

- Replace the internals of `components/dashboard/panels/BaselinesDriftPanel.tsx` (or a new `BaselinesDriftView.tsx` under the tab) with the decoded component structure: `DriftPanel` → overall-read band → the five tiers → `SignalCard` / `SignalDetail` / `BandSpark` / `SteadyTier` / `MutedTier`.
- Port the `Baselines & Drift` CSS block (the `.overall-read`, `.tier`, `.sig-card`, `.steady-chip`, `.muted-chip`, `.drift-footnote`, `.tabnav` rules from the decoded HTML) into `app/dashboard.css`, re-rooted on the existing `.dark`/`.light` mechanism (gotcha #32 — don't reintroduce `[data-theme]`).
- `BandSpark` is a **custom SVG** (consistent with the no-recharts decision) — port it; it draws the line over a shaded median-band with dashed edges, emphasises recent out-of-band points, and marks today. Reuse `useMeasure` from `components/dashboard/charts`.
- Keep the plain-language copy from the design verbatim unless a decision below changes it.

## Part C — Mapping layer (the real work): engine output → design `d` shape

Add a pure module (e.g. `components/dashboard/drift/present.ts`) that takes the existing `DriftVerdict[]` (from `evaluateMetric`, unchanged) plus each metric's `MetricDriftRow[]` (from `payload.drift[metric]`) and returns the design's `drift` object. Mappings:

**State remap** (engine → design) — RESOLVED per Decisions 2 & 3:
- `clinicalLow === 'breach'` → `safety` (red, "Below a safe line").
- `tier === 'drift'` (state `active`, not suppressed) → `drift` ("Worth a look"), no early tag.
- `tier === 'watch'` (active, not suppressed) → `drift` tier ("Worth a look") **with an "early — not yet confirmed" tag** on the card, and counted as "emerging" (not "confirmed") in the overall-read copy. (Decision 2: surface watch early, but never claim confirmation.)
- `clinicalLow === 'caution'` (not breached) → `drift` tier ("Worth a look") as its own card, **phrased "approaching your low line"** — distinct lead from the drift cards' "running higher/lower than normal", so a floor-approach and a drift-from-normal don't blur. (Decision 3.)
- `tier === 'win'` (active, `acknowledgeGood`) → `improvement`.
- `tier === 'stable'` (active) → `steady`.
- `state === 'establishing'` → `settling`.
- `state === 'no-recent-data'` → `nodata`.
- A suppressed metric never enters `drift`/`safety` regardless of tier (render per existing suppressed treatment / quietly in steady with a "paused" note).

**Derived per-signal fields (all from existing stats — no SQL change):**
- `lo` / `hi` — the "your normal" band. **Derive** `lo = rolling_median − 2·rolling_mad`, `hi = rolling_median + 2·rolling_mad` (Decision 1: **k = 2**). Display-only band; the gate still uses the real thresholds.
- `rMed` = `rolling_median`. `latest` = `today_value`. `concern` = `config.concerning`. `unit`/`label`/`short` from `drift-config`.
- `dirWord` = `latest > rolling_median ? 'higher' : 'lower'` (drives the up/down arrow).
- `magWord` from `|short_vs_prior_z|` (Decision 4, RESOLVED): `< 1.2` → "a little", `1.2–2.5` → "noticeably", `> 2.5` → "well".
- `series` = the `today_value` sequence across the metric's rows (nulls dropped) for `BandSpark`. `windowDays` = `config.shortWindowDays`.
- `total14` = count of data-days in the window; `concernSideDays` = count beyond the concern-side band edge; `goodSideDays` = count beyond the good-side edge — computed in TS from the rows.
- `totalData` = `rolling_n` (Confidence: `≥ 22` → "solid", else "still building"). `dataNights` (settling) = `short_n` or row count. `lastSeen` (nodata) = days since `latest.date`.
- `source` — a metric→source label map: rhr/hrv → Whoop; sys/dia → Withings; fasting/glucose_var/tir → CGM; weight → Withings/manual; **spo2_avg/spo2_min → Oxylink** (new label — the design only had Whoop/Withings/CGM).

**Overall read (`tone`/`title`/`body`):**
- `tone` = `safety` if any breach; else `attention` if any drift/watch/caution in the "Worth a look" tier; else `calm`.
- `title`/`body` = templated plain-language copy off the bucket counts and names, **distinguishing confirmed vs emerging** (e.g. "One thing worth a look, one just starting to move"). Calm example: "Holding steady" / "Nothing's drifting from your normal right now — all N tracked signals are sitting in their usual range." Safety: "Something's dropped below a safe line" (+ name + "worth a call to Dr. Jose"). Keep the design's calm register.

**Honesty rules preserved:** suppressed metrics (`alertsSuppressed`) must not surface in attention tiers — render them per the existing suppressed treatment (or quietly in steady with a "paused" note). Associational language only. Clinical-low precedence: a breach always wins over an improvement.

## Part D — Data-layer window

`app/lib/dashboard/baselines.ts::fetchMetricDrift` currently bounds rows to `~[today − PERSISTENCE_LOOKBACK_DAYS − 1, today]` (≈15 days). The design's band sparkline + "last 4 weeks" / "X of last 14" framing want more history. **Widen this tab's fetch to ~30 days** (a `daysBack` arg, default 30 for the tab). Still bounded — the `metric_drift` view's full-history scan stays paid only on the slice read. No view change.

## Decisions (RESOLVED 2026-06-22)

1. **"Your normal" band width** — `lo/hi = rolling_median ± 2 · rolling_MAD` (**k = 2**).
2. **`watch` tier** — surface in **"Worth a look"** with an "early — not yet confirmed" card tag; counted as *emerging* (not confirmed) in the overall-read copy. (Irfan chose earlier warning over the calmer fold-into-Steady default; the tag preserves honesty about confirmation.)
3. **`caution` (approaching low floor)** — surface in **"Worth a look"** as its own card, phrased "approaching your low line" (distinct lead from drift cards). (Earlier-warning consistent with Decision 2.)
4. **`magWord` z-bands** — `< 1.2` "a little" · `1.2–2.5` "noticeably" · `> 2.5` "well".
5. **Copy** — keep the Claude Design plain-language strings **verbatim** (tweak live later if needed).

## What's NOT in the engine (gaps the mapping layer fills)
All of the following are **presentation-derived in TS** from existing `metric_drift` stats — no new SQL, no engine change: the lo/hi band, dirWord/magWord, pattern counts (total14/concernSideDays/goodSideDays), confidence wording, source labels, tone/title/body. If any of these later deserve to be canonical (e.g. the band), they'd move into the view — but not for v1.

## SpO2 dependency
The SpO2-surfacing slice adds `spo2_avg`/`spo2_min` to `DRIFT_METRICS`. This redesign maps `DRIFT_METRICS` generically, so SpO2 appears automatically once that slice lands — just ensure the source-label map includes Oxylink. Order doesn't strictly matter; if SpO2 ships first, the new tab shows 10 signals, else 8.

## Implementation steps
1. Port the `Baselines & Drift` + `.tabnav` CSS from the decoded HTML into `app/dashboard.css` (re-rooted on `.dark`/`.light`).
2. Add the third tab to `DashboardClient` + header nav; remove `BaselinesDriftPanel` from the Dashboard tab; add `BaselinesTab.tsx` shell.
3. Build `present.ts` — the `DriftVerdict[] + rows → drift` mapping (state remap + derived fields + overall read), honouring Decisions 1–5.
4. Rebuild the panel components (`DriftPanel`, `SignalCard`, `SignalDetail`, `BandSpark`, `SteadyTier`, `MutedTier`) per the decoded structure; wire to `present.ts` output.
5. Widen `fetchMetricDrift` to ~30 days for the tab.
6. Keep `/baselines` forms route; link the footnote to it; preserve an "exclude today" affordance.
7. `npm run build` clean.

## Acceptance criteria
- [ ] Baselines & drift is its own third tab (Dashboard · Correlations · Baselines & drift); removed from the Dashboard tab; tab switch in-place, no re-fetch
- [ ] Overall-read band answers "am I okay?" in one glance with calm/attention/safety tone + plain title/body
- [ ] Tiers render per precedence (safety → worth a look → improvement → steady chips → not-reading-yet); each signal card shows the plain lead, latest + your-normal, the band sparkline, and a "See the numbers" expand with plain-language stats
- [ ] Jargon renamed everywhere in the default view (no z/MAD/"held data-days" surfaced); stats still reachable in plain English on expand
- [ ] Engine untouched — `metric_drift` view, `drift-config` thresholds, and `evaluate.ts` unchanged; mapping is pure TS; only `fetchMetricDrift` window widened; clinical-low precedence + suppression + associational language all preserved
- [ ] Decisions 1–5 implemented as confirmed; SpO2 flows through via the source-label map; `npm run build` clean

---

*End of spec. Decisions 1–5 need Irfan's call before/at build. No code this pass.*
