# Slice 7.2 — Connections (cross-source correlations + Cardiac Readiness) — Build Spec

**Version:** 1.0
**Date:** 2026-06-19
**Prerequisites:** Slice 7.1 live (dashboard at `/`, `daily_metrics` view, chart primitives ported). Reads the **same `daily_metrics` view** — no new aggregation layer.

---

## Overview

Builds the prototype's **Correlations tab** — the cross-source "Connections" views that are the platform's differentiator (combining sources to reveal relationships, vs. four separate device apps). Port `prototype-src/05-connections.jsx`; the Cardiac Readiness formula is in `prototype-src/02-data-layer.jsx`. The Correlations tab stub in `components/dashboard/Header.tsx` (disabled in 7.1) flips on.

**The key work beyond porting** is making the statistics honest on real, gappy, small-n data — the prototype runs on dense synthetic data and always shows a correlation. This slice adds the guardrails (below). This matters: it's a cardiac patient reading his own data — no spurious correlations dressed as findings, no causal language.

Reads `daily_metrics` over the selected range (7/30/90). No new migration.

## The five views (port from `05-connections.jsx`)

1. **Correlation Explorer (flagship).** Pick Metric A and Metric B from the catalog (any source); render a dual-axis time overlay + a scatter with fitted trend line + an `r` badge + a plain-language insight sentence. Default `sleepHours` vs `sys`; preset chips for common pairings. Recomputes on dropdown change. Same-row pairing (A[day] vs B[day]) — valid because `daily_metrics` already aligns "last night's sleep" with "that morning's BP/recovery" via the `period_end` attribution.
2. **Cardiac Readiness composite.** Blended 0–100 daily score + trend + expandable "what's driving today's score" per-input breakdown. Formula already defined — see below.
3. **Sleep → next-day cascade.** Today's sleep (hours + quality) → that day's morning BP, fasting glucose, recovery, with the headline that sleep's strongest downstream links here are **fasting glucose** and **morning BP**. (A "today" snapshot, not a correlation.)
4. **Activity → recovery pacing (rehab safety).** **Lagged**: pairs `strain[day]` with `recovery[day+1]` and `rhr[day+1]` — "does yesterday's exertion cost tomorrow's recovery?" Keep the 1-day lag (it's intentional and correct; the data relationship is lagged). Framed as a pacing tool with the "cleared for walking only" note.
5. **Event-annotated glucose timeline.** 24h CGM curve with manual **symptoms/notes** pinned as markers; red-flag markers stand out. **Meals dropped — see data gaps.**

## Honesty guardrails (the required addition over the prototype)

Apply to the Correlation Explorer and Activity-pacing `r`:
- **Pair only days where BOTH metrics are non-null.** Real data is gappy (no CGM between stints, missing BP days). Compute `n` = count of valid pairs.
- **Always display `n`** (e.g. "n = 14 days") next to every `r`.
- **Minimum-n threshold = 10 valid paired points.** Below it, still render the overlay + scatter, but **grey out / suppress the `r` badge and the insight sentence** with a small note like "Not enough paired days yet (n = 6) — keep logging." Don't show an `r` value computed from a handful of points.
- **Associational language only — never causal.** Insight sentences describe association ("on days when X was lower, Y averaged…; a moderate inverse link"), not causation. Audit the ported strings — soften any causal phrasing (e.g. the prototype's "Short sleep nudged BP up" → "On shorter-sleep days, morning BP ran higher"). No "causes/leads to/because."
- Over a 7-day range, n will usually be below threshold — that's correct behaviour; the guardrail does its job.

## Cardiac Readiness — formula + framing

Port the formula from `prototype-src/02-data-layer.jsx` exactly:
- **Weights:** Recovery 0.28, HRV 0.20, Morning BP 0.20, Resting HR 0.17, Sleep 0.15.
- **Sub-scores (each normalised 0–100):** recovery (30→86), hrv (26→66), rhr (70→54, inverted), bp (composite of sys 140→110 + dia 90→68, averaged), sleep (5→8.5h). Document these normalisation bounds in code comments — they're the prototype's chosen ranges, tunable later.
- Score = Σ(subScore × weight); the breakdown lists each input's sub-score + whether it's lifting/dragging vs the blended score.

Framing (non-negotiable, given it's a cardiac patient's own score):
- **Label it an interpretable heuristic, not medical advice.** A small caption: "An at-a-glance blend of your recovery signals — not a medical assessment." The red band's "Take it easy" copy stays calm and non-alarming, consistent with the "trends, not alarms" principle.
- **The per-input breakdown is always available** (the expandable) — no black box.
- **Missing-input handling:** only compute the score for days where **all five inputs are present**; show a gap (no point) on days missing an input rather than renormalising weights (renormalising would silently change what the score means). The "today" value shows "—" if today lacks an input.

## Data gaps (flag — same pattern as med-adherence in 7.1)

- **Meals have no data source.** The prototype's annotated-glucose meal markers come from synthetic `CD.meals`. There is no meal-logging path. So the **Event-annotated glucose view ships with symptom/note markers only** (these are real, from manual entries). Meals are deferred — they'd need a meal-logging feature (future small slice, like med-adherence/dose-logging). Don't fake meal markers.
- **Red-flag reminder:** reuse Slice 3's `RED_FLAG_REMINDER` constant (single source of truth) for the annotated-glucose red-flag banner — don't hardcode the prototype's wording.

## Real-data wiring

- **Metric catalog → `daily_metrics` columns:** map each catalog accessor to a column — `sleepHours→sleep_total`, `sleepQuality→sleep_performance`, `recovery`, `hrv`, `rhr`, `strain`, `sys`, `dia`, `pulse`, `fasting`, `tir`, `weight` (optionally add `glucose_var`). All exist in the view.
- **Explorer** operates over the selected range's `daily_metrics` rows (reuse 7.1's data module).
- **Annotated glucose** reuses 7.1's raw last-24h CGM query + a query for manual symptom/note entries (timestamps within the CGM window) from the Slice 3 `fetch-recent` pattern.
- Charts: port `ScatterChart`, `DualAxisChart`, `pearson` from `prototype-src/06-charts.jsx` (already partly ported in 7.1; bring the rest). No recharts.

## Decisions (resolved)

- Same-row pairing for the explorer; **1-day lag for Activity→recovery** (intentional).
- Honesty guardrails as above (min-n 10, show n, grey r below threshold, associational language).
- Readiness = the documented weighted heuristic, breakdown always visible, computed only when all 5 inputs present, labelled not-medical-advice.
- Meals deferred (no source); annotated glucose = symptoms/notes only.
- Reuse Slice 3 `RED_FLAG_REMINDER`.

## Out of scope

- Meal logging; medication-adherence; doctor-record export; Slice 6 (Labs PDF); Slice 4 (Oxylink, parked).
- No changes to `daily_metrics` (7.2 is read-only over it).

## Implementation steps

1. Bring over remaining chart primitives (`ScatterChart`, `DualAxisChart`, `pearson`) from `06-charts.jsx`.
2. Port the five views from `05-connections.jsx`, wired to `daily_metrics` (metric catalog → columns).
3. Add the honesty layer: non-null pairing, `n` display, min-n suppression, associational insight phrasing.
4. Port the Cardiac Readiness formula from `02-data-layer.jsx`; add the heuristic caption + missing-input handling.
5. Annotated glucose: real 24h CGM + manual symptom/note markers (no meals); reuse `RED_FLAG_REMINDER`.
6. Flip the Correlations tab on in `components/dashboard/Header.tsx`.
7. `npm run build` clean.
8. (MANUAL — Irfan) Deploy; eyeball each view on real data; sanity-check an `r` and the readiness breakdown.

## Acceptance criteria

- [ ] Correlations tab renders the 5 views from **real** `daily_metrics` data (no synthetic data)
- [ ] Explorer pairs only non-null days; shows `n`; suppresses/greys `r` + insight when n < 10
- [ ] Insight sentences are associational, never causal
- [ ] Activity→recovery uses the 1-day lag; shows `n`/guardrail too
- [ ] Cardiac Readiness uses the documented weights; breakdown always available; labelled an interpretable heuristic; days missing an input show a gap, not a renormalised score
- [ ] Annotated glucose shows real CGM + symptom/note markers (no meal markers); red-flag uses Slice 3 `RED_FLAG_REMINDER`
- [ ] No recharts; reads `daily_metrics` only (no new migration); `npm run build` clean

---

*End of Slice 7.2 spec. After this, the dashboard (single-source + cross-source) is complete. Remaining roadmap: Slice 6 (Labs PDF), medication-adherence + meal logging (need data-entry paths), doctor-record export, Slice 4 (Oxylink, parked).*
