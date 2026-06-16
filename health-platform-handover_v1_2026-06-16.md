# Personal Health Data Platform — Project Handover

**Owner:** Irfan Ali Shah
**Prepared:** 2026-06-16
**Purpose of this document:** Carry every decision, constraint, and piece of context from the scoping conversation into the new Claude Cowork project so the build starts fully informed. Read this in full before proposing anything.

---

## 1. What we are building

A single, self-owned system that aggregates Irfan's health data from many sources into one normalised store, and presents it back as trends and records. It is a personal, single-user platform — not a product, not multi-tenant (at least not now).

It exists because Irfan is recovering from a cardiac event and wants one coherent view of the signals that matter, rather than data scattered across a dozen device apps.

## 2. What the system is for (in priority order)

1. **Doctor record** — clean, organised data to bring to cardiology appointments (Dr. Fekry and any second opinions).
2. **Trend dashboard** — a living view Irfan checks himself to spot drift in his own metrics.
3. **Discipline tool** — wired into his recovery routine to support consistency.
4. **Early-warning** — *deferred to the very last phase*, and deliberately scoped down.

### The early-warning boundary (hard rule)

The first three purposes are low-stakes: a missing data point harms nothing. The fourth is different in kind and must be built last and built narrow.

- This system is **not** a cardiac safety net. Consumer devices are not reliable enough for that, and the real danger is false reassurance — "my numbers looked fine" on a day something is actually wrong.
- Irfan's actual early-warning system is symptom-based and already defined: chest pain, breathlessness, chest tightness, or dizziness on standing/walking → hospital.
- The data system's early-warning role is limited to flagging **slow drift over days and weeks** — BP creeping up, weight climbing, resting HR shifting on the beta blocker. **Trends, not alarms.** No pretence of catching acute events.

## 3. Stack and architecture decisions (locked)

- **Build approach:** custom build, not an off-the-shelf aggregator. Irfan chose to own it.
- **Stack:** Supabase + Vercel — the stack he already knows from Seamlify People and Seamlify Ops. Easy for him to learn and manage.
- **Database:** a **dedicated Supabase project**, fully isolated from the Seamlify databases. This is personal PHI and has nothing to do with Seamlify. Do not co-locate.
- **Users:** single-user (Irfan only).
- **Security:** treat all of it as PHI — isolated store, encryption, tight access control. Health data does not go anywhere near the shared Seamlify Supabase DB.
- **Core design principle — normalised common schema:** every source maps into one coherent data model. Sources must be **pluggable adapters**, not hardcoded. This is what de-risks the wearable decision below.

## 4. Data sources and how data gets out of each

The hard part of this project is data egress, not the dashboard. Below is the locked source list and the extraction path for each. Everything is locked **except the wearable**, which is a deliberate November 2026 decision.

| Signal | Device | Egress path | Status |
|---|---|---|---|
| Recovery / strain / sleep / HRV / resting HR | **Whoop** (now) | Whoop developer API (OAuth2, free) + CSV export | Build first; keep until 6 Dec 2026 |
| Blood pressure + HR | **Withings cuff** | Withings Health API (OAuth2) | Clean, automatable |
| CGM (glucose) | **Dexcom or Libre**, via **Nightscout** | Self-hosted Nightscout ingests the sensor (Dexcom Share bridge / xDrip+/Juggluco for Libre) and exposes a REST API | Episodic — Irfan wears CGM in stints, not continuously |
| Fingerstick glucose | **Contour** (owned) or an Apple-Health Bluetooth meter | **Tidepool** (85+ devices, incl. several Contour Next meters) or a meter whose app writes to Apple Health | Manufacturer APIs are gated — use the open hub |
| Overnight SpO2 | **Wellue Oxylink** (owned) | Syncs to Apple Health (auto, on iPhone) + ViHealth/O2 Insight Pro CSV export | Owned; see resolution caveat below |
| Weight | **Xiaomi / Zepp Life scale** | Closed ecosystem → **manual entry** | A Withings scale would later unify weight onto the Withings API |
| Labs / blood work | Hospital reports | PDF → structured import | Episodic |

### Source notes worth keeping

- **Whoop** is the cleanest wearable API of the candidates and Irfan owns it on a paid Life membership through 6 Dec 2026 — so it is the first wearable adapter to build, and the platform stays useful regardless of the November decision.
- **Dexcom's** official partner API is the wrong path for an individual: polling only, no webhooks, ~3-hour delay *outside the US*, and an approval programme built for companies. Nightscout sidesteps all of it and is CGM-agnostic.
- **Google Fit is dead** — deprecated, end of service late 2026, no new developer access since May 2024. Do not build on it. On Android the modern equivalent is Health Connect (on-device only).
- **Oxylink resolution caveat:** by Viatom's own description the Oxylink logs to the app at ~1-minute intervals, versus 4-second on the O2Ring/SleepU. Fine for overnight average and lows; not precise enough for serious apnea metrics. If overnight data shows a worrying pattern, that is a sleep-study conversation, not a job to push the gadget into. (Irfan raised snoring as the reason for SpO2 tracking; obstructive sleep apnea is worth a proper medical look given his cardiac history.)

## 5. The wearable decision (the one open fork)

Deferred to **November 2026**. Irfan keeps Whoop until 6 Dec 2026 (paid membership) and will choose between **Oura Ring** and the **Google Fitbit Air** once the Air and the new Google Health API are better documented.

State of the comparison as of June 2026:
- **Oura:** clean V2 API, OAuth2 with long-lived personal tokens, webhooks ~30s after sync; exposes sleep, HRV, resting HR, respiratory rate, temperature, nightly SpO2. Pricier ring + ongoing membership (API data stops if membership lapses). Mature platform.
- **Fitbit Air:** ~$100, strong sensor set including **AFib detection**, no mandatory subscription for the raw Base-tier metrics. Data comes out via the new **Google Health API** (modern, auto-subscribing webhooks, reconciled multi-source stream; easy first call via codelabs). Two caveats: restricted scopes need verification *if taken to production for other users* (fine for single-user personal use), and it requires a **personal Google account, not the Seamlify Workspace one**. Brand-new platform, still filling in data types.

Because the wearable is a pluggable adapter, this decision is a one-connector swap later, not a re-architecture. Do not block the build on it.

## 6. Metric priorities and clinical rationale

These metrics matter because of Irfan's specific cardiac picture. The schema and dashboard should foreground them.

- **Blood pressure** — known hypertension (~10 years); on Concor (bisoprolol) and Tritace (ramipril).
- **Resting heart rate** — interpret in the context of beta-blocker therapy (Concor).
- **HRV and sleep** — recovery signals.
- **Lipids / labs** — mixed hyperlipidemia and elevated Lipoprotein(a); on Crestor 40mg (rosuvastatin) and Ezetrol (ezetimibe). Tracks statin/ezetimibe response over time.
- **Weight** — metabolic risk.
- **Glucose** — CGM stints + fingersticks; cardiovascular risk relevance.
- **Overnight SpO2** — snoring / possible OSA.

### Clinical context (load-bearing for design)

- STEMI on 28 Apr 2026 (100% occlusion of left circumflex / OM1; drug-eluting stent at Fakeeh University Hospital). Elective balloon angioplasty of the LAD on 13 May 2026. Both procedures successful.
- Current meds: Concor 5mg, Crestor 40mg, Brilinta 90mg (twice daily), Ezetrol 10mg, Tritace 10mg, Aspirin Protect 100mg, Pantozol 40mg.
- Activity cleared and walking resumed; structured exercise pending cardiac rehab and a second opinion. Cardiologist: Dr. Fekry Eldeeb.
- **Do not design features that encourage strenuous activity or heavy workloads.** Any exercise-linked logic must carry the cardiologist-approval caveat.
- A future feature worth considering: medication adherence tracking, since the med regimen is central to recovery.

## 7. Build approach

- **Slice-based**, mirroring how Irfan shipped Seamlify People (36 slices) and Seamlify Ops. Ship incrementally; finish a slice before opening a new thread. Momentum and clear next-steps matter — he has a history of stalling on long builds and has since beaten it by working this way.
- **Spec-first.** Design the normalised data model and ingestion architecture before writing code. The first artifact is the data-model spec.
- **Non-coder, systems-fluent.** Explain technical concepts in plain language; he reasons well at the systems level but does not write code day-to-day. He executes builds through Claude Code.

### Recommended slice roadmap (to confirm with Irfan, not impose)

- **Slice 0 — Foundations:** dedicated Supabase project, Vercel skeleton, single-user auth, the normalised health-data schema.
- **Slice 1 — Whoop adapter, end to end:** proves the normalise-into-common-schema pattern with one clean source.
- **Slice 2 — Withings (BP).**
- **Slice 3 — Manual entry + quick-log UI:** weight, fingerstick glucose, symptoms/notes.
- **Slice 4 — Oxylink SpO2:** Apple Health and/or CSV import.
- **Slice 5 — Diabetes layer:** Nightscout (CGM) + Tidepool/Apple-Health fingerstick, episodic.
- **Slice 6 — Labs / blood work:** PDF → structured import.
- **Slice 7 — Trend dashboard + doctor-record export view.**
- **Slice 8 — Discipline layer:** routine/habits tied to recovery.
- **Final slice (deferred) — wearable swap** to Oura/Air (Nov 2026) and **early-warning drift-flagging** (trends, not alarms).

## 8. Key design constraints to carry forward

- **PHI isolation** — dedicated DB, encryption, single-user auth, nothing shared with Seamlify.
- **Pluggable wearable** — adapter pattern so the November swap is trivial.
- **Unit awareness** — Irfan is in the UAE: glucose and lipids are typically reported in mmol/L, while many US devices/APIs (Dexcom, Tidepool) default to mg/dL. The schema must store units explicitly and normalise on ingestion. Get this wrong and the trends are nonsense.
- **Mixed data shapes** — the model must handle continuous time-series (CGM, SpO2, HR), daily summaries (sleep, recovery), discrete readings (BP, weight, fingerstick), and episodic imports (labs). Design for all four cleanly.
- **Trends, not alarms** — see §2.

## 9. Open decisions

- **Wearable:** Oura vs Fitbit Air — decide November 2026.
- **CGM brand for the next stint:** Libre (cheaper, UAE-stocked, Nightscout-friendly) vs Dexcom — both route through Nightscout, so low stakes.
- **Fingerstick path:** confirm whether the existing Contour is Tidepool-supported, or move to an Apple-Health Bluetooth meter.

## 10. How Irfan works (apply these in the project)

- **Feedback:** blunt and direct. No diplomacy needed. Challenge architecture and high-stakes decisions aggressively until they are right; just execute on simple, clear tasks.
- **Questions:** one at a time. Never stack multiple questions in one message.
- **Process:** break complex tasks into steps → confirm the plan → get approval → then execute. For simple, clear requests, just execute.
- **Proactivity:** suggest better/faster approaches before diving in.
- **Audience:** always confirm the audience for any deliverable if unspecified.
- **Writing:** prose over bullets in conversation; no preamble filler, no repeating his words back, no trailing summaries after a deliverable, no emojis, no excessive bold/headers.
- **Files:** always produce real files for deliverables. `.md` for anything bound for an AI tool/IDE; `.docx` for documents; `.pptx` for presentations; `.xlsx` for data.
- **Hard rule — never delete a file. Ever.** Editing in place and overwriting a version on update are fine. Create a new version for substantial changes. Versioning convention: `{original-filename}_v{n}_{YYYY-MM-DD}.{ext}`.
- **Recovery awareness:** factor cardiac recovery into workload and scheduling suggestions; no strenuous or heavy-load recommendations.
- **Faith-aware scheduling** where relevant: prayer times, Friday Jummah, Ramadan, halal.
- **New parent:** time and energy are constrained. Be efficient.
