# Slice 7.3 — Personal Baseline & Drift Detection Engine — Build Spec

**Version:** 1.0
**Date:** 2026-06-21
**Prerequisites:** Slice 7.1 live (`daily_metrics` view + `app/lib/dashboard/daily-metrics.ts` + dashboard surface). Reuses Slice 7.2's shipped honesty helpers (`components/dashboard/connections/{insight.ts, readiness.ts}`, the `pearson`/`pairedNonNull` stats module). **No new ingestion, no new adapters** — reads `daily_metrics`.
**Source of truth:** `baseline-drift-engine-concept_v1_2026-06-21.md` + the six design decisions resolved in the spec session (locked below).
**Build dependency:** v1 depends only on 7.1 (shipped). Independent of 7.2's build (reuses its honesty patterns, now in-tree). Only the **deferred** composite/multi-metric drift extends 7.2's `readiness.ts`. Build order vs other slices: TBD.

---

## Overview

The dashboard's fixed-band layer (`thresholds.ts`) answers *"is this value clinically normal?"* This slice adds the complement the platform exists for: *"is this normal **for me**, and am I quietly drifting from my own normal?"* A resting HR of 64 sits green on the population band even if your stable personal baseline is 56 and you've climbed 8 bpm over a month. The two layers are complementary and both stay visible, clearly distinguished.

It is **not** diagnostic, **not** the acute path, **not** a population-threshold layer. It is the *slow* layer; acute red-flag symptoms keep their separate Slice 3 path. A drift callout states *"this moved, here's the data, worth mentioning to Dr. Jose"* — never *"something is wrong."*

---

## Core model

**Dual baseline (the load-bearing decision — do not collapse to one rolling average):**
- **Rolling baseline** — median + MAD over a trailing window, recomputed daily, slides forward. Catches recent developing drift.
- **Anchor baseline** — a *frozen* snapshot from a known-good stable stretch (a clean post-rehab month). Never slides. Catches slow chronic drift the rolling window's boiling-frog failure mode would otherwise absorb. **Schema holds it from day one; it stays null until manually set** (months out, post-rehab).

**Robust statistics** — **median** (centre) + **MAD** (spread), never mean+SD: one anomalous day must not redefine normal. Computed server-side in SQL via `percentile_cont` (MAD = `median(|value − median|)`, a two-pass aggregate), consistent with the "aggregation is server-side" decision.

**Deviation score** — robust z = `(value − baseline_median) ÷ baseline_MAD`, putting every metric on one comparable scale. A single day at ≥2 deviations is an **excursion** — noise, never alarms.

**Drift vs excursion** — drift is a *sustained, directional* move of the baseline-relative position, not one bad day.

**Windows (Decision 1 — all per-metric-overridable defaults):**
- Rolling/z-score reference: **28 days**.
- Short window: **7 days**.
- Long reference for the drift comparison is **disjoint** from the short: compare the **last 7 days** against the **prior 21 days** (clean "recent vs prior 3 weeks"), so recent drift doesn't dilute the reference it's measured against. The full 28-day window is used only as the per-day z-score reference.
- Persistence: drift is confirmed only if the gate is held **≥ M = 7 days**.
- **Min-n is counted on data-days, not calendar-days** (BP/CGM/weight aren't daily). Numbers are per-metric (below).

**Three data-sufficiency states + recency guard (Decision 1 addition):**
| State | Condition | Behaviour |
|---|---|---|
| `no-recent-data` | short window empty | say nothing — never fabricate a baseline |
| `establishing` | below min-n in recent and/or prior window | show "establishing", no drift verdict |
| `active` | enough data-days in **both** the recent (7d) **and** prior (21d) windows **and** the short window has recent data | drift detection runs |

**Recency guard:** `active` requires fresh data in the short window — never compare a fresh week against a stale block and call the difference drift. (Critical for CGM, which is episodic — fasting/glucose-var/TIR will sit `establishing`/`no-recent-data` between stints; that's correct, not a bug.)

---

## The computation layer (the real work)

### `migration_004` — new schema

1. **Anchor (frozen snapshots, header + lines, never deleted):**
   - `anchor_sets` — `id, source_start, source_end, set_at, active (bool), note`. One row per time you set/supersede an anchor. **Supersede, don't overwrite:** new set inserted `active=true`, prior set flipped `active=false` (kept for history — matches the never-delete rule).
   - `anchor_baseline_stats` — `anchor_set_id, metric, median, mad, n`. The **frozen** per-metric snapshot computed at set-time. Drift reads the active set's stats directly (never recomputes on read). Partial anchors are valid — only metrics with enough data-days in the source window get a row.
2. **`context_periods`** — `id, start_date, end_date, type (ramadan | travel | illness | other | anomaly), suppress_alerts (bool), exclude_from_baseline (bool), note, active, created_at`. Unifies multi-day context **and** single-day exclusions (start = end). Multi-day periods entered via the context form default **both flags true**. The single-day **"exclude today"** quick action writes `type='anomaly', exclude_from_baseline=true, suppress_alerts=false` **explicitly** (does **not** inherit both-default-true).
3. **`med_changes`** — `id, change_date, label (e.g. "bisoprolol 5→2.5mg"), affected_metrics (text[]), note, active, created_at`. **Metric-scoped.** For each affected metric, the rolling baseline uses only data **on/after `change_date`** (hard window-start reset). Entry preset **"BP/HR meds → {rhr, sys, dia}"**. **Never touches the frozen anchor**; instead surfaces a *prompt* to re-anchor. Affected metrics legitimately revert to `establishing` until enough post-change data accrues — **intended behaviour, stated as such in the UI**.

### `metric_baselines` / `metric_drift` — view or function

Server-side robust-stat computation, exposed through a typed module mirroring `daily-metrics.ts` (propose `app/lib/dashboard/baselines.ts`). Approach:
- **Unpivot `daily_metrics`** into long form `(date, metric, value)` for the 8 v1 metrics, so per-metric window stats are uniform.
- Apply **exclusions** (anti-join `context_periods` where `exclude_from_baseline` and active, covering the date) and **med-change window-start resets** per metric before computing stats.
- Compute, per metric: `rolling_{median,mad,n}` (28d), `short_{median,n}` (7d), `prior_{median,mad,n}` (disjoint 21d), the latest value + its z vs rolling, the effective window start (post med-change), and join the active **anchor** stats.
- MAD via `percentile_cont(0.5)` over `|value − window_median|` (two-pass CTE).
- **The view computes the stats; the threshold gate, direction, tiers, persistence, and callouts live in the TS layer** (where the per-metric config sits) — the same SQL-stats / TS-interpretation split as 7.1/7.2.
- **Persistence (≥M days):** the view exposes a per-day drift-flag series (was the gate met for the short window ending that day?) over the trailing window; the TS layer confirms ≥M consecutive. (This is the most intricate piece — recommend the view emit the per-day flags and TS do the run-length check.)

---

## Per-metric config (Decision 2)

A declarative TS constant in the `thresholds.ts` / `READINESS_WEIGHTS` mould (propose `components/dashboard/drift-config.ts`): per metric — concerning direction, acknowledge-good-drift, **absolute floor**, **z-floor (MAD units)**, **min-n (short / prior data-days)**, and window overrides.

**Threshold model: hybrid abs+z AND-gate.** Drift fires only when the short-vs-prior centre shift clears **BOTH** the absolute clinical floor **AND** the z-floor — abs alone over-fires on noisy metrics (HRV), z alone over-fires on low-variance metrics (weight). **Conservative for v1, biased toward silence**; every number is a loose starting default flagged for tuning once real variability is visible.

| Metric | Concerning dir | Ack good drift | Abs floor (Δ short vs prior median) | z-floor (MAD) | min-n short / prior |
|---|---|---|---|---|---|
| Resting HR | ↑ | yes (↓ win) | ≥ 4 bpm | ≥ 0.8 | 5 / 12 |
| HRV (rmssd) | ↓ | yes (↑ win) | ≥ 6 ms | ≥ 1.0 | 5 / 12 |
| Systolic BP | ↑ | yes (↓ win) | ≥ 6 mmHg | ≥ 0.8 | 3 / 8 |
| Diastolic BP | ↑ | yes (↓ win) | ≥ 4 mmHg | ≥ 0.8 | 3 / 8 |
| Fasting glucose | ↑ | yes (↓ win) | ≥ 0.6 mmol/L | ≥ 0.8 | 3 / 7 |
| Glucose variability | ↑ | yes (↓ win) | ≥ 0.4 mmol/L | ≥ 0.8 | 3 / 7 |
| Time-in-range | ↓ | yes (↑ win) | ≥ 8 pts | ≥ 0.8 | 3 / 7 |
| Weight | ↑ | yes (↓ win) | ≥ 1.2 kg | ≥ 1.0 | 4 / 10 |

HRV/weight carry the higher z-floor (HRV noisy; weight low-variance). Weight stays `establishing` until the Withings weight leg lands and weigh-ins hit ~5-of-7 days — expected. All values tunable in config.

---

## Direction, good drift & the clinical-precedence guardrail

Every metric has a concerning direction and a **good** direction. Right-direction sustained moves are surfaced as a **positive "win"** (a fourth, teal flavour alongside the three tiers), not silence and not a warning — the engine celebrates progress on metabolic levers (weight, TIR, glucose variability) and recovery levers, so it doesn't become a nag during recovery.

**Hard clinical guardrail (Decision 2):** good-drift "win" framing is **purely additive and can never suppress or soften a fixed clinical-band warning.** On bisoprolol + ramipril, RHR/BP trending down is a win only within range — past it, it's bradycardia / hypotension, and dizziness-on-standing is a discharge emergency sign. A win callout and a fixed-band **low** warning must be able to surface **simultaneously, with the clinical warning taking precedence.**

**Low-side fixed floors (Decision 3 — in scope here):** the precedence rule has nothing to fire today because `thresholds.ts` only has high-side bands. This slice **extends the fixed-band layer with low-side clinical floors** — a RHR bradycardia floor and a BP hypotension floor. These are **individualised and provisional**: Irfan is deliberately beta-blocked and runs low, so the textbook "<60 = bradycardia" is wrong for him. Ship **conservative placeholders in config** (e.g. systolic < 90 hypotension; RHR low-floor as a labelled placeholder), explicitly marked **provisional, pending confirmation with Dr. Jose — never hardcoded as settled.** Dizziness-on-standing remains on the Slice 3 red-flag → seek-care path.

---

## Confounders & context (Decision 6)

- **Day-level exclusion** — the **"exclude today"** quick action in the panel writes a 1-day `context_periods` row (`type='anomaly'`, `exclude_from_baseline=true`, `suppress_alerts=false`). Explicit and deliberate — **never a side-effect of logging a symptom.**
- **Context periods** — the form marks a date range (Ramadan / travel / illness / other) with independent `suppress_alerts` + `exclude_from_baseline` flags, both defaulting true for multi-day entries. Ramadan specifically will shift glucose/weight/sleep/HRV for a month — the engine should expect that window and stay quiet, not scream drift every year.
- **Med changes** — metric-scoped rolling reset as above; prompts re-anchor; affected metrics go `establishing` post-change (intended).
- **Interactions (state explicitly):** excluded days drop from data-day counts → more `establishing` (honest); `suppress_alerts` hides the Watch/Drift/win *callouts* during a period but the panel still shows the true state with a **"suppressed — Ramadan"** label (never silently fakes "stable"); med-change reset re-opens `establishing`.

---

## Anchor mechanism (Decision 4)

- **Manual confirm only** (rule-assisted candidate suggestion is a phase-2 nicety; auto-set never). The anchor is a clinical judgment — only Irfan + Dr. Jose know when "post-rehab, meds settled, healthy normal" is true.
- **Set-anchor form (built in v1)** in the Baselines & Drift panel: pick a window → **preview the computed per-metric median/MAD/n** (reusing this slice's own stat logic) → confirm → **freeze** the snapshot into `anchor_baseline_stats` + an `anchor_sets` row, storing the **source window dates as provenance** alongside the frozen stats.
- **Comparison:** when an active anchor exists, drift checks short-vs-anchor in addition to short-vs-rolling; the callout **labels which baseline fired** (vs 28-day rolling, vs anchor) — never ambiguous which yardstick moved.
- Until set: **"Anchor not set — establishing your post-rehab reference."** Stays null for months by design.

---

## Surfacing (Decision 3)

- **A dedicated "Baselines & Drift" panel**, placed prominently on the **Dashboard tab right after Today-at-a-glance** (not a separate tab — the early-warning layer shouldn't be hidden, and it keeps fixed-band + drift visible together). Built in `components/dashboard/panels/`, wired into `DashboardClient.tsx`.
- **Compact by default** — one calm row per metric showing its state (`no-recent-data` / `establishing` / stable / watch / drift / win) + a one-line **data-only callout** for anything not stable; **per-metric expand** for detail (short vs prior numbers, window, n, which baseline).
- **Three tiers + win:** Stable (quiet, no callout) · Watch (forming, < M days, subtle, never an alert) · Drift (sustained ≥ M days, gentle specific data-only callout) · Win (sustained good-direction move, positive). Calm palette (teal/amber/red), calm-by-design.
- **Callout content:** what moved, how much, over what window, against which baseline — **no causal language** (reuse 7.2's associational discipline). Always show the window + n.
- **Hard acute boundary, reused 7.2 labelling:** the panel carries the "interpretable signal, not a diagnosis / not the acute path" framing; a drift callout reads *"worth mentioning to Dr. Jose,"* never *"something is wrong."*
- **Contextual drift badges on the existing Cardiac / Glucose / Weight panels — deferred to a fast-follow** (not v1).

---

## Two cadences

- **Daily-cadence (v1):** RHR, HRV, systolic BP, diastolic BP, fasting glucose, glucose variability, TIR, weight — rolling + anchor windows as above.
- **Episodic labs (deferred, rides Slice 6):** no daily window — drift is **visit-over-visit trajectory** (each result vs prior results + post-event trajectory). Cadence is a **property of the metric, not a global assumption** — design the config/types to carry a cadence field from day one; build only daily-cadence now.

---

## Decisions (resolved — the six)

1. **Windows:** 28 / 7 / M=7, per-metric-overridable; long reference disjoint (last 7 vs prior 21); 28d only for z-reference; min-n on data-days; CGM accepted as often-idle; three sufficiency states + recency guard.
2. **Thresholds:** hybrid abs+z AND-gate, conservative/loose for v1; direction + acknowledge-good for all eight; good-drift never suppresses a clinical warning (precedence).
3. **Surfacing:** dedicated panel on the Dashboard tab, compact + expand; badges deferred; low-side clinical floors added (individualised, provisional, pending Dr. Jose).
4. **Anchor:** manual; freeze snapshot + provenance dates; supersede-not-overwrite (`active` flag); re-anchorable; set-form with preview built in v1; stays null until set.
5. **Slice 7.3**, `slice-7.3-baseline-drift-spec.md`, `migration_004`, after 7.2 by family; v1 buildable independently.
6. **Context surface:** day-exclusion unified into `context_periods` (1-day `anomaly` type, explicit flags); two independent context flags default-true for multi-day; `med_changes` separate, metric-scoped rolling-reset, never touches anchor, prompts re-anchor.

## Out of scope / deferred (design-for, don't build)

- Anchor *population* (form built; you populate post-rehab).
- EWMA / CUSUM change-point detection (phase-2 sensitivity upgrade).
- Labs-cadence (visit-over-visit) drift — rides Slice 6.
- Composite / multi-metric drift (RHR↑ + HRV↓ + recovery↓ as one signal) — extends 7.2 `readiness.ts`.
- Notifications — ride the cron-alerting slice.
- Contextual drift badges on existing panels — fast-follow.
- Rule-assisted anchor suggestion — phase-2.

---

## Implementation steps

1. **`migration_004`** — `anchor_sets` + `anchor_baseline_stats`, `context_periods`, `med_changes`; the `metric_baselines`/`metric_drift` view-or-function (unpivot → exclusions + med-resets → robust median/MAD/n per window + anchor join + per-day drift-flag series). Verify the stats against a hand spot-check for a couple of metrics/days.
2. **`app/lib/dashboard/baselines.ts`** — typed module mirroring `daily-metrics.ts`; numeric coercion (gotcha #8); service client.
3. **`components/dashboard/drift-config.ts`** — the per-metric config (table above) + the provisional low-side clinical floors; `thresholds.ts` extended with the low-side bands.
4. **Drift/tier logic (TS)** — hybrid abs+z gate, ≥M persistence, three states + recency guard, direction/win, clinical-precedence layering, baseline-label.
5. **"Baselines & Drift" panel** — compact rows + expand, calm tiers + win, data-only callouts, honesty gates, acute-boundary labelling; wired into `DashboardClient.tsx` after Today-at-a-glance.
6. **Context + med-change + anchor entry** — "exclude today" quick action; context-period form; med-change form (with the BP/HR preset); set-anchor form with live preview → freeze.
7. `npm run build` clean.
8. (MANUAL — Irfan) Apply `migration_004` on Supabase; deploy; eyeball states on real data (RHR/HRV active; CGM/weight establishing as expected).

## Acceptance criteria

- [ ] Baselines computed in SQL (median + MAD via `percentile_cont`) over data-days; rolling 28d + disjoint short/prior; exposed via the typed module
- [ ] Drift fires only on the hybrid abs+z AND-gate held ≥ M days; single-day excursions never alarm
- [ ] Three sufficiency states + recency guard behave correctly; CGM/weight read `establishing`/`no-recent-data` between data, never a faked baseline
- [ ] Per-metric config drives direction, floors, min-n; good-direction sustained moves surface as a positive win
- [ ] Good-drift win never suppresses a fixed clinical-band warning; low-side floors present, provisional, labelled pending Dr. Jose; both can co-surface with clinical precedence
- [ ] Dual baseline: rolling live; anchor schema present, null until set; set-anchor form previews then **freezes** snapshot + provenance; supersede keeps history (`active` flag), never deletes; callouts label which baseline fired
- [ ] `context_periods` (incl. 1-day `anomaly` "exclude today") and `med_changes` (metric-scoped rolling reset, anchor untouched, re-anchor prompt) work; suppression shows "suppressed — <type>", never silent fake-stable
- [ ] Dedicated panel on the Dashboard tab, compact + per-metric expand; data-only callouts, no causal language; always show window + n + baseline; acute-boundary labelling present
- [ ] Reads `daily_metrics` only for metric values; no new ingestion/adapters; `npm run build` clean

---

*End of Slice 7.3 spec. Deferred extensions (EWMA/CUSUM, labs-cadence drift, composite drift, notifications, badges, anchor population) are sequenced above. No code this pass — awaiting approval.*
