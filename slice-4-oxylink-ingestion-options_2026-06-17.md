# Slice 4 (Oxylink SpO2) — Ingestion-Path Investigation

**Status:** PARKED 2026-06-17 — needs deeper work before speccing/building.
**Question:** How should overnight SpO2 from the Oxylink (Wellue/Viatom) ring get into the platform?

This note preserves the research so a future session can resume cold without re-deriving it.

## Confirmed facts (verified June 2026)

- **Oxylink has no developer API.** Data leaves the device only via the Wellue/ViHealth app: PDF/CSV export, or sync to Apple Health / Google Health / Samsung Health (the multi-platform sync is via MedM premium).
- **Google Health API exposes SpO2 reads today.** `oxygen-saturation` (Sample) and `daily-oxygen-saturation` (Daily) are live data types with `list`/`reconcile` ops under the `health_metrics_and_measurements` scope. Also HRV, resting HR, respiratory rate, blood glucose, weight.
- **BUT the Google Health API's documented data source is the Fitbit ecosystem.** Its "Data availability" section says data appears only after sync into the Fitbit app/devices or manual entry into Fitbit. It's the rebuilt Fitbit Web API. Whether third-party data imported into the Google Health app *via Health Connect* propagates out through the API is **unverified and the docs lean against it.**
- **Health Connect (on Irfan's Samsung Fold) supports background read + "synchronize data out."** It lists Oxygen Saturation as a supported vital. It is on-device — no cloud REST API of its own.
- **Google Health API caveats:** all scopes are "Restricted" (privacy/security review required); API is mid-migration with breaking changes possible until end of May 2026; legacy Fitbit Web API shuts down Sept 2026.

## The three routes

1. **CSV upload (works today, zero dependencies).** Export the session CSV from the Wellue app, upload on the dashboard, parse → two `daily_summary` rows (`spo2_overnight_avg`, `spo2_overnight_min`). Manual export step each time. This is the no-regret immediate path and what the original Slice 4 spec direction assumed.

2. **Route A — Android companion app reading Health Connect.** A small native Android app (Kotlin, Health Connect Jetpack SDK, background read) reads SpO2 from Health Connect and POSTs to the platform API. Robust — depends on nothing in Google's cloud or the Fitbit ecosystem. **Single dependency: does Wellue write Oxygen Saturation into Health Connect?** Cost: a native Android app — a new toolchain for Irfan, heavier to build/maintain than a web feature. Could generalize into a "Health Connect bridge" that feeds more than SpO2 (the Fold is the on-device aggregator for many sources).

3. **Route B — Google Health API cloud chain.** Oxylink → Wellue → Health Connect → Google Health app → Google Health API → server-side OAuth pull. Most elegant (no runtime phone app). The API supports the SpO2 data type, but its sourcing is Fitbit-centric, so the make-or-break is whether Health-Connect-imported Wellue data surfaces through the API — **unverified.** Plus Restricted-scope verification + migration churn.

## Two device checks that resolve it (≈5 min on the Fold)

1. **Health Connect / Google Health → Manage Health Connect:** is the Wellue/Oxylink app connected and writing Oxygen Saturation? → resolves Route A.
2. **Google Health app → an oxygen/SpO2 metric → "View sources":** does Wellue SpO2 appear? → resolves Route B's first hops (then the open question is whether the API mirrors it).

## Strategic ties

- **November wearable swap (Oura vs Fitbit Air):** if Fitbit is chosen, the Google Health API becomes directly useful regardless, since data then originates in the Fitbit ecosystem the API is built around. Strengthens Fitbit's integration case.
- A Health Connect bridge (Route A) could become a general ingestion path for any source the Fold aggregates, not just SpO2.

## Recommendation when resumed

Run the two device checks first. CSV remains the no-regret way to get SpO2 trends flowing now. Build the Health Connect bridge only if (a) Wellue writes SpO2 to Health Connect and (b) the automation is worth the native-Android-app cost. Don't bet on Route B without proving the Health-Connect→API propagation hop.

## Sources

- Google Health API data types: https://developers.google.com/health/data-types
- Google Health API about/roadmap: https://developers.google.com/health/about
- Health Connect developer overview: https://developer.android.com/health-and-fitness/health-connect
- Using Health Connect with the Google Health app: https://support.google.com/googlehealth/answer/14506680
