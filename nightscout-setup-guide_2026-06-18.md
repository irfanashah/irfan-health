# Nightscout Setup Runbook — self-hosted on your VPS (Slice 5 prerequisite)

**Date:** 2026-06-18 (rev 3 — full step-by-step; self-host on personal Hostinger VPS)
**Goal:** Run Nightscout as a Docker stack on your own Hostinger VPS (PHI stays on infrastructure you control). It receives Dexcom G7 readings live via xDrip+ and holds your imported Clarity history; the platform's agnostic adapter (Slice 5) pulls both.
**End state you hand the platform:** a Nightscout URL (e.g. `https://ns.yourdomain.com`) + a read-only token.

> Two deploy options are given in **Step 3**. Pick **ONE**:
> - **Option A — standalone Docker Compose** (the stack includes Traefik, which gets you HTTPS automatically). Use this if you want Nightscout self-contained and aren't routing it through Coolify.
> - **Option B — Coolify service** (Coolify's built-in proxy handles HTTPS; you paste a *trimmed* compose with no Traefik). Use this since you already run Coolify on the box.

---

## Prerequisites

- Your Hostinger VPS with SSH access and Docker installed (you already have Docker for n8n etc.).
- A domain you control, so you can point a subdomain at the VPS (needed for HTTPS).
- Your Clarity export already saved in the repo (`Dexcom /Clarity_Export_*.csv`).
- Decide your subdomain now, e.g. `ns.yourdomain.com`.

---

## Step 1 — Point a subdomain at your VPS (DNS)

HTTPS and uploads need a real hostname.

1. Find your VPS public IP (Hostinger panel, or on the box: `curl -4 ifconfig.co`).
2. At your domain's DNS provider, add an **A record**:
   - Type: `A`
   - Name/Host: `ns` (gives `ns.yourdomain.com`)
   - Value: your VPS IP
   - TTL: default
3. Wait for it to resolve. Verify from your machine: `dig +short ns.yourdomain.com` should return your VPS IP (can take minutes to an hour).

---

## Step 2 — SSH in (and confirm Docker)

```bash
ssh youruser@ns.yourdomain.com      # or ssh youruser@<VPS-IP>
docker --version                    # confirm Docker present
docker compose version              # confirm the compose plugin present
```

If Docker is somehow missing, install it (Ubuntu):
```bash
sudo apt-get update
sudo apt-get -y install ca-certificates curl gnupg lsb-release
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```
Run Docker as a **non-root** user (don't run Nightscout as root). If you already do (you run n8n), skip. Otherwise:
```bash
sudo usermod -aG docker $USER
# log out and back in for the group change to take effect
```

---

## Step 3 — Deploy Nightscout (pick Option A or B)

First, generate a strong API secret you'll paste below (keep it safe — it's your admin password):
```bash
openssl rand -hex 16     # copy the output; this is your API_SECRET (32 chars)
```

### OPTION A — Standalone Docker Compose (with built-in Traefik HTTPS)

A.1 — Create a dedicated folder (isolated from your other apps):
```bash
mkdir -p ~/nightscout && cd ~/nightscout
```

A.2 — Create the compose file:
```bash
nano docker-compose.yml
```

A.3 — Paste this, then replace the 4 ALL-CAPS placeholders:
```yaml
version: '3'

x-logging:
  &default-logging
  options:
    max-size: '10m'
    max-file: '5'
  driver: json-file

services:
  mongo:
    image: mongo:4.4
    restart: always
    volumes:
      - ./mongo-data:/data/db:cached
    logging: *default-logging

  nightscout:
    image: nightscout/cgm-remote-monitor:latest
    container_name: nightscout
    restart: always
    depends_on:
      - mongo
    labels:
      - 'traefik.enable=true'
      - 'traefik.http.routers.nightscout.rule=Host(`NS.YOURDOMAIN.COM`)'   # <-- your subdomain
      - 'traefik.http.routers.nightscout.entrypoints=websecure'
      - 'traefik.http.routers.nightscout.tls.certresolver=le'
    logging: *default-logging
    environment:
      NODE_ENV: production
      TZ: Asia/Dubai
      INSECURE_USE_HTTP: 'true'                 # TLS handled by Traefik below
      MONGO_CONNECTION: mongodb://mongo:27017/nightscout
      API_SECRET: PASTE_YOUR_API_SECRET         # <-- the openssl value, 16+ chars
      DISPLAY_UNITS: mmol                        # your canonical unit
      AUTH_DEFAULT_ROLES: denied                 # PRIVATE — token required, not world-readable
      ENABLE: rawbg iob

  traefik:
    image: traefik:latest
    restart: always
    container_name: traefik
    command:
      - '--providers.docker=true'
      - '--providers.docker.exposedbydefault=false'
      - '--entrypoints.web.address=:80'
      - '--entrypoints.web.http.redirections.entrypoint.to=websecure'
      - '--entrypoints.websecure.address=:443'
      - '--certificatesresolvers.le.acme.httpchallenge=true'
      - '--certificatesresolvers.le.acme.httpchallenge.entrypoint=web'
      - '--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json'
      - '--certificatesresolvers.le.acme.email=YOUR_EMAIL@EXAMPLE.COM'      # <-- your email
    ports:
      - '443:443'
      - '80:80'
    volumes:
      - './letsencrypt:/letsencrypt'
      - '/var/run/docker.sock:/var/run/docker.sock:ro'
    logging: *default-logging
```

Replace: `NS.YOURDOMAIN.COM`, `PASTE_YOUR_API_SECRET`, `YOUR_EMAIL@EXAMPLE.COM`. Save (`Ctrl-O`, `Enter`, `Ctrl-X`).

> ⚠️ Ports 80 and 443 must be free on the VPS. If Coolify (or another proxy) already owns them, **use Option B instead** — don't run two things fighting for 443.

A.4 — Launch and watch it come up:
```bash
docker compose up -d
docker compose ps                 # both containers should be "running"
docker compose logs -f nightscout # watch; Ctrl-C to stop watching
```
Traefik will fetch a Let's Encrypt cert automatically (needs DNS from Step 1 working and ports 80/443 open). Give it a minute.

To update later:
```bash
cd ~/nightscout && docker compose down && docker compose pull && docker compose up -d
```

### OPTION B — Coolify service (Coolify handles HTTPS)

Coolify already runs your reverse proxy, so you do **not** include Traefik, and Nightscout doesn't publish ports — Coolify routes the domain to the container's internal port `1337`.

B.1 — In Coolify: open your **Project** → **+ Add Resource** → choose **Docker Compose Empty**.

B.2 — Paste this trimmed compose into Coolify's compose editor:
```yaml
version: '3'

services:
  mongo:
    image: mongo:4.4
    restart: always
    volumes:
      - ./mongo-data:/data/db:cached

  nightscout:
    image: nightscout/cgm-remote-monitor:latest
    restart: always
    depends_on:
      - mongo
    environment:
      NODE_ENV: production
      TZ: Asia/Dubai
      INSECURE_USE_HTTP: 'true'                 # Coolify's proxy terminates TLS
      MONGO_CONNECTION: mongodb://mongo:27017/nightscout
      API_SECRET: PASTE_YOUR_API_SECRET         # <-- 16+ chars
      DISPLAY_UNITS: mmol
      AUTH_DEFAULT_ROLES: denied                 # PRIVATE
      ENABLE: rawbg iob
    expose:
      - '1337'
```

B.3 — In the Coolify UI for the `nightscout` service:
- Set the **Domain** to `https://ns.yourdomain.com` and confirm the **port is 1337**.
- Coolify auto-provisions the Let's Encrypt cert for that domain (make sure Step 1 DNS points at the VPS first).
- (Optional) move `API_SECRET` into Coolify's **Environment Variables** tab instead of inline, so it's stored as a secret.

B.4 — Click **Deploy**. Watch the deployment logs in Coolify until both containers are healthy.

---

## Step 4 — First admin login (the site is private)

Because `AUTH_DEFAULT_ROLES: denied`, visiting the site shows nothing until you authenticate.
1. Open `https://ns.yourdomain.com` in a browser.
2. Click the **hamburger menu (☰)** top-right → **Authentication** → **Authenticate**.
3. Enter your `API_SECRET`. You're now an admin for this browser session.

If the page won't load at all, jump to Troubleshooting below.

---

## Step 5 — Create a read-only token for the platform

Never give the platform your `API_SECRET`. Make a scoped token instead.
1. ☰ menu → **Admin Tools** (it uses your authenticated admin session).
2. Under **Subjects** → **Add new Subject**:
   - Name: `health-platform`
   - Roles: `readable`
3. Click the save (✓) icon. A token string appears next to the subject — **copy it**. This is the read-only access token.

**Hand me:** the site URL (`https://ns.yourdomain.com`) + this **read-only token**. Not the API_SECRET.

---

## Step 6 — Live data: xDrip+ on the Fold → Nightscout

Region-free path; xDrip+ reads the G7 directly over Bluetooth, no Dexcom cloud.
1. On the **Samsung Fold**, install **xDrip+** — the latest **Nightly Snapshot** build (that's where current G7 support lives).
2. First run → choose data source **Dexcom G7 / ONE+ (native)**; follow the on-screen G7 pairing. (You may need to control which app owns the sensor's Bluetooth — follow xDrip+'s current G7 pairing notes.)
3. ☰ → **Settings → Cloud Upload → Nightscout Sync (REST-API)** → toggle **ON** at the top.
4. **Base URL** — enter exactly, with the API_SECRET embedded:
   ```
   https://YOUR_API_SECRET@ns.yourdomain.com/api/v1/
   ```
5. Back out to save. Then **Android Settings → Apps → xDrip+ → Battery → Unrestricted** (so Android doesn't kill it in the background).

Live readings only flow while a sensor is active — you're between stints now, so this lights up when you apply your next G7.

---

## Step 7 — History: load your Clarity export into Nightscout (one-time)

Your ~11 days are in the repo. Clarity's CSV format ≠ Nightscout's, so this needs a small one-time loader (I'll build it) that reads the EGV rows and POSTs them to `https://ns.yourdomain.com/api/v1/entries` as `sgv` entries, authenticated with the `API_SECRET`.
- What I'll need from you to build/run it: the site URL + the `API_SECRET` (used only locally to run the load; not stored).
- Runs once. Afterward your history lives in Nightscout and the agnostic adapter reads it like any other data.
Ping me when Steps 3–5 are done and I'll build it against your CSV.

---

## Step 8 — Verify end-to-end

- **Site up:** `https://ns.yourdomain.com` loads with a valid padlock (cert issued).
- **History:** after Step 7, the chart shows your May 28–Jun 8 readings.
- **Live:** after your next sensor + Step 6, new points appear every ~5 min (check ☰ → also visible in xDrip+'s own graph).
- **Token works:** `https://ns.yourdomain.com/api/v1/entries.json?token=YOUR_READ_TOKEN&count=5` returns JSON readings (this is exactly what the platform adapter will call).

---

## Security / PHI checklist

- `AUTH_DEFAULT_ROLES: denied` (private) + strong `API_SECRET` + HTTPS only. A default-open Nightscout would expose your glucose data — don't skip the private setting.
- Dedicated Mongo + volume for Nightscout; do not point it at a DB shared with n8n/openclaw/hermes.
- Keep it updated (`docker compose pull` for Option A; redeploy in Coolify for Option B).
- Never commit the `API_SECRET`, the read token, or the `Dexcom /` CSVs to the repo — gitignore that folder now.

---

## Troubleshooting

- **Page won't load / 502:** containers still starting, or the domain isn't routing. `docker compose logs nightscout` (A) or Coolify logs (B). Confirm DNS (`dig +short ns.yourdomain.com`).
- **No HTTPS / cert error:** Let's Encrypt needs port 80 reachable and DNS correct. Option A: ensure 80/443 are open and not used by another proxy. Option B: confirm the domain is set on the service in Coolify.
- **Ports 80/443 already in use (Option A):** Coolify already owns them — use Option B.
- **xDrip+ not uploading:** re-check the Base URL format (the `API_SECRET@` part), phone internet, and that battery optimization is off for xDrip+.
- **Mongo won't start:** usually a volume permission issue — `docker compose down` then `up -d`; check `./mongo-data` ownership.

## Sources

- Nightscout on Docker (official step-by-step): https://nightscout.github.io/vendors/VPS/docker/
- Official docker-compose.yml: https://github.com/nightscout/cgm-remote-monitor/blob/master/docker-compose.yml
- Nightscout configuration variables: https://nightscout.github.io/nightscout/setup_variables/
- Admin Tools (subjects/tokens): https://nightscout.github.io/nightscout/admin_tools/
- Coolify — Docker Compose deploys: https://coolify.io/docs/knowledge-base/docker/compose
- xDrip+ → Nightscout REST-API: https://nightscout.pro/use-nightscout-with-xdrip/
