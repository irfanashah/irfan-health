# Cardiac BP Chart Enhancement — Build Spec

**Version:** 1.0
**Date:** 2026-06-25
**Status:** Enhances the Cardiac panel's blood-pressure chart so systolic and diastolic each show their **own clinical range**, grounded in the **ACC/AHA BP categories** (the table Irfan provided) + the existing provisional low-side floors. UI + thresholds only — **no data change** (`sys`/`dia`/`pulse` already in `daily_metrics` + `LatestKpis.bp`).
**Why:** the current chart applies ONE set of zones (`60–120` teal "healthy", `120–130` amber, `130+` red) to the whole y-axis — correct for systolic, **wrong for diastolic** (a diastolic of 95 is Stage-2 high but sits in the green "healthy" band today).

---

## The design (confirmed): combined category status + ONE chart with both ranges
**Two parts in the Cardiac panel's BP area:**

### 1. Combined ACC/AHA category status (readout, above the chart)
Classify the **latest** reading into the official ACC/AHA category using BOTH numbers with the and/or logic, shown as a labelled, colour-coded status + the `sys/dia` value + "as of <date>".

| Category | Rule (ACC/AHA) | Colour |
|---|---|---|
| Normal | sys < 120 **and** dia < 80 | teal |
| Elevated | sys 120–129 **and** dia < 80 | amber (light) |
| Stage 1 HTN | sys 130–139 **or** dia 80–89 | amber |
| Stage 2 HTN | sys ≥ 140 **or** dia ≥ 90 | red |
| Hypertensive crisis | sys > 180 **and/or** dia > 120 | red (intense) |
| **Low** (added) | sys < 90 **or** dia < 60 | amber/low — provisional, pending Dr. Jose |

The category is the higher-severity of the two numbers (the "or" logic). The **Low** state is appended because ACC/AHA only covers high BP and Irfan is beta-blocked — surface hypotension too, using the existing `LOW_FLOORS` (provisional). A reading can't be both; if below a floor → Low, else the ACC/AHA category.

### 2. One trend chart, both lines, per-metric territory bands
Keep systolic + diastolic on **one shared chart** (paired read preserved). Shared y-axis ≈ `[55, 185]`. Render each metric's zone bands **in its own y-territory**, separated by a subtle divider so it's unambiguous:
- **Lower territory (diastolic)** — faint bands at diastolic thresholds: Low < 60 · Normal 60–79 (teal) · Stage 1 80–89 (amber) · Stage 2 90–119 (red) · Crisis ≥ 120. Small axis-edge label "Diastolic".
- **Upper territory (systolic)** — faint bands at systolic thresholds: Low < 90 · Normal 90–119 (teal) · Elevated 120–129 (amber light) · Stage 1 130–139 (amber) · Stage 2 140–179 (red) · Crisis ≥ 180. Label "Systolic".
- A subtle horizontal **divider ~95 mmHg** (faint line) marks the boundary between the diastolic-zone region (below) and the systolic-zone region (above). In practice diastolic lives 60–95 and systolic 100–160, so each line travels through its own correctly-zoned territory; the divider + labels remove ambiguity.
- **Keep it calm:** low band opacity (the existing chart used ~0.05–0.07); the bands are context, not noise. The two lines stay clearly readable (systolic red, diastolic teal — current colours).
- Tooltip per day: systolic, diastolic, pulse, **+ that day's ACC/AHA category**.
- Null-aware (gotcha #34); empty-note when no BP in window (unchanged).

> The chart gives the at-a-glance trend with each line in its own clinically-correct zones; the category readout gives the precise combined classification (which genuinely needs both numbers). Together = the "combination."

## Thresholds — centralise in `thresholds.ts`
- `BP_SYS_BANDS` + `BP_DIA_BANDS`: the ACC/AHA boundary sets above (standard population categories — NOT provisional) for the chart bands.
- `bpCategory(sys, dia)`: returns `{ category: 'normal'|'elevated'|'stage1'|'stage2'|'crisis'|'low', color, label }` implementing the and/or logic + the Low check (via `LOW_FLOORS.sys`/`.dia`, provisional). This becomes the single source of truth; the existing `st.bp` can delegate to it (or be replaced where used).
- Low-side floors stay in `LOW_FLOORS` (provisional, pending Dr. Jose — already flagged with `LOW_FLOOR_PROVISIONAL_NOTE`). The ACC/AHA high-side bands are standard, not provisional — label them as the ACC/AHA classification.

## Implementation
- `thresholds.ts`: add `BP_SYS_BANDS`, `BP_DIA_BANDS`, `bpCategory()`. Note ACC/AHA source; keep `LOW_FLOORS` for the low side.
- `CardiacPanel.tsx`: add the category-status readout (from `latest.bp` via `bpCategory`); replace the single `bands` array on the BP `TrendChart` with the per-metric territory bands + divider + territory labels; extend the tooltip with the per-day category. RHR/HRV chart untouched.
- If `TrendChart` can't express the divider / territory labels with its current `bands` prop, extend it minimally (a `divider`/label option) — custom SVG, no recharts.
- `npm run build` clean.

## Out of scope
- No change to BP data, ingestion, or `daily_metrics`. No drift change. Pulse stays a tooltip line (not its own zoned metric). The Today-at-a-glance BP KPI can optionally adopt the `bpCategory` colour later (not required here).

## Acceptance criteria
- [ ] Category status readout classifies the latest reading per ACC/AHA (both-numbers and/or logic) + the added Low state; colour-coded; shows sys/dia + date
- [ ] One BP chart, both lines, with per-metric ACC/AHA zone bands in their own territories (diastolic lower, systolic upper) + a divider + territory labels; diastolic 95 now reads as Stage-2, not "healthy"
- [ ] Thresholds centralised (`BP_SYS_BANDS`/`BP_DIA_BANDS`/`bpCategory`); ACC/AHA high-side standard, low-side via provisional `LOW_FLOORS`; `st.bp` delegates or is replaced
- [ ] Tooltip shows the day's category; calm low-opacity bands; null-aware; RHR/HRV chart unchanged; `npm run build` clean

---

*End of spec. UI + thresholds only, grounded in the ACC/AHA categories. Low-side stays provisional (Dr. Jose); ACC/AHA high-side is standard.*
