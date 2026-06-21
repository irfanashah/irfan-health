# Baseline & Drift Detection Engine — Concept

*Pre-spec concept for Irfan's health platform. Hand this into the build session to be turned into a slice spec. Reads the existing `daily_metrics` view — no new ingestion, no new adapters.*

---

## The problem it solves

The dashboard today answers one question: *is this value clinically normal?* — measured against fixed population bands in `thresholds.ts`. It does not answer the question the whole platform exists for: *is this normal for me, and am I quietly moving away from my own normal?*

A resting HR of 64 sits comfortably inside the population-normal band even if your stable personal baseline is 56 and you've climbed 8 bpm over a month. The fixed-band layer is blind to that, because 64 never leaves "green." This engine is the personal-baseline complement that sits alongside the fixed bands — it doesn't replace them.

It's the same principle that's run through every lab in this recovery: a number only means something against the right reference, and your reference is *you-when-stable*, not a textbook range. Your in-hospital labs weren't a baseline because they were drawn mid-event. Your post-STEMI wearable weeks aren't a baseline either. The engine is built around getting that reference right.

---

## Core concepts

### A baseline is centre + spread, computed robustly

A baseline for a metric is two numbers: a **centre** (where you typically sit) and a **spread** (how much you normally bounce around day to day). Use the **median** for centre and **MAD** (median absolute deviation) for spread — not the mean and standard deviation.

Reason in plain terms: health data is full of one-off outliers — a bad night, a sick day, a fat-fingered manual entry. Mean and standard deviation let a single outlier drag the baseline around. Median and MAD ignore them. For a system whose entire job is detecting *real* movement, you don't want one anomalous Tuesday redefining your normal.

### The reference window — the load-bearing decision: dual baseline

The baseline must be computed only from *stable* data, and the engine solves this with **two baselines running in parallel**:

- **Rolling baseline** — median/MAD over a trailing window (propose **28 days**), recomputed daily, slides forward with you. Catches recent, developing drift. Excludes any day you've flagged as anomalous (sick, travel, alcohol, big event) through the existing note/symptom path.
- **Anchor baseline** — a *frozen* reference computed once from a known-good stable stretch (e.g. a clean month after you finish cardiac rehab). Never slides. Catches slow chronic drift.

**Why both, and why the anchor matters most:** a rolling window has a boiling-frog failure mode. If you deteriorate slowly enough, the rolling baseline absorbs the deterioration and stops flagging it — last month quietly becomes the new "normal," so a genuine months-long decline goes invisible. The anchor baseline is the fixed yardstick that keeps measuring against *you-at-your-best*. Rolling tells you "something changed recently"; anchor tells you "you're a long way from where you were healthy, even if it crept up gradually." Most naive trackers only do the rolling half — the anchor is the part that makes this an actual early-warning system rather than a moving average with extra steps.

Until enough stable data exists for either baseline, the engine shows an **"establishing"** state — never a fake number. Same honesty discipline as the minimum-`n` rule in the Connections slice.

### Deviation score — one scale for every metric

For any given day, compute how far the value sits from baseline *in units of that metric's own spread*: a robust z-score, `(value − baseline_median) ÷ baseline_MAD`. This puts RHR, HRV, BP, glucose, and weight on one comparable scale, so "two deviations out" means the same *kind* of thing on every metric. A single day at two-plus deviations is an excursion — treat it as noise, not signal.

### Drift vs excursion — the calm-by-design distinction

- **Excursion** — one day far from baseline. One bad night's HRV, one high BP reading. Noise. **Never alarms.**
- **Drift** — a sustained, directional move of your baseline-relative position over time. Each day might look individually normal; the *trend* is the signal. This is exactly the pattern I flagged on your NLR — no single reading was alarming, the direction was the point.

**Detection method for v1** (interpretable, cheap, fits the view): compare a **short baseline** (last 7 days) to the **long baseline** (28-day rolling, and separately the anchor). If the short-window centre has moved beyond a per-metric threshold away from the long centre *and* stayed there for **≥ M days** (propose 5–7), that's confirmed drift. It's a personal short-vs-long comparison — trivial to compute in SQL and trivial to explain to you or to a doctor: *"your 7-day median resting HR is 6 bpm above your 30-day median, and has held there for 9 days."*

**Phase-2 option (note for later, don't build first):** EWMA / CUSUM change-point detection — standard process-control methods, more sensitive to genuinely slow drift, more to tune. Start with short-vs-long; it's honest, shippable, and good enough to learn from.

### Direction awareness

Every metric has a *concerning direction* — RHR up, HRV down, BP up, fasting glucose up, glucose variability up, time-in-range down, recovery down, weight up. A small declarative config (same shape and spirit as `thresholds.ts` / `READINESS_WEIGHTS`) holds, per metric: concerning direction, window lengths, drift threshold, minimum-`n`, and whether *good* drift should be acknowledged.

This last part matters for you specifically: weight trending **down** while you're actively working on it is a win to surface positively, not a warning. The engine should celebrate right-direction movement on your metabolic levers (weight, TIR, glucose variability), not only warn on the wrong-direction ones. That keeps it from becoming a nag — which, during recovery, is both bad design and bad for you.

### Surfacing tiers — never a klaxon

Three calm states:

- **Stable** — within personal variability. Quiet, no callout.
- **Watch** — a drift forming but not yet confirmed (short window moved, fewer than M days). Shown subtly, never as an alert.
- **Drift** — sustained directional move past threshold for ≥ M days. A gentle, specific, *data-only* callout: what moved, by how much, over what window, against which baseline. Optionally a notification (this is where the deferred cron-alerting work plugs in).

**Hard boundary:** this is the *slow* layer. Acute red-flag symptoms keep their separate, already-built path (Slice 3 red flags → seek care). Drift detection must never become the channel for an acute event, and a drift callout must never read as a diagnosis — same guardrail discipline as the red-flag reminder and the Connections "interpretable heuristic, not medical advice" labelling. The engine states *"this moved, here's the data, worth mentioning to Dr. Jose"* — never *"this means something is wrong."*

---

## Two data cadences

The engine must treat cadence as a property of the metric, not assume everything is daily:

- **Daily-cadence metrics** (Whoop, Withings BP, CGM, weight): rolling + anchor windows exactly as above.
- **Episodic metrics** (labs — the deferred Slice 6: NLR, LMR, TG/HDL, non-HDL, LDL, eGFR, ALT): there's no daily window. Drift here is **visit-over-visit trajectory** — compare each new result to your prior results and your post-event trajectory, and flag direction across visits. Same concept (you vs your own history), different clock. This is where the derived ratios we computed finally get a home and a meaning over time.

---

## How it fits the stack

- **Source:** reads the existing `daily_metrics` view. No new ingestion, no new adapters.
- **New computation layer:** a Postgres view or function (`metric_baselines` / `metric_drift`) doing the robust-stat math server-side — consistent with the "aggregation is server-side" decision. Median and MAD are doable in SQL via `percentile_cont`. Exposed through a typed server module mirroring `daily-metrics.ts`.
- **Config:** a per-metric declarative TS constant, same pattern as `thresholds.ts`.
- **Surfacing:** either a dedicated "Baselines & drift" panel, or per-metric drift badges folded into the existing Cardiac / Glucose / Weight panels — plus an optional drift notification.
- **Honesty gates reused:** minimum-`n` "establishing" state, always show the window and `n`, no causal language, and clear labelling of *which* baseline fired (vs 30-day rolling, vs anchor) so it's never ambiguous which yardstick moved.

---

## v1 scope (proposed)

**In:** rolling baseline (median/MAD, 28 days), short-vs-long drift detection, deviation scoring, per-metric direction config, three-tier surfacing — over the daily-cadence metrics: resting HR, HRV, systolic/diastolic BP, fasting glucose, glucose variability, time-in-range, and weight (the moment the Withings weight leg lands).

**Deferred, with sequencing logic:**
- **Anchor baseline** — conceptually the more valuable half, but it can't be populated until you've finished rehab and logged a clean stable month. So build the rolling engine now, design the schema to hold both baselines from day one, and leave the anchor null until you set it. Don't skip designing for it just because it starts empty.
- **EWMA / CUSUM** — phase-2 sensitivity upgrade.
- **Labs-cadence drift** — rides Slice 6.
- **Composite / multi-metric drift** (RHR-up + HRV-down + recovery-down together as one stronger signal) — rides the Connections / Cardiac Readiness work.
- **Notifications** — ride the cron-alerting slice.

---

## Confounders & faith-aware context

Legitimate shifts — illness, travel, alcohol, a brutal work week, and **Ramadan fasting** — will move these metrics without anything being wrong. Two mechanisms handle it:

- **Day-level exclusion:** flagged-anomaly days drop out of baseline computation (reuse the existing note/symptom path).
- **Context periods:** mark a date range (Ramadan, travel, illness) that suppresses drift alerts and/or excludes those days from the baseline. Ramadan specifically will shift glucose, weight, sleep, and HRV patterns in predictable ways — the engine should *expect* that window and stay quiet through it, not scream drift for a month every year.

---

## What it is not

Not diagnostic. Not the acute-alarm path. Not a replacement for cardiac rehab or Dr. Jose. Not population-threshold-based — that's the existing dashboard layer, which stays. The two are complementary and both stay visible, clearly distinguished: **fixed bands** answer *"is this clinically normal at all?"*; **drift** answers *"is this normal for me, and holding?"*

---

## Open decisions for the spec session

1. **Window lengths** — 28-day rolling / 7-day short / M-day persistence. Start with the proposed values; tune after watching real data for a few weeks.
2. **Per-metric drift thresholds** — start deliberately loose to avoid false alarms during recovery, tighten once you've seen what your real variability looks like.
3. **Surfacing location** — dedicated panel vs badges on existing panels.
4. **Anchor selection mechanism** — manual confirm (*"use this month as my reference"*) vs rule-detected stable stretch. Manual is simpler and more honest for v1.
