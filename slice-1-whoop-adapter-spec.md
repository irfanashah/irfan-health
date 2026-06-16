# Slice 1 — Whoop Adapter: End-to-End Ingestion

**Version:** 1.0
**Date:** 2026-06-16
**Prerequisites:** Slice 0 complete (scaffold, auth, UI foundations, Vercel deploy — all verified)

---

## Overview

This slice proves the normalise-into-common-schema pattern end-to-end using Whoop as the first adapter. At the end of this slice:

- A `migration_002_oauth_tokens.sql` migration has been applied to the Supabase project.
- A one-time OAuth handshake has deposited Whoop tokens into the `oauth_tokens` table.
- The Whoop adapter fetches daily cycles, recovery, and sleep from the Whoop API, maps ~12 metric types per day to `health_observations` rows, and upserts them with full deduplication.
- A Vercel cron job runs the adapter every 6 hours automatically.
- A "Run now" button on the dashboard lets you trigger the adapter manually during development.
- Backfill covers from 2025-01-01 to present on the first run.

---

## Decision: Token storage in Supabase (deviation from data-model spec §6)

The data model spec §6 states that OAuth tokens should be stored in Vercel environment variables and rotated via the Vercel API. **This slice deviates from that decision.** Tokens are stored in a dedicated `oauth_tokens` Supabase table instead, read and written exclusively by the ingestion adapter using the service role key.

**Reason:** The Vercel API write-back approach requires a second external API dependency (the Vercel Management API), a `VERCEL_TOKEN` env var, and ~80 extra lines of code. The Supabase approach is 5 lines of SQL and 20 lines of TypeScript. Both approaches achieve the same security outcome: tokens are not in version control, not exposed to the browser, and protected by the same dedicated-project PHI isolation. The data model spec's token-storage clause is superseded by this decision for Slice 1 onward.

The `CLAUDE.md` in this repo takes precedence over the data model spec on implementation decisions. Do not restore Vercel env var token storage.

---

## Pre-conditions (verify before Step 1)

- `migration_001_initial_schema.sql` has been applied to the Supabase project. The `sources` table has 7 rows, including `slug = 'whoop'`.
- The `adapters/` directory exists at the repo root.
- The Whoop developer app is registered at developer.whoop.com with redirect URI `https://irfan-health.vercel.app/api/auth/whoop/callback`. `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` are in hand.
- The app is deployed to Vercel and the live URL is confirmed.

---

## Metrics extracted in this slice

All are `data_shape = 'daily_summary'`, using `period_start` and `period_end` (not `recorded_at`).

**From the Whoop recovery endpoint (keyed on `cycle_id` from the recovery record):**

| metric_type | Whoop API field | unit (source) | canonical_unit |
|---|---|---|---|
| `recovery_score` | `score.recovery_score` | `dimensionless` | `dimensionless` |
| `hrv_rmssd` | `score.hrv_rmssd_milli` | `ms` | `ms` |
| `heart_rate_resting` | `score.resting_heart_rate` | `bpm` | `bpm` |
| `spo2_overnight_avg` | `score.spo2_percentage` | `%` | `%` |

**From the Whoop sleep endpoint (keyed on sleep `id`; naps excluded):**

| metric_type | Whoop API field | unit (source) | canonical_unit |
|---|---|---|---|
| `sleep_score` | `score.sleep_performance_percentage` | `dimensionless` | `dimensionless` |
| `sleep_duration_total` | sum of light + sws + rem stage millis | `milliseconds` | `min` |
| `sleep_duration_deep` | `score.stage_summary.total_slow_wave_sleep_time_milli` | `milliseconds` | `min` |
| `sleep_duration_rem` | `score.stage_summary.total_rem_sleep_time_milli` | `milliseconds` | `min` |
| `sleep_duration_light` | `score.stage_summary.total_light_sleep_time_milli` | `milliseconds` | `min` |
| `sleep_duration_awake` | `score.stage_summary.total_awake_time_milli` | `milliseconds` | `min` |
| `respiratory_rate` | `score.respiratory_rate` | `breaths/min` | `breaths/min` |

**From the Whoop cycle endpoint (keyed on cycle `id`):**

| metric_type | Whoop API field | unit (source) | canonical_unit |
|---|---|---|---|
| `strain_score` | `score.strain` | `dimensionless` | `dimensionless` |

**Note on `skin_temperature_deviation`:** Whoop provides `score.skin_temp_celsius` (absolute temperature) in the recovery endpoint. The spec vocabulary uses `skin_temperature_deviation` (deviation from baseline). These are not the same metric. Do NOT map Whoop's `skin_temp_celsius` to `skin_temperature_deviation`. Skip it in Slice 1.

**Note on `score_state`:** Only write rows where the API response has `score_state === 'SCORED'`. Records in `PENDING_SLEEP`, `PENDING_UPDATE`, or `UNSCORABLE` state have no valid data — skip them entirely (do not write a row, do not count as an error).

---

## Source-record ID conventions for Whoop

The UNIQUE constraint in `health_observations` is on `(source_slug, source_record_id)`. Since one Whoop API record produces multiple metric rows, the metric type must be encoded into `source_record_id` to ensure uniqueness.

Format: `{record_type}_{id}_{metric_type}`

Examples:
- `recovery_12345_hrv_rmssd`
- `recovery_12345_recovery_score`
- `sleep_67890_sleep_duration_total`
- `cycle_11111_strain_score`

Use the `cycle_id` field from recovery records (not the recovery's own `id`) as the anchor for recovery-based metrics. Whoop recovery records link to their parent cycle via `cycle_id`.

---

## New environment variables

Add all of these to `.env.local` (local dev) and to the Vercel project dashboard (production).

| Variable | Value | Notes |
|---|---|---|
| `WHOOP_CLIENT_ID` | From Whoop developer portal | Public identifier |
| `WHOOP_CLIENT_SECRET` | From Whoop developer portal | Treat as password |
| `CRON_SECRET` | Generate: `openssl rand -hex 32` | Vercel cron authentication |
| `NEXT_PUBLIC_APP_URL` | `https://irfan-health.vercel.app` (Vercel) / `http://localhost:3000` (`.env.local`) | Used in OAuth redirect URI construction |

**No `INGESTION_SECRET` is needed.** The manual trigger route authenticates via Supabase session. The cron route authenticates via `CRON_SECRET`.

---

## Implementation steps

---

### Step 1: Create `migration_002_oauth_tokens.sql`

This file already exists at the repo root (`migration_002_oauth_tokens.sql`). Do not recreate it.

---

### Step 2 (MANUAL — Irfan): Apply `migration_002` in Supabase

> **Before writing any code:** open the Supabase dashboard for your irfan-health project, go to **SQL Editor**, paste the contents of `migration_002_oauth_tokens.sql`, and run it. Verify that `oauth_tokens` appears in the Table Editor with 0 rows.

Claude Code cannot do this step. Do not proceed to Step 3 until this is done.

---

### Step 3 (MANUAL — Irfan): Fill in `.env.local`

> **Before running the app:** open `.env.local` at the repo root and add the three new variables listed in the "New environment variables" table above. Use real values — `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` from your Whoop developer portal, and a freshly generated `CRON_SECRET`.

Claude Code cannot do this step. Do not proceed past Step 3 until this is done.

---

### Step 4: Scaffold `adapters/_lib/`

Create four files under `adapters/_lib/`. The `adapters/` directory already exists.

---

#### `adapters/_lib/types.ts`

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Adapter {
  readonly sourceSlug: string
  fetchAndIngest(config: AdapterConfig): Promise<IngestionResult>
}

export interface AdapterConfig {
  supabase: SupabaseClient
  fromDate?: Date
  toDate?: Date
}

export interface IngestionResult {
  ingestionLogId: string
  recordsFound: number
  recordsWritten: number
  recordsSkipped: number
  errors: string[]
  status: 'success' | 'partial' | 'error'
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}
```

---

#### `adapters/_lib/normalise.ts`

The `normaliseUnit` function must handle every conversion pair the Whoop adapter uses. The conversion table below is the authoritative source — any pair not listed throws an error.

**Add `milliseconds → min` to the spec's §4 table.** Whoop sleep stage durations are in milliseconds. The spec §4 table lists `seconds → min (÷60)` and `hours → min (×60)` but not milliseconds. Add `milliseconds → min` here.

```typescript
/**
 * Normalise a numeric value from one unit to the canonical unit.
 * Pure function — throws if the conversion pair is not in the table.
 * If fromUnit === toUnit, returns value unchanged.
 */
export function normaliseUnit(
  value: number,
  fromUnit: string,
  toUnit: string
): number {
  if (fromUnit === toUnit) return value

  const key = `${fromUnit}→${toUnit}`

  const conversions: Record<string, (v: number) => number> = {
    // Sleep durations — Whoop sends milliseconds
    'milliseconds→min': (v) => v / 60_000,
    // Other sleep duration conversions (future sources)
    'seconds→min': (v) => v / 60,
    'hours→min': (v) => v * 60,
    // Weight
    'lbs→kg': (v) => v / 2.2046,
    'g→kg': (v) => v / 1000,
    // Glucose
    'mg/dL→mmol/L': (v) => v / 18.018,
    // Lipids — cholesterol
    'mg/dL→mmol/L_lipid': (v) => v / 38.67,
    // Lipids — triglycerides
    'mg/dL→mmol/L_trig': (v) => v / 88.57,
    // Lp(a) — approximate conversion, note in docs
    'mg/dL→nmol/L': (v) => v * 2.5,
    // Temperature
    '°F→°C': (v) => (v - 32) * (5 / 9),
    // Blood pressure (future-proofing)
    'kPa→mmHg': (v) => v * 7.50062,
  }

  const fn = conversions[key]
  if (!fn) {
    throw new Error(
      `normaliseUnit: no conversion defined for '${fromUnit}' → '${toUnit}'`
    )
  }

  return fn(value)
}
```

---

#### `adapters/_lib/ingestion-log.ts`

Helper functions for creating and updating `ingestion_log` rows.

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export async function createIngestionLog(
  supabase: SupabaseClient,
  sourceSlug: string,
  windowStart: Date,
  windowEnd: Date
): Promise<string> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .insert({
      source_slug: sourceSlug,
      fetch_window_start: windowStart.toISOString(),
      fetch_window_end: windowEnd.toISOString(),
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create ingestion_log row: ${error?.message}`)
  }

  return data.id as string
}

export async function updateIngestionLog(
  supabase: SupabaseClient,
  logId: string,
  update: {
    status: 'success' | 'partial' | 'error'
    recordsFound: number
    recordsWritten: number
    recordsSkipped: number
    rawPayload?: unknown
    errorDetail?: string
  }
): Promise<void> {
  const { error } = await supabase
    .from('ingestion_log')
    .update({
      status: update.status,
      records_found: update.recordsFound,
      records_written: update.recordsWritten,
      records_skipped: update.recordsSkipped,
      raw_payload: update.rawPayload ?? null,
      error_detail: update.errorDetail ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', logId)

  if (error) {
    // Log but do not throw — a failure to update the log should not mask the
    // primary result
    console.error(`Failed to update ingestion_log row ${logId}:`, error.message)
  }
}

/**
 * Returns the fetch_window_end of the most recent successful run for a source,
 * or null if no successful run exists (first run / backfill).
 */
export async function getLastSuccessfulWindowEnd(
  supabase: SupabaseClient,
  sourceSlug: string
): Promise<Date | null> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .select('fetch_window_end')
    .eq('source_slug', sourceSlug)
    .eq('status', 'success')
    .order('fetch_window_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data?.fetch_window_end) return null

  return new Date(data.fetch_window_end as string)
}
```

---

#### `adapters/_lib/token-store.ts`

Read and write OAuth tokens from the `oauth_tokens` table. Uses the service role client (bypasses RLS).

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OAuthTokens } from './types'

export async function getTokens(
  supabase: SupabaseClient,
  sourceSlug: string
): Promise<OAuthTokens | null> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('source_slug', sourceSlug)
    .maybeSingle()

  if (error || !data) return null

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresAt: new Date(data.expires_at as string),
  }
}

export async function saveTokens(
  supabase: SupabaseClient,
  sourceSlug: string,
  tokens: OAuthTokens
): Promise<void> {
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      source_slug: sourceSlug,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('source_slug', sourceSlug)

  if (error) {
    throw new Error(`Failed to save tokens for ${sourceSlug}: ${error.message}`)
  }
}
```

---

### Step 5: Build `adapters/whoop/`

Create two files: the Whoop API client and the main adapter.

---

#### `adapters/whoop/api.ts`

Typed wrapper around the Whoop API v1. Handles pagination and token refresh.

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OAuthTokens } from '../_lib/types'
import { saveTokens } from '../_lib/token-store'

const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v1'
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'

export interface WhoopCycleRecord {
  id: number
  start: string
  end: string
  score_state: string
  score?: {
    strain: number
    kilojoule: number
    average_heart_rate: number
    max_heart_rate: number
  }
}

export interface WhoopRecoveryRecord {
  cycle_id: number
  sleep_id: number
  score_state: string
  score?: {
    recovery_score: number
    resting_heart_rate: number
    hrv_rmssd_milli: number
    spo2_percentage: number
    skin_temp_celsius: number
  }
}

export interface WhoopSleepRecord {
  id: number
  start: string
  end: string
  nap: boolean
  score_state: string
  score?: {
    stage_summary: {
      total_light_sleep_time_milli: number
      total_slow_wave_sleep_time_milli: number
      total_rem_sleep_time_milli: number
      total_awake_time_milli: number
    }
    respiratory_rate: number
    sleep_performance_percentage: number
    sleep_efficiency_percentage: number
  }
}

/**
 * Refresh the access token using the stored refresh token.
 * Saves updated tokens to Supabase and returns the new token set.
 */
export async function refreshAccessToken(
  supabase: SupabaseClient,
  tokens: OAuthTokens
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: process.env.WHOOP_CLIENT_ID!,
    client_secret: process.env.WHOOP_CLIENT_SECRET!,
  })

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed (${response.status}): ${text}`)
  }

  const json = await response.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  const updated: OAuthTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  }

  await saveTokens(supabase, 'whoop', updated)

  return updated
}

/**
 * Ensure the access token is valid. Refreshes if expired (with 60s buffer).
 */
export async function ensureFreshToken(
  supabase: SupabaseClient,
  tokens: OAuthTokens
): Promise<OAuthTokens> {
  const bufferMs = 60 * 1000
  if (tokens.expiresAt.getTime() - Date.now() < bufferMs) {
    return refreshAccessToken(supabase, tokens)
  }
  return tokens
}

/**
 * Fetch all pages from a Whoop paginated endpoint within a date window.
 */
async function fetchAllPages<T>(
  endpoint: string,
  accessToken: string,
  startDate: Date,
  endDate: Date
): Promise<T[]> {
  const results: T[] = []
  let nextToken: string | undefined

  do {
    const url = new URL(`${WHOOP_API_BASE}${endpoint}`)
    url.searchParams.set('start', startDate.toISOString())
    url.searchParams.set('end', endDate.toISOString())
    url.searchParams.set('limit', '25')
    if (nextToken) url.searchParams.set('nextToken', nextToken)

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Whoop API ${endpoint} failed (${response.status}): ${text}`)
    }

    const json = await response.json() as { records: T[]; next_token?: string }
    results.push(...json.records)
    nextToken = json.next_token
  } while (nextToken)

  return results
}

export async function fetchCycles(
  accessToken: string,
  start: Date,
  end: Date
): Promise<WhoopCycleRecord[]> {
  return fetchAllPages<WhoopCycleRecord>('/cycle', accessToken, start, end)
}

export async function fetchRecoveries(
  accessToken: string,
  start: Date,
  end: Date
): Promise<WhoopRecoveryRecord[]> {
  return fetchAllPages<WhoopRecoveryRecord>('/recovery', accessToken, start, end)
}

export async function fetchSleepSessions(
  accessToken: string,
  start: Date,
  end: Date
): Promise<WhoopSleepRecord[]> {
  return fetchAllPages<WhoopSleepRecord>('/sleep', accessToken, start, end)
}
```

---

#### `adapters/whoop/index.ts`

The main adapter. Implements the `Adapter` interface from `_lib/types.ts`.

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Adapter, AdapterConfig, IngestionResult } from '../_lib/types'
import { normaliseUnit } from '../_lib/normalise'
import {
  createIngestionLog,
  updateIngestionLog,
  getLastSuccessfulWindowEnd,
} from '../_lib/ingestion-log'
import { getTokens } from '../_lib/token-store'
import {
  ensureFreshToken,
  fetchCycles,
  fetchRecoveries,
  fetchSleepSessions,
} from './api'

/** Backfill from this date on the very first run. */
const BACKFILL_START_DATE = new Date('2025-01-01T00:00:00.000Z')

const SOURCE_SLUG = 'whoop'

export const whoopAdapter: Adapter = {
  sourceSlug: SOURCE_SLUG,

  async fetchAndIngest(config: AdapterConfig): Promise<IngestionResult> {
    const { supabase, fromDate, toDate } = config
    const errors: string[] = []
    let recordsFound = 0
    let recordsWritten = 0
    let recordsSkipped = 0

    // ── 1. Resolve fetch window ──────────────────────────────────────────────

    const windowEnd = toDate ?? new Date()

    let windowStart: Date
    if (fromDate) {
      windowStart = fromDate
    } else {
      const lastEnd = await getLastSuccessfulWindowEnd(supabase, SOURCE_SLUG)
      // Overlap by 1 day to catch late-arriving Whoop data
      windowStart = lastEnd
        ? new Date(lastEnd.getTime() - 24 * 60 * 60 * 1000)
        : BACKFILL_START_DATE
    }

    // ── 2. Create ingestion_log row ──────────────────────────────────────────

    let logId: string
    try {
      logId = await createIngestionLog(supabase, SOURCE_SLUG, windowStart, windowEnd)
    } catch (err) {
      // If we can't even write a log row, bail — nothing to track
      return {
        ingestionLogId: 'unknown',
        recordsFound: 0,
        recordsWritten: 0,
        recordsSkipped: 0,
        errors: [`Failed to create ingestion_log: ${(err as Error).message}`],
        status: 'error',
      }
    }

    try {
      // ── 3. Authenticate ────────────────────────────────────────────────────

      const storedTokens = await getTokens(supabase, SOURCE_SLUG)
      if (!storedTokens) {
        throw new Error(
          'No Whoop tokens found in oauth_tokens. Run the OAuth handshake first.'
        )
      }

      const tokens = await ensureFreshToken(supabase, storedTokens)
      const { accessToken } = tokens

      // ── 4. Fetch from Whoop ────────────────────────────────────────────────

      const [cycles, recoveries, sleepSessions] = await Promise.all([
        fetchCycles(accessToken, windowStart, windowEnd),
        fetchRecoveries(accessToken, windowStart, windowEnd),
        fetchSleepSessions(accessToken, windowStart, windowEnd),
      ])

      const rawPayload = { cycles, recoveries, sleep: sleepSessions }

      // ── 5 & 6. Normalise and upsert ───────────────────────────────────────

      // Build a lookup: cycle_id → { start, end } for period timestamps
      const cycleMap = new Map<number, { start: string; end: string }>()
      for (const c of cycles) {
        cycleMap.set(c.id, { start: c.start, end: c.end })
      }

      // 5a. Cycle metrics
      for (const cycle of cycles) {
        if (cycle.score_state !== 'SCORED' || !cycle.score) continue

        const period_start = cycle.start
        const period_end = cycle.end

        const cycleMetrics = [
          {
            metric_type: 'strain_score',
            value: cycle.score.strain,
            unit: 'dimensionless',
          },
        ]

        recordsFound += cycleMetrics.length

        for (const m of cycleMetrics) {
          const result = await upsertObservation(supabase, {
            source_slug: SOURCE_SLUG,
            source_record_id: `cycle_${cycle.id}_${m.metric_type}`,
            data_shape: 'daily_summary',
            metric_type: m.metric_type,
            period_start,
            period_end,
            numeric_value: m.value,
            unit: m.unit,
            canonical_value: m.value,
            canonical_unit: m.unit,
            ingestion_log_id: logId,
          })
          if (result === 'written') recordsWritten++
          else if (result === 'skipped') recordsSkipped++
          else errors.push(result)
        }
      }

      // 5b. Recovery metrics
      for (const rec of recoveries) {
        if (rec.score_state !== 'SCORED' || !rec.score) continue

        // Use the cycle's time window for period_start/period_end
        const cycle = cycleMap.get(rec.cycle_id)
        if (!cycle) continue

        const period_start = cycle.start
        const period_end = cycle.end

        const recoveryMetrics: Array<{
          metric_type: string
          value: number
          unit: string
          canonical_unit: string
        }> = [
          {
            metric_type: 'recovery_score',
            value: rec.score.recovery_score,
            unit: 'dimensionless',
            canonical_unit: 'dimensionless',
          },
          {
            metric_type: 'hrv_rmssd',
            value: rec.score.hrv_rmssd_milli,
            unit: 'ms',
            canonical_unit: 'ms',
          },
          {
            metric_type: 'heart_rate_resting',
            value: rec.score.resting_heart_rate,
            unit: 'bpm',
            canonical_unit: 'bpm',
          },
          {
            metric_type: 'spo2_overnight_avg',
            value: rec.score.spo2_percentage,
            unit: '%',
            canonical_unit: '%',
          },
        ]

        recordsFound += recoveryMetrics.length

        for (const m of recoveryMetrics) {
          // canonical_value === numeric_value for all recovery metrics (no conversion)
          const result = await upsertObservation(supabase, {
            source_slug: SOURCE_SLUG,
            source_record_id: `recovery_${rec.cycle_id}_${m.metric_type}`,
            data_shape: 'daily_summary',
            metric_type: m.metric_type,
            period_start,
            period_end,
            numeric_value: m.value,
            unit: m.unit,
            canonical_value: m.value,
            canonical_unit: m.canonical_unit,
            ingestion_log_id: logId,
          })
          if (result === 'written') recordsWritten++
          else if (result === 'skipped') recordsSkipped++
          else errors.push(result)
        }
      }

      // 5c. Sleep metrics (exclude naps)
      for (const sleep of sleepSessions) {
        if (sleep.nap) continue
        if (sleep.score_state !== 'SCORED' || !sleep.score) continue

        const period_start = sleep.start
        const period_end = sleep.end
        const stages = sleep.score.stage_summary

        const totalSleepMilli =
          stages.total_light_sleep_time_milli +
          stages.total_slow_wave_sleep_time_milli +
          stages.total_rem_sleep_time_milli

        const sleepMetrics: Array<{
          metric_type: string
          value: number
          unit: string
          canonical_unit: string
        }> = [
          {
            metric_type: 'sleep_score',
            value: sleep.score.sleep_performance_percentage,
            unit: 'dimensionless',
            canonical_unit: 'dimensionless',
          },
          {
            metric_type: 'sleep_duration_total',
            value: totalSleepMilli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'sleep_duration_deep',
            value: stages.total_slow_wave_sleep_time_milli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'sleep_duration_rem',
            value: stages.total_rem_sleep_time_milli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'sleep_duration_light',
            value: stages.total_light_sleep_time_milli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'sleep_duration_awake',
            value: stages.total_awake_time_milli,
            unit: 'milliseconds',
            canonical_unit: 'min',
          },
          {
            metric_type: 'respiratory_rate',
            value: sleep.score.respiratory_rate,
            unit: 'breaths/min',
            canonical_unit: 'breaths/min',
          },
        ]

        recordsFound += sleepMetrics.length

        for (const m of sleepMetrics) {
          let canonicalValue: number
          try {
            canonicalValue = normaliseUnit(m.value, m.unit, m.canonical_unit)
          } catch (err) {
            errors.push(
              `sleep_${sleep.id}_${m.metric_type}: ${(err as Error).message}`
            )
            continue
          }

          const result = await upsertObservation(supabase, {
            source_slug: SOURCE_SLUG,
            source_record_id: `sleep_${sleep.id}_${m.metric_type}`,
            data_shape: 'daily_summary',
            metric_type: m.metric_type,
            period_start,
            period_end,
            numeric_value: m.value,
            unit: m.unit,
            canonical_value: canonicalValue,
            canonical_unit: m.canonical_unit,
            ingestion_log_id: logId,
          })
          if (result === 'written') recordsWritten++
          else if (result === 'skipped') recordsSkipped++
          else errors.push(result)
        }
      }

      // ── 7. Update ingestion_log ────────────────────────────────────────────

      const status = errors.length === 0
        ? 'success'
        : errors.length < recordsFound
          ? 'partial'
          : 'error'

      await updateIngestionLog(supabase, logId, {
        status,
        recordsFound,
        recordsWritten,
        recordsSkipped,
        rawPayload,
      })

      return {
        ingestionLogId: logId,
        recordsFound,
        recordsWritten,
        recordsSkipped,
        errors,
        status,
      }
    } catch (err) {
      const message = (err as Error).message

      await updateIngestionLog(supabase, logId, {
        status: 'error',
        recordsFound,
        recordsWritten,
        recordsSkipped,
        errorDetail: message,
      })

      return {
        ingestionLogId: logId,
        recordsFound,
        recordsWritten,
        recordsSkipped,
        errors: [message],
        status: 'error',
      }
    }
  },
}

// ── Upsert helper ────────────────────────────────────────────────────────────

// 'written' = row inserted or updated | 'skipped' = row existed, values identical | string = error message
type UpsertResult = 'written' | 'skipped' | string

async function upsertObservation(
  supabase: SupabaseClient,
  row: {
    source_slug: string
    source_record_id: string
    data_shape: string
    metric_type: string
    period_start: string
    period_end: string
    numeric_value: number
    unit: string
    canonical_value: number
    canonical_unit: string
    ingestion_log_id: string
  }
): Promise<UpsertResult> {
  // Check for an existing row with identical values first.
  // This lets us accurately count skips without needing a DO UPDATE WHERE DISTINCT
  // clause (which Supabase JS does not expose directly).
  const { data: existing } = await supabase
    .from('health_observations')
    .select('numeric_value, canonical_value')
    .eq('source_slug', row.source_slug)
    .eq('source_record_id', row.source_record_id)
    .maybeSingle()

  if (
    existing &&
    existing.numeric_value === row.numeric_value &&
    existing.canonical_value === row.canonical_value
  ) {
    return 'skipped'
  }

  // Row is new or values have changed — upsert it.
  const { error } = await supabase
    .from('health_observations')
    .upsert(
      {
        source_slug: row.source_slug,
        source_record_id: row.source_record_id,
        data_shape: row.data_shape,
        metric_type: row.metric_type,
        period_start: row.period_start,
        period_end: row.period_end,
        numeric_value: row.numeric_value,
        unit: row.unit,
        canonical_value: row.canonical_value,
        canonical_unit: row.canonical_unit,
        ingestion_log_id: row.ingestion_log_id,
      },
      { onConflict: 'source_slug,source_record_id' }
    )

  if (error) {
    return `upsert error for ${row.source_record_id}: ${error.message}`
  }

  return 'written'
}
```

---

### Step 6: Build OAuth handshake routes

These two routes handle the one-time browser-based OAuth flow. After the handshake, tokens are in `oauth_tokens` and these routes are no longer needed (but leave them in place — they're harmless and useful if tokens ever need to be re-authorised).

---

#### `app/api/auth/whoop/route.ts`

Initiates the OAuth flow by redirecting to the Whoop authorisation URL.

```typescript
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth'

const SCOPES = [
  'read:recovery',
  'read:sleep',
  'read:workout',
  'read:body_measurement',
  'read:cycles',
  'read:profile',
  'offline',
].join(' ')

export async function GET(): Promise<NextResponse> {
  const params = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/whoop/callback`,
    response_type: 'code',
    scope: SCOPES,
  })

  return NextResponse.redirect(`${WHOOP_AUTH_URL}?${params.toString()}`)
}
```

**Note:** This route requires `NEXT_PUBLIC_APP_URL` to be set in `.env.local` and in Vercel. Add it to the env vars list:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://irfan-health.vercel.app` (production), `http://localhost:3000` (local) |

For local development, Whoop will not redirect to `localhost` (HTTP is not allowed). The OAuth handshake must be run against the live Vercel URL. This is fine — tokens land in Supabase and local dev reads them from there.

---

#### `app/api/auth/whoop/callback/route.ts`

Exchanges the authorisation code for tokens and saves them to `oauth_tokens`.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/service'
import { saveTokens } from '@/adapters/_lib/token-store'

export const runtime = 'nodejs'

const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.json(
      { error: error ?? 'No code returned from Whoop' },
      { status: 400 }
    )
  }

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.WHOOP_CLIENT_ID!,
    client_secret: process.env.WHOOP_CLIENT_SECRET!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/whoop/callback`,
  })

  const tokenResponse = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text()
    return NextResponse.json(
      { error: `Token exchange failed (${tokenResponse.status}): ${text}` },
      { status: 500 }
    )
  }

  const json = await tokenResponse.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  const supabase = createClient()

  try {
    await saveTokens(supabase, 'whoop', {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save tokens: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  // Redirect to the dashboard with a success param
  return NextResponse.redirect(
    new URL('/?whoop_auth=success', process.env.NEXT_PUBLIC_APP_URL!)
  )
}
```

---

### Step 7: Build the manual trigger route

`app/api/ingest/whoop/route.ts` — POST, authenticated via Supabase session. Used by the "Run now" dashboard button.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@/lib/supabase/service'
import { whoopAdapter } from '@/adapters/whoop'

export const runtime = 'nodejs'
// Whoop ingestion can take a while during backfill — set a generous timeout
export const maxDuration = 300 // seconds (Vercel Pro/Hobby max)

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth: user must be logged in to the dashboard
  const supabaseUser = createServerClient()
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // Parse optional date range from request body
  let fromDate: Date | undefined
  let toDate: Date | undefined
  try {
    const body = await request.json().catch(() => ({})) as {
      fromDate?: string
      toDate?: string
    }
    if (body.fromDate) fromDate = new Date(body.fromDate)
    if (body.toDate) toDate = new Date(body.toDate)
  } catch {
    // No body — use default window resolution
  }

  // Use the service role client for the adapter (bypasses RLS)
  const supabase = createServiceClient()

  const result = await whoopAdapter.fetchAndIngest({
    supabase,
    fromDate,
    toDate,
  })

  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
```

---

### Step 8: Build the cron route

`app/api/cron/whoop/route.ts` — GET, authenticated via `CRON_SECRET`. Triggered by Vercel cron every 6 hours.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/service'
import { whoopAdapter } from '@/adapters/whoop'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify the CRON_SECRET header sent by Vercel
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createClient()

  const result = await whoopAdapter.fetchAndIngest({ supabase })

  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
```

---

### Step 9: Configure `vercel.json`

Create or update `vercel.json` at the repo root. If it already exists, merge the `crons` key — do not overwrite other keys.

```json
{
  "crons": [
    {
      "path": "/api/cron/whoop",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

This fires at 00:00, 06:00, 12:00, and 18:00 UTC daily.

---

### Step 10: Update the dashboard — "Run now" button

Update `app/page.tsx` to add a "Run now" button below the existing sign-out button. This is a client-component interaction — extract the button into a small `components/RunNowButton.tsx` client component, and keep `app/page.tsx` as a server component.

**`components/RunNowButton.tsx`** — new file:

```typescript
'use client'

import { useState } from 'react'

export function RunNowButton() {
  const [status, setStatus] = useState<
    'idle' | 'running' | 'success' | 'error'
  >('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handleRunNow() {
    setStatus('running')
    setMessage(null)

    try {
      const response = await fetch('/api/ingest/whoop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      const result = await response.json() as {
        status: string
        recordsFound: number
        recordsWritten: number
        recordsSkipped: number
        errors?: string[]
      }

      if (!response.ok || result.status === 'error') {
        setStatus('error')
        setMessage(result.errors?.[0] ?? 'Unknown error')
      } else {
        setStatus('success')
        setMessage(
          `Done — found ${result.recordsFound}, wrote ${result.recordsWritten}, skipped ${result.recordsSkipped}`
        )
      }
    } catch (err) {
      setStatus('error')
      setMessage((err as Error).message)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        onClick={handleRunNow}
        disabled={status === 'running'}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
      >
        {status === 'running' ? 'Running…' : 'Run Whoop ingestion now'}
      </button>

      {message && (
        <p
          className={`text-sm ${
            status === 'success' ? 'text-green-400' : 'text-destructive'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
```

In `app/page.tsx`, import and render `<RunNowButton />` below the sign-out button. Use semantic tokens only — do not hardcode Tailwind colour classes.

---

### Step 11 (MANUAL — Irfan): Add env vars to Vercel dashboard

> Go to your Vercel project → Settings → Environment Variables. Add:
> - `WHOOP_CLIENT_ID`
> - `WHOOP_CLIENT_SECRET`
> - `CRON_SECRET` (same value as in `.env.local`)
> - `NEXT_PUBLIC_APP_URL` = `https://irfan-health.vercel.app`
>
> For `NEXT_PUBLIC_APP_URL` in `.env.local`, set it to `http://localhost:3000`.

---

### Step 12 (MANUAL — Irfan): Deploy to Vercel

> Push to `main`. Wait for the Vercel deployment to complete. Confirm the live URL is accessible.

---

### Step 13 (MANUAL — Irfan): Run the OAuth handshake

> In your browser, navigate to: `https://irfan-health.vercel.app/api/auth/whoop`
>
> You will be redirected to the Whoop authorisation page. Approve the permissions. You will be redirected back to your dashboard with `?whoop_auth=success` in the URL.
>
> **This must be done on the live Vercel URL, not localhost.** The redirect URI registered with Whoop is the Vercel URL.

---

### Step 14 (MANUAL — Irfan): Verify tokens in Supabase

> Open Supabase → Table Editor → `oauth_tokens`. Confirm there is 1 row with `source_slug = 'whoop'` and non-null `access_token`, `refresh_token`, `expires_at`.

---

### Step 15 (MANUAL — Irfan): Press "Run now"

> On the dashboard, click "Run Whoop ingestion now". The first run is a full backfill from 2025-01-01 — it will take a few minutes and paginate through a significant amount of data. The button will show "Running…" while in progress.

---

### Step 16 (MANUAL — Irfan): Verify the results

> After the button shows a success message:
> 1. Open Supabase → Table Editor → `ingestion_log`. There should be 1 row for `source_slug = 'whoop'` with `status = 'success'` and non-zero `records_found` and `records_written`.
> 2. Open `health_observations`. There should be many rows with `source_slug = 'whoop'`. Check that `metric_type` values match the expected set (`hrv_rmssd`, `recovery_score`, `strain_score`, etc.) and that `canonical_value` is populated.
> 3. Run a second time immediately. The `records_written` count should drop to near 0 and `records_skipped` should be high — confirming deduplication works.

---

## Verification checklist

Before declaring Slice 1 complete, all of the following must be true:

- [ ] `migration_002_oauth_tokens.sql` applied; `oauth_tokens` table visible in Supabase Table Editor
- [ ] `adapters/_lib/types.ts`, `normalise.ts`, `ingestion-log.ts`, `token-store.ts` all created
- [ ] `adapters/whoop/api.ts` and `adapters/whoop/index.ts` created; TypeScript compiles without errors
- [ ] `app/api/auth/whoop/route.ts` and `app/api/auth/whoop/callback/route.ts` created
- [ ] `app/api/ingest/whoop/route.ts` and `app/api/cron/whoop/route.ts` created
- [ ] `vercel.json` created with the cron entry
- [ ] `components/RunNowButton.tsx` created; dashboard shows the button
- [ ] All new env vars set in `.env.local` and Vercel dashboard
- [ ] Deployed to Vercel
- [ ] OAuth handshake completed; token row visible in `oauth_tokens`
- [ ] First "Run now" completes with `status = 'success'`; `ingestion_log` shows non-zero `records_written`
- [ ] `health_observations` contains rows for `source_slug = 'whoop'` across multiple `metric_type` values
- [ ] Second "Run now" shows near-zero `records_written` and high `records_skipped` (deduplication confirmed)
- [ ] Vercel cron shows as active in the Vercel dashboard (Logs → Cron Jobs)

---

## Out of scope

- Visualising the data (Slice 7)
- Any UI beyond the "Run now" button and its status message
- Whoop workout data (later slice if needed)
- Withings BP, CGM, labs, manual entry, Oxylink — own slices
- Token rotation back to Vercel env vars (superseded by Supabase token store)

---

*End of Slice 1 spec. Next: Slice 2 — Withings BP adapter.*
