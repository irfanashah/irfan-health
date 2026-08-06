import type { SupabaseClient } from '@supabase/supabase-js'
import type { OAuthTokens } from '../_lib/types'
import { saveTokens } from '../_lib/token-store'

const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2'
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
    // Whoop 4.0+ fields — payload typically populated for a 4.0/5.0 strap
    // but defensively typed nullable; the adapter + refill both skip the
    // metric when its source field is null/undefined rather than writing
    // a null row.
    spo2_percentage: number | null
    skin_temp_celsius: number | null
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
    // REQUIRED so Whoop ROTATES + returns a new refresh_token in the response
    // (gotcha #168). Whoop refresh tokens are single-use; the original grant
    // requested `offline`, and the refresh must echo it or the response omits
    // refresh_token — and we'd then overwrite our good token with undefined,
    // so the NEXT refresh sends refresh_token=undefined → 400 invalid_request,
    // permanently, until a manual re-auth.
    scope: 'offline',
  })

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    // Actionable message: a failed refresh means the stored refresh token is
    // invalid/expired/revoked — no code path can revive it; Whoop must be
    // re-connected. Surfaced by the diagnose route + the pipeline-health cron.
    throw new Error(
      `Whoop token refresh failed (${response.status}) — the stored refresh token is invalid or expired. ` +
      `Re-connect Whoop by opening /api/auth/whoop while signed in. Details: ${text.slice(0, 200)}`
    )
  }

  const json = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  const updated: OAuthTokens = {
    accessToken: json.access_token,
    // Keep the existing refresh token if Whoop didn't return a new one — never
    // overwrite a good token with undefined (gotcha #168).
    refreshToken: json.refresh_token ?? tokens.refreshToken,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch one Whoop page, retrying on 429 (rate limit). A full-history pull
 * paginates 25 records at a time over three endpoints in parallel — easily
 * ~60 pages/endpoint — which bursts past Whoop's per-minute limit and 429s
 * (seen live on Reconcile). We honour `Retry-After` when present, else back
 * off exponentially (1s→2s→4s→8s→16s, capped 30s), up to `maxRetries`. Only
 * 429 is retried here; other non-OK statuses fall through to the caller.
 */
async function fetchWhoopPage(url: string, accessToken: string, maxRetries = 5): Promise<Response> {
  let attempt = 0
  for (;;) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (response.status !== 429 || attempt >= maxRetries) return response
    const retryAfter = Number(response.headers.get('retry-after'))
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60_000)
        : Math.min(1000 * 2 ** attempt, 30_000)
    await sleep(waitMs)
    attempt++
  }
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

    const response = await fetchWhoopPage(url.toString(), accessToken)

    if (!response.ok) {
      const text = await response.text()
      const hint =
        response.status === 429
          ? ' — Whoop rate limit still hit after retries; wait a minute and try again (a full-history reconcile is request-heavy).'
          : ''
      throw new Error(
        `Whoop API ${url.pathname} failed (${response.status}): ${text.slice(0, 300)}${hint}`
      )
    }

    const json = (await response.json()) as {
      records: T[]
      next_token?: string
    }
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
  // Sleep is under /activity/sleep, not /sleep. (Spec was wrong.)
  return fetchAllPages<WhoopSleepRecord>(
    '/activity/sleep',
    accessToken,
    start,
    end
  )
}
