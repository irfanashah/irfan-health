# Platform Data Inventory & Gap Analysis — v2 (Validated)

**Date:** 2026-06-22
**Supersedes:** `platform-data-inventory-gap-analysis_2026-06-22.md` (first pass — the "available but not pulled" side of that version was unvalidated; this version is verified field-by-field against official API docs).
**What changed:** every source's full data dictionary now comes from deep research of the official API docs (Whoop developer docs, Withings developer docs, Nightscout swagger v1/v3 + xDrip docs) and the Wellue/Viatom export format — not inference. Sources cited per section at the bottom.

## How to read this
- ✅ **Ingested** — a row really lands in our DB today (validated against the adapter code: every `metric_type` literal + `bp_readings` columns).
- ◻️ **Available, not pulled** — the API/file exposes it; we could ingest it with code, no blocker.
- 🚫 **Not extractable** — device captures it but there's no API/file to pull it from (app-only).
- ⬛ **Empty by design / N/A** — field exists in the schema but carries no real data for our specific device, or doesn't apply to us.

**One caveat on the ✅ column:** it's validated against the *code* (the only writer), not a live DB dump. The definitive confirmation is two queries you can run: `SELECT DISTINCT metric_type FROM health_observations;` and `SELECT count(*), 'bp' FROM bp_readings;`. High confidence they match the list below.

---

## A. WHOOP — API v2 (OAuth, cron every 6h)
Wearable: **WHOOP 5.0 MG**. The developer API exposes exactly **six data types**. Full field list below; we currently ingest 9 fields from Recovery + Sleep + Cycle.

### Cycle (`/v2/cycle`) — the WHOOP "day"
| Field | Status | Unit |
|---|---|---|
| `score.strain` | ✅ Ingested (`strain_score`) | 0–21 |
| `score.kilojoule` (day energy) | ◻️ Available | kJ |
| `score.average_heart_rate` | ◻️ Available | bpm |
| `score.max_heart_rate` | ◻️ Available | bpm |
| start / end / timezone_offset / score_state | (metadata, used for attribution) | — |

### Recovery (`/v2/cycle/{id}/recovery`)
| Field | Status | Unit |
|---|---|---|
| `recovery_score` | ✅ Ingested | % |
| `resting_heart_rate` | ✅ Ingested (`heart_rate_resting`) | bpm |
| `hrv_rmssd_milli` | ✅ Ingested (`hrv_rmssd`) | ms |
| `spo2_percentage` | ◻️ **Available, not pulled** (already in the payload we fetch) | % |
| `skin_temp_celsius` | ◻️ **Available, not pulled** (already in the payload) | °C |
| `user_calibrating` | ◻️ Available (data-quality flag) | bool |

### Sleep (`/v2/activity/sleep`)
| Field | Status | Unit |
|---|---|---|
| `sleep_performance_percentage` | ✅ Ingested (`sleep_score`) | % |
| `respiratory_rate` | ✅ Ingested | breaths/min |
| `stage_summary.total_light_sleep_time_milli` | ✅ Ingested (`sleep_duration_light`) | →hrs |
| `stage_summary.total_slow_wave_sleep_time_milli` | ✅ Ingested (`sleep_duration_deep`) | →hrs |
| `stage_summary.total_rem_sleep_time_milli` | ✅ Ingested (`sleep_duration_rem`) | →hrs |
| `stage_summary.total_awake_time_milli` | ✅ Ingested (`sleep_duration_awake`) | →hrs |
| `stage_summary` total/in-bed (→ `sleep_duration_total`) | ✅ Ingested | →hrs |
| `sleep_efficiency_percentage` | ◻️ Available, not pulled | % |
| `sleep_consistency_percentage` | ◻️ Available, not pulled | % |
| `stage_summary.sleep_cycle_count` | ◻️ Available | count |
| `stage_summary.disturbance_count` | ◻️ Available | count |
| `stage_summary.total_in_bed_time_milli` / `total_no_data_time_milli` | ◻️ Available | ms |
| `sleep_needed.{baseline, sleep_debt, recent_strain, recent_nap}_milli` | ◻️ Available | ms |

### Workout (`/v2/activity/workout`) — **nothing ingested**
| Field | Status | Unit |
|---|---|---|
| `score.strain`, `average/max_heart_rate`, `kilojoule`, `percent_recorded`, `distance_meter`, `altitude_gain/change_meter`, `zone_durations.zone_zero…five_milli` | ◻️ Available, not pulled | various |

### User profile + body measurements — **nothing ingested**
| Field | Status | Unit |
|---|---|---|
| `height_meter`, `weight_kilogram` (static profile, not weigh-ins), `max_heart_rate` | ◻️ Available | m / kg / bpm |
| email, first/last name | ◻️ Available (PII, not health) | — |

### 🚫 Not extractable via the WHOOP API (app-only — verified against the API changelog: no BP/ECG endpoint ever added)
- **Blood-pressure estimate (BP Insights, beta)** — MG feature, app-only. The 117/71-with-a-range you see is a calibrated daily *estimate*, not in the API.
- **ECG / irregular-rhythm (AFib)** — MG feature, app-only.
- Also not exposed at all: raw/continuous HR time series, GPS route, step count, blood glucose, Stress Monitor, Healthspan/WHOOP Age, Journal/Behaviors, Women's Hormonal Insights.

---

## B. WITHINGS — API (OAuth, cron every 12h)
We request **only measure types 9/10/11** (BP + pulse) → `bp_readings`. Withings exposes a very large measure table plus Sleep/Heart/Activity APIs. **Note:** which of these you actually get depends on your specific Withings device model (unknown here — flagged). The list below is what the API *can* return; device-gated items marked.

### Measure — Getmeas (the master table; we pull 3 of ~30)
| Type | Metric | Status | Unit |
|---|---|---|---|
| 10 | Systolic BP | ✅ Ingested | mmHg |
| 9 | Diastolic BP | ✅ Ingested | mmHg |
| 11 | Heart pulse (at reading) | ✅ Ingested | bpm |
| 1 | **Weight** | 🛠️ Spec'd (`withings-weight-extension-spec`) | kg |
| 5 / 6 / 8 | Fat-free mass / fat ratio / fat mass | ◻️ Available (body-comp scale) | kg / % / kg |
| 76 / 77 / 88 | Muscle mass / hydration / bone mass | ◻️ Available (body-comp scale) | kg |
| 54 | **SpO2** | ◻️ Available (device-dependent) | % |
| 12 / 71 / 73 | Temperature / body temp / skin temp | ◻️ Available (device-dependent) | °C |
| 119 | Glucose | ◻️ Available | mg/dL |
| 123 | VO₂ max | ◻️ Available (tracker/ScanWatch) | mL/min/kg |
| 130 | AFib result (ECG) | ◻️ Available (ECG device) | class |
| 135 / 136 / 137 / 138 | QRS / PR / QT / QTc intervals | ◻️ Available (ECG device) | ms |
| 139 | AFib result (PPG) | ◻️ Available | class |
| 91 | Pulse wave velocity | ◻️ Available (EU body-comp) | m/s |
| 155 | Vascular age | ◻️ Available (Body Scan/Comp) | years |
| 167–196 | Nerve health, segmental fat/muscle, intra/extracellular water, visceral fat, EDA | ◻️ Available (Body Scan, region-gated) | various |

### Other Withings APIs — **nothing ingested**
- **Sleep API** (Get / Getsummary): sleep stages (awake/light/deep/REM), durations, latency, wakeup count, hr min/avg/max, respiration min/avg/max, **sleep_score**, snoring, breathing-disturbance intensity, and (Sleep Analyzer) **Sleep Apnea Index / AHI**, breathing quality. ◻️ Available, device-gated.
- **Heart API** (List / Get): ECG **raw waveform** (signal array + sampling frequency), AFib classification. ◻️ Available (ECG device).
- **Activity / Workout / Intraday**: steps, distance, elevation, active/soft/moderate/intense durations, calories, hr zones, per-workout `spo2_average`, swim metrics. ◻️ Available (tracker).

> If your BP device is a **BPM Core**, it also records ECG + a digital-stethoscope sound and SpO2 — all ◻️ via the Heart API / meastype 54, none ingested. If it's a plain BPM Connect, BP+pulse is all it produces. **Confirm your model** to know which of the above are real for you vs theoretical.

---

## C. NIGHTSCOUT / Dexcom G7 via xDrip+ (API, static token, cron every 12h)
We read `/api/v1/entries` filtered to `sgv` → `glucose_cgm` (+ `extras{direction, device, noise}`). Important nuance from the research: **the G7 is "native-only"** — it transmits only the factory-calibrated value + trend, no raw — so most of the rich entry schema is **empty by design** for our sensor, not a gap we're missing.

### `entries` (sgv) — what the G7-via-xDrip feed actually carries
| Field | Status | Note |
|---|---|---|
| `sgv` | ✅ Ingested (`glucose_cgm`) | factory-calibrated mg/dL → mmol/L |
| `direction` (trend) | ✅ Ingested (in `extras`) | xDrip-computed, not Dexcom-supplied |
| `device` | ✅ Ingested (in `extras`) | e.g. `xDrip-DexcomG7` |
| `noise` | ✅ Ingested (in `extras`) | nominal `1` for G7 — not meaningful signal quality |
| `date` / `dateString` | ✅ Used | epoch ms / ISO |
| `filtered` / `unfiltered` / `slope` / `intercept` / `rssi` / `scale` | ⬛ **Empty by design** | G7 sends no raw layer; these carry no data |
| `mbg` (manual fingerstick) / `cal` (calibration) | ◻️ Available if entered in xDrip | we get fingerstick via Slice-3 `/log` instead |

### Other Nightscout collections — N/A to our setup
`treatments` (boluses/carbs/site changes), `devicestatus` (pump/loop/uploader battery), `profile`, `food` — these are insulin-pump/Loop concepts. ⬛ N/A (you're not on a pump/closed-loop). The one possibly-useful field: `devicestatus.uploader.battery` (the phone's battery) — relevant only if you build uploader-health monitoring.

> **Conclusion for CGM: we already capture everything meaningful the G7 emits.** The "missing" raw fields are empty for this sensor; there's no real glucose gap here.

---

## D. OXYLINK / ViHealth — file upload (CSV via Google Drive, cron daily)
We parse the CSV and store a nightly **summary** (avg + min) + `extras`. The research surfaced two real untapped layers: the **per-reading time series** (in the CSV, we discard it) and the **PDF-report summary metrics** (ODI, desaturation events, time-below-threshold — *not* in the CSV at all, and the most clinically valuable for a cardiac/sleep-apnea lens).

### ViHealth CSV — per-reading columns
| Column | Status | Note |
|---|---|---|
| `SpO2(%)` → overnight avg | ✅ Ingested (`spo2_overnight_avg`) | computed from the series |
| `SpO2(%)` → overnight min | ✅ Ingested (`spo2_overnight_min`) | computed |
| `Pulse Rate(bpm)` → avg | ✅ Ingested (`extras.pulse_avg_bpm`) | |
| `Motion` → movement events | ✅ Ingested (`extras.movement_events`, count of Motion>0) | |
| Session duration | ✅ Ingested (`extras.session_duration_min`) | |
| **Per-reading SpO2 / pulse / motion time series** (~5,900 pts/night, ~4s) | ◻️ **Parsed then discarded** | the full overnight curve |
| `SpO2 Reminder` / `PR Reminder` (alarm-fired flags) | ◻️ Available, ignored | encoding unverified |

### ViHealth PDF report — summary metrics NOT in the CSV (◻️ available via a different export)
| Metric | Why it matters |
|---|---|
| **ODI 3% / ODI 4%** (Oxygen Desaturation Index — desaturations/hour) | the standard nocturnal-hypoxia / sleep-apnea screen — directly cardiac-relevant post-MI |
| **Drops >3% / >4%, drops per hour** | desaturation event burden |
| **Time below 90% (duration + %)** | hypoxic burden |
| SpO2 distribution (95–100 / 90–94 / <90 bands), pulse distribution | |
| **O2 Score** (Wellue composite) | one-glance overnight quality |
| Avg / min / range SpO2 + pulse | (we already derive avg+min from the CSV) |

> The richest cardiac signal Oxylink can give — **ODI and time-below-90%** — isn't in the CSV we ingest. It's either in the PDF report or computable ourselves from the per-reading series we currently discard. Biggest untapped value across all four devices, for your situation.

### Extraction paths
CSV (current), PDF report (summary metrics), raw binary session file (lossless, OSCAR-format). No consumer API — file export only. (A Viatom enterprise Open API exists but is B2B, not self-serve.)

---

## E. Manual entry (`/log`) — not a device, for completeness
✅ Ingested: weight (kg), fingerstick glucose (mg/dL + mmol/L), manual BP (→`bp_readings`), symptoms (controlled vocab + severity), free-text notes.

---

## F. Cross-device overlap (validated)
| Vital | Can supply it | Ingested from | Authoritative pick |
|---|---|---|---|
| **SpO2** | Oxylink (CSV, overnight), Whoop (API `spo2_percentage`), Withings (meastype 54, device-dependent) | **Oxylink only** | Oxylink (dedicated, full-night). Whoop SpO2 is free to add as corroboration. |
| **Heart rate / pulse** | Whoop (RHR + avg/max via API), Withings (pulse at cuff), Oxylink (overnight avg), Whoop workout HR | Whoop RHR + Withings pulse + Oxylink avg | Different contexts — keep distinct, don't merge. |
| **Sleep** | Whoop (full stages + score via API), Withings Sleep API (stages, AHI — device-gated), Oxylink (session duration only) | Whoop (stages/score) + Oxylink (duration) | Whoop authoritative for architecture. |
| **Respiratory rate** | Whoop (API), Withings Sleep API | Whoop | Single ingested source. |
| **Blood pressure** | Withings cuff (API 9/10), Whoop MG (app-only estimate), manual | Withings + manual | Withings cuff = ground truth. Whoop BP not extractable. |
| **ECG / AFib** | Whoop MG (app-only), Withings (Heart API / meastype 130/139, if ECG device) | None | Withings is the only *potentially* extractable ECG path — depends on device model. |
| **Glucose** | Dexcom G7→Nightscout (continuous), manual fingerstick | Dexcom + manual | CGM = trend, fingerstick = spot. |
| **Weight + body composition** | Withings scale (meastype 1/5/6/8/76/77/88), manual | Manual only (Withings weight spec'd) | Withings once built; body-comp is a free add in the same call. |
| **Skin / body temperature** | Whoop (API `skin_temp_celsius`), Withings (12/71/73) | None | Whoop skin temp is free to add. |
| **VO₂ max / vascular age / PWV** | Withings (123 / 155 / 91, device-gated) | None | Nice-to-have, device-dependent. |

---

## G. Gaps ranked by value-to-effort (validated)
1. **Oxylink ODI + time-below-90% + per-reading curve** — *highest clinical value, untapped.* Nocturnal desaturation index is a real cardiac/sleep-apnea signal for a post-MI patient. Either compute it ourselves from the per-reading series we already parse-then-discard (no new source — just stop throwing the data away), or ingest the PDF-report summaries. This is the single most valuable gap.
2. **Whoop SpO2 + skin temperature** — *near-free.* Already in the recovery payload we fetch; persisting them is ~3 lines each, no new scope. Skin temp is an early-illness/inflammation signal; Whoop SpO2 cross-checks Oxylink.
3. **Withings weight** (spec'd) — then **body composition** (fat/muscle/hydration/bone) rides the *same* `getmeas` call for free (meastypes 5/6/8/76/77/88) — relevant to the "build muscle / lose weight" goal.
4. **Withings SpO2 (54) + VO₂ max (123) + ECG/AFib (130/139/135–138)** — *device-dependent.* Confirm your Withings model first; if it's a BPM Core (or you have a ScanWatch), these unlock a second ECG/AFib + SpO2 path. Real value for AFib awareness post-MI.
5. **Whoop sleep efficiency / consistency / disturbances / sleep-need breakdown** — available, low effort, modest value for sleep-quality trends.
6. **Whoop workouts (strain, HR zones, kJ, distance)** — available; relevant once structured exercise resumes post-rehab.

### 🚫 Blocked — no extraction path (not effort, just unavailable)
- **Whoop MG BP estimate + ECG** — app-only, no API. Only path = manual entry of the daily Whoop BP estimate via `/log`, tagged as an estimate (not a cuff reading). ECG has no numeric home — an event/note at most. Revisit only if WHOOP opens the API.

---

## H. Validation status
- **Ingested column:** validated against the adapter code (every `metric_type` literal repo-wide + `bp_readings` columns + CGM extras). Definitive check pending: the two `SELECT DISTINCT` queries above on the live DB.
- **Available/not-pulled columns:** validated field-by-field against official docs (sources below), June 2026.
- **Open caveats / not fully pinned:**
  1. **Your specific Withings device model is unknown** — it determines which of SpO2/ECG/body-comp/temp are *real for you* vs API-theoretical. Worth confirming the exact model.
  2. **Oxylink `SpO2 Reminder` / `PR Reminder` encoding** — interpreted as alarm-fired flags (consistent community reading); not vendor-documented. `Motion` is a relative magnitude with no published unit.
  3. A few Withings meastype integers (segmental fat-free mass, BMR) couldn't be pinned to an authoritative code — not relevant to anything we'd pull near-term.

## Sources
- WHOOP: [API docs](https://developer.whoop.com/api/) · [Recovery (SpO2/skin temp)](https://developer.whoop.com/docs/developing/user-data/recovery/) · [Sleep](https://developer.whoop.com/docs/developing/user-data/sleep/) · [Cycle](https://developer.whoop.com/docs/developing/user-data/cycle/) · [Workout](https://developer.whoop.com/docs/developing/user-data/workout/) · [Changelog (no BP/ECG endpoint)](https://developer.whoop.com/docs/api-changelog/)
- Withings: [API reference](https://developer.withings.com/api-reference/) · [All available health data](https://developer.withings.com/developer-guide/v3/data-api/all-available-health-data) · [Notification categories](https://developer.withings.com/developer-guide/v3/data-api/notifications/notification-content)
- Nightscout: [v1 swagger](https://github.com/nightscout/cgm-remote-monitor/blob/master/lib/server/swagger.yaml) · [v3 swagger](https://github.com/nightscout/cgm-remote-monitor/blob/master/lib/api3/swagger.yaml) · xDrip: [Native Algorithm](https://navid200.github.io/xDrip/docs/Native-Algorithm.html) · [G7 setup](https://navid200.github.io/xDrip/docs/Dexcom/G7.html)
- Oxylink/Wellue: [ViHealth/O2 Insight FAQs (report metrics)](https://getwellue.com/pages/faqs-vihealth-o2-insight) · [O2Ring spec](https://www.viatomcare.com/smart-ring-pulse-oximeter-o2ring/) · [Wellue/Viatom file format (Apnea Board)](https://www.apneaboard.com/wiki/index.php/Wellue_Viatom_File_Import)

*Validated 2026-06-22 via deep research of official API docs + export-format documentation. Ingested column = code-grounded. Device-model-dependent items flagged.*
