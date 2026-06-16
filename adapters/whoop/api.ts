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

  const json = (await response.json()) as {
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
      throw new Error(
        `Whoop API ${url.pathname} failed (${response.status}): ${text.slice(0, 300)}`
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
