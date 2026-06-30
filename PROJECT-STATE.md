# Project State — Irfan's Health Platform

_Last updated: 2026-06-30 (session: platform alerts & reminders — Resend email primitive + two daily crons (pipeline-health digest + adherence nudge) + /diagnostics health table; resolves the long-standing "cron monitoring" pending item)_
_Authoritative live build record is `CLAUDE.md`. This file is the concise snapshot; Cowork mirrors it into memory. If the two disagree, CLAUDE.md wins._

## Now
**Platform alerts wired up** — Resend email primitive (`lib/email.ts`, no SDK dep) + two daily crons: `/api/cron/health-check` (08:00 GST) emails a digest when any API-pull source (whoop/withings/nightscout) is stale (last `status='success'` row older than per-source threshold ≈ 2–3× cron cadence — provisional); silent when all healthy (no alert fatigue). `/api/cron/adherence-reminder` (13:00 GST) nudges when today's `med_adherence` row is absent/cleared; silent when logged. **No PHI** in any email — source names + timestamps + nudge text only. Missing-key contract: silent no-op + warn, never throws (a missing key must NOT 500 a cron). Bonus: new "Pipeline health" table at the top of `/diagnostics` reuses the same `fetchPipelineHealth()` module. Closes the long-standing "Cron monitoring / alerting" Pending item — the platform now self-detects silent ingestion failures before they bite a Dr. Jose visit. `gstTodayISO` extracted from `app/medications/actions.ts` to `lib/gst.ts` (cron route can't import from a 'use server' file). `npm run build` clean — 32 routes (`/api/cron/health-check` + `/api/cron/adherence-reminder` added).

## Slice ledger
- ✅ Slices 0–5 (sources + ingestion + manual + CGM) · ⊘ 5a Dexcom Clarity (DEFERRED)
- ✅ 7.1 Trend dashboard · ✅ 7.2 Connections · ✅ 7.3 Personal baseline & drift engine · ✅ 7.3R Baselines & drift redesign + tab move
- ✅ SpO2 dashboard surfacing
- ✅ Oxylink desaturation (ODI + time-below-90 + overnight curve + Overnight Oxygen panel + true event markers + Today min-SpO2 tile)
- ✅ Contour fingerstick parser + CGM-trace fingerstick markers
- ✅ Dashboard 7.1 fixes (Whoop wake-day attribution + Glucose fingerstick fallback + KPI sparkline overflow)
- ✅ Whoop SpO2 rename → `spo2_whoop` + skin_temp add
- ✅ Two-fix patch (TrendChart isolated-point dots + TodayAtAGlance glucose fingerstick fallback)
- ✅ Cardiac BP chart — ACC/AHA per-metric zones + combined category readout
- ✅ Slice 6 — Labs PDF import (LLM extraction + human review + Labs section with trends)
- ✅ Labs large-file fix — direct-to-Storage upload + mixed-document prompt
- ✅ Labs marker-system maturation — auto-canonicals + AI-proposed ranges + computed flags + remembered-range store
- ✅ Labs UI split — `/labs` = import tool only; dashboard 4th tab "Labs" = data viz
- ✅ **Doctor record (`/report`) + editable medications list**
- ✅ **Lab markers — clinical-target tracking** (LAB_TARGETS + evaluateLabMarker + Lp(a) reported fallback + report page-1 + Labs tab summary strip & goal lines)
- ✅ **Medication adherence — daily one-tap** (migration_011 + MedAdherencePanel + /medications heat-strip + /report self-reported line; honest two-number math)
- ✅ **Platform alerts & reminders** (Resend email primitive + daily pipeline-health digest cron + daily adherence-nudge cron + /diagnostics pipeline-health table; resolves the "cron monitoring" Pending item)
- → **Withings weight extension** (small follow-on) — NEXT
- ⬜ Anchor population (post-rehab); confirm Dr. Jose floors + ODI severity + skin_temp threshold + lab targets; Slice 8 — Discipline layer; fasting cross-check (Contour vs CGM-derived)

## Data state
Unchanged for existing sources. **New surface area**:
- `lab_panels` + `lab_values` (reserved in migration_001) — populated via `/labs`.
- `lab_marker_aliases` (NEW, migration_008) — learns `raw_marker_name → marker_slug` per (lab, raw_name) on every commit; auto-applies on subsequent uploads.
- `sources('labs')` row seeded.
- **Storage bucket required:** `lab-reports` (private, ~25 MB limit) — created in the Supabase Studio UI, NOT via migration (storage DDL isn't user-writeable in SQL editor).
- `medications` (migration_010) — Irfan's regimen, deactivate-not-delete.
- `med_adherence` (NEW, migration_011) — one row per GST calendar day, tri-state status; populated by the new one-tap panel. Empty until Irfan starts tapping.

## Next action
1. **Set env vars on Vercel** (Project Settings → Environment Variables): `RESEND_API_KEY` (from your Resend dashboard) + `ALERT_EMAIL_TO` (your own email). `ALERT_EMAIL_FROM` is optional — defaults to `onboarding@resend.dev` (Resend test sender; works with zero DNS). No migration this slice.
2. After Vercel deploys, manually fire both crons from your browser console while logged in (or via `curl -H "Authorization: Bearer $CRON_SECRET"`):
   - `GET /api/cron/health-check` → expect JSON `{ok:true, checked:[whoop,withings,nightscout], stale:[…], emailed:true|false}`. With healthy crons, `emailed:false, reason:'all-healthy'` is correct. To force-test the email, temporarily set one of the staleHours thresholds to `0.001` in `pipeline-health.ts`, fire the cron, then revert.
   - `GET /api/cron/adherence-reminder` → if today's `med_adherence` row is missing, expect `emailed:true` + a nudge in your inbox. If you already tapped today, expect `logged:true, emailed:false`.
3. Verify the **Pipeline health** table renders at the top of `/diagnostics` with the three sources, last success in GST, and an "ok" badge on each (assuming all crons are happy).
4. Once green, the next slot is the **Withings weight extension** — extend `adapters/withings/{api,index}.ts` + `app/api/refill/withings/route.ts` (gotcha #25 — they must agree) to request `meastype=1` and write `metric_type='weight'`, canonical `kg`. No new migration. Unblocks the Weight panel, Weight KPI, BP-vs-weight Correlation preset, and the weight drift signal.

## Open items (non-blocking)
- Anchor population — `/baselines` set-anchor form built; populate post-rehab.
- Confirm Dr. Jose low-side floors (BP / SpO2) + ODI severity + skin_temp threshold — provisional.
- Withings weight extension — small follow-on.
- Lab markers as drift metrics (LDL drift etc.) — deferred follow-on, builds on the Labs section.
- Doctor-record export — separate, builds on labs + meds.
- Fasting cross-check (Contour vs CGM-derived) — deferred follow-on.
- Re-mapping UI for lab_marker_aliases — v1 has ON CONFLICT DO NOTHING (first commit wins); a future UI to update aliases would make it possible to fix a mis-mapping after the fact.
- Range-wide meter-vs-sensor view — Glucose panel's CGM trace is fixed 24h.
- xDrip+ ongoing CGM capture — new G7 sensor pending.
- Daily / metric_drift views scan full history per query — future perf item once CGM accrues months.
- ~~No cron failure alerting.~~ — ✅ Daily `/api/cron/health-check` digest emails when any API-pull source is stale. Set `RESEND_API_KEY` + `ALERT_EMAIL_TO` on Vercel to activate. File-drop sources excluded by design (user-action-dependent, staleness is normal there).
- `middleware.ts` → `proxy.ts` rename (Next 16 deprecation warning only).
- Orphan `ingestion_log` rows from timed-out runs — harmless.
- CLAUDE.md cleanup carry-over — "two stale Slice 4 parked lines (~99 + ~251)" — still couldn't locate them.
