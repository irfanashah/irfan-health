# Google Drive Setup Runbook — File-Drop Ingestion (Slice 4 prerequisite)

**Date:** 2026-06-22
**Goal:** a private Google Drive folder the Vercel cron can read, list, download from, and move files within — so you drop daily extracts into per-source subfolders and the platform ingests them. One-time setup; ~20 minutes.
**End state you hand the platform:** a service-account JSON key (→ `GDRIVE_SA_KEY`) + the root folder's ID (→ `GDRIVE_ROOT_FOLDER_ID`), both as Vercel env vars.

> Security model: the cron authenticates as a **service account** that has access **only to the one folder you explicitly share to it** — not your whole Drive. No domain-wide delegation needed. The JSON key is a secret (Vercel env only, never in the repo). The folder is private and shared only to the service account.

---

## Step 1 — Google Cloud project + Drive API

1. Go to console.cloud.google.com → create a project (e.g. `irfan-health-filedrop`) or reuse an existing personal one. **Use your personal Google account context, not a Seamlify/work one** (PHI isolation).
2. APIs & Services → Library → search **Google Drive API** → **Enable**.

## Step 2 — Service account + JSON key

1. APIs & Services → **Credentials** → Create credentials → **Service account**. Name it e.g. `health-filedrop`. Create.
2. Open the service account → **Keys** → Add key → **Create new key** → **JSON** → download. Treat this file as a password.
3. Note the service account's **email** (looks like `health-filedrop@irfan-health-filedrop.iam.gserviceaccount.com`).

## Step 3 — Drive folder structure

In Google Drive, create a private root folder, e.g. **`HealthDrop`**, with:
```
HealthDrop/
  inbox/
    oxylink/      ← drop Oxylink overnight CSVs here
    contour/      ← reserved (parser later)
    labs/         ← reserved (Slice 6)
  processed/      ← pipeline moves clean files here (auto-created if absent)
  failed/         ← pipeline moves errored files here (auto-created if absent)
```
You only strictly need `inbox/oxylink/` to start; the pipeline can create `processed/`/`failed/` subfolders on first run, or you can pre-make them.

## Step 4 — Share the folder to the service account

1. Right-click **`HealthDrop`** → Share → paste the **service-account email** from Step 2 → role **Editor** (Editor is required so the cron can *move* files, not just read).
2. Don't share it with anyone else — it's PHI (SpO2, glucose, labs).

## Step 5 — Get the root folder ID

Open `HealthDrop` in the browser; the URL is `https://drive.google.com/drive/folders/<THIS_IS_THE_ID>`. Copy that ID.

## Step 6 — Vercel env vars

In Vercel → Project → Settings → Environment Variables (all environments):
- `GDRIVE_ROOT_FOLDER_ID` = the folder ID from Step 5.
- `GDRIVE_SA_KEY` = the service-account JSON key. **Base64-encode it first** (`base64 -i key.json | pbcopy` on macOS) to avoid newline mangling, and have the code decode it. `CRON_SECRET` is reused from the existing crons.

## Step 7 — (Optional) local-folder drop UX

Install **Google Drive for Desktop** on the Mac and sign in. `HealthDrop/inbox/oxylink/` then appears as a normal local folder — drop the morning's Oxylink export into it and it syncs to Drive, where the cron picks it up at the next 10:00/21:00 GST run. You can also drop from the Drive mobile app.

## Step 8 — Verify

After the pipeline's deployed: drop the Oxylink CSV into `inbox/oxylink/`, wait for (or trigger) a cron run, then:
- the file should move to `processed/oxylink/`,
- `/diagnostics` should show a successful file-drop ingestion,
- two `spo2_overnight_*` rows should exist for that night.
A malformed/misfiled file should land in `failed/oxylink/` with a reason on `/diagnostics`.

---

## Troubleshooting / notes

- **Cron can't see the folder:** confirm the folder is shared to the *service-account email* (not your own) as Editor, and `GDRIVE_ROOT_FOLDER_ID` is correct.
- **Workspace blocks sharing to the service account:** if your Workspace admin restricts external sharing, you may need to allow sharing to that service-account address (it's in your own GCP project, so this is normally fine for a personal project).
- **Key handling:** never commit the JSON key; it lives only in Vercel env. If it leaks, delete the key in the GCP console and create a new one.
- **Least privilege:** the service account sees only `HealthDrop` and its contents — nothing else in your Drive.

## What the platform needs from you

Just the two env values: `GDRIVE_ROOT_FOLDER_ID` + `GDRIVE_SA_KEY` (base64). That's the whole handoff.
