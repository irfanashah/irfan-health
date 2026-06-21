# Slice 7 — Trend Dashboard: Feature Notes (pre-spec capture)

**Status:** Notes only — not yet a build spec. Captured 2026-06-19 from a Claude Design prototyping session.
**Purpose:** Durable home for the dashboard design ideas (single-source panels + cross-source correlation views) so they survive until Slice 7 is committed and a full build spec is written.
**Promote to spec when:** Slice 7 is chosen over Slice 6. Generate the full spec from this file + the handover roadmap (§7) + the data-model spec, with data queries, component breakdown, and acceptance criteria.
**Related artifacts:**
- `claude-design-prototype-prompt_2026-06-19.md` — full prototype prompt (single-source dashboard) used in Claude Design.
- `claude-design-correlation-followon_2026-06-19.md` — follow-on prompt adding the correlation views.
- The Claude Design output is a throwaway visual mockup, not production code. This file is the build-facing capture.

---

## Data available to the dashboard
All already ingested into the live DB:
- **`health_observations`** (time-series) — Whoop (recovery, HRV, resting HR, strain, sleep hours/performance/stages), Nightscout CGM (`glucose_cgm`), manual weight / fingerstick glucose / symptom / note.
- **`bp_readings`** — Withings + manual BP (systolic, diastolic, pulse).
- Canonical glucose stored in mmol/L; manual symptoms carry optional 1–5 severity + red-flag vocabulary.

---

## Part A — Single-source panels (the baseline dashboard)
Responsive card grid, ordered by cardiac relevance. Global controls: date-range toggle (7d / 30d / 90d) + dark/light theme.

1. **Today at a glance** — KPI row: latest Recovery %, BP (sys/dia), Glucose + trend arrow, Sleep (last night), Resting HR, Weight. Each colour-coded vs healthy range. Source: all.
2. **Cardiac panel (hero)** — BP trend (sys + dia, shaded zones) + Resting HR + HRV trends. Source: Withings BP, Whoop.
3. **Glucose panel** — 24h CGM curve with 3.9–10.0 mmol/L target band; time-in-range donut; latest reading + direction; mmol/L⇄mg/dL toggle. Source: Nightscout.
4. **Recovery & sleep** — Recovery trend, sleep-stages stacked bar (light/deep/REM/awake), strain. Source: Whoop.
5. **Weight trend** — line over range. Source: Withings + manual.
6. **Medication adherence** — daily checklist of the real regimen (Aspirin 100, Brilinta 90 ×2, Crestor 40, Ezetrol 10, Concor 5, Tritace 10, Pantozol 40) + weekly streak. Source: manual (needs an adherence-logging path — see open questions).
7. **Recent activity / symptom log** — reverse-chron timeline of manual entries; red-flag symptoms (chest pain, SOB, chest tightness, dizziness standing/walking) surface a calm, non-blocking cardiologist reminder. Source: manual.
8. **Quick-log entry** — segmented Weight · Glucose · BP · Symptom + always-visible note; optimistic prepend to timeline. (Mirrors the existing `/log` route.)

---

## Part B — Cross-source correlation views ("Connections") — the differentiator
This is the reason the unified platform beats four separate apps. Single-source charts already exist in each device's own app; the value is combining points **across** sources to reveal relationships. Five views:

1. **Correlation Explorer (flagship).** Pick **Metric A** and **Metric B** from any source. Render together: dual-axis time overlay, scatter with fitted trend line + correlation coefficient (r), and a plain-language insight sentence. Default pairing: sleep hours vs next-morning systolic. Preset pairing chips for common combos. Recomputes live on dropdown change.
   - *Build note:* this is a generic engine; views 2–5 are effectively curated presets of it. Worth building the engine once and configuring presets on top.
2. **Cardiac Readiness composite.** One blended daily score (0–100) from recovery %, HRV, resting HR, morning BP, sleep. Prominent trend + large today value; expandable to show which input drives today's score. Requires a defined weighting formula — see open questions.
3. **Sleep → next-day cascade.** Last night's sleep (hours + quality) vs next-morning BP, today's recovery, and fasting/morning glucose. Headline relationships to surface explicitly: **sleep → glucose** and **sleep → BP**.
4. **Activity → recovery pacing (rehab safety).** Strain/activity load vs next-day recovery + resting HR. Framed as a pacing tool — does yesterday's exertion cost recovery? Relevant while cleared for walking only, pre-cardiac-rehab.
5. **Event-annotated glucose timeline.** CGM curve with manual symptoms / notes / meals pinned as markers; red-flag markers stand out.

### Relationships to model (for the prototype's synthetic data; real data will show its own)
Embedded so correlation views show signal, not noise (realistic, noisy — target r ≈ 0.4–0.7):
- Short-sleep nights → next morning: higher BP, lower recovery, lower HRV, higher fasting glucose + more glucose variability. (Central thread.)
- Higher strain days → next day: lower recovery, slightly higher resting HR.
- Higher glucose-variability days → slightly worse sleep that night, lower recovery next day.
- Weight trending down over weeks → BP trending gently down over the same span.

---

## Design tokens (locked)
Dark default + light toggle (no system follow). Neutral base. Accents: teal `#00C896` (good/primary), purple `#9B59B6` (sleep/recovery), amber `#F59E0B` (caution), soft red (concern). Calm over alarming. shadcn `base-nova`, Tailwind v4 (CSS `@theme`), recharts for charts, lucide-react icons.

---

## Open questions (resolve before/while writing the full spec)
1. **Medication adherence has no data source yet.** The panel + the adherence-overlay correlation both assume a way to log doses taken. Needs either a manual adherence-logging feature or it's prototype-only for now. (This is why the med-adherence correlation overlay was *not* included in the five — flagged here instead.)
2. **Cardiac Readiness composite needs a defined formula** — which inputs, what weights, how normalised. Don't ship a black-box score; define it explicitly so it's interpretable and clinically defensible.
3. **"Next-morning" / "fasting glucose" / "today" need precise definitions** against the timestamped data (e.g. morning BP = first reading 05:00–10:00 local; fasting glucose = first CGM reading after the overnight gap). The correlation joins depend on these windows.
4. **Correlation coefficient honesty** — small n over a 7d window produces unstable r. Decide a minimum-points threshold below which the explorer shows the overlay but suppresses/greys the r value and insight sentence.
5. **Query/aggregation layer** — daily roll-ups (one value per metric per day) likely need a materialised view or a server-side aggregation step rather than reading raw rows client-side, especially for CGM volume.

---

## Next step
Irfan to decide Slice 6 (Labs PDF) vs Slice 7 (this). On choosing Slice 7, promote this file into `slice-7-dashboard-spec.md` with data queries, component tree, and acceptance criteria.
