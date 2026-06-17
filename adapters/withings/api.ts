import type { SupabaseClient } from '@supabase/supabase-js'
import type { OAuthTokens } from '../_lib/types'
import { saveTokens } from '../_lib/token-store'

const WITHINGS_API_BASE = 'https://wbsapi.withings.net'
const WITHINGS_TOKEN_URL = `${WITHINGS_API_BASE}/v2/oauth2`
const WITHINGS_MEASURE_URL = `${WITHINGS_API_BASE}/measure`

const SOURCE_SLUG = 'withings'

// Withings measurement type codes (BP-relevant only)
export const MEAS_TYPE_DIASTOLIC = 9
export const MEAS_TYPE_SYSTOLIC = 10
export const MEAS_TYPE_PULSE = 11

export interface WithingsMeasure {
  value: number
  type: number
  unit: number
  algo?: number
  fm?: number
}

export interface WithingsMeasureGroup {
  grpid: number
  date: number // unix seconds
  category: number // 1 = real measurement, 2 = objective
  attrib: number // 0=device, 1=manual app, 2=manual override, 4=objective, 5=wrong, 7=creation stub
  created: number
  modified: number
  comment?: string
  deviceid?: string
  measures: WithingsMeasure[]
}

interface WithingsWrappedResponse<T> {
  status: number
  body: T
  error?: string
}

interface TokenBody {
  userid: string
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  token_type: string
}

interface GetMeasBody {
  updatetime: number
  timezone: string
  measuregrps: WithingsMeasureGroup[]
  more: 0 | 1
  offset?: number
}

async function postForm<T>(
  url: string,
  params: Record<string, string>,
  bearerToken?: string
): Promise<WithingsWrappedResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Withings HTTP ${response.status} at ${url}: ${text.slice(0, 300)}`
    )
  }

  return (await response.json()) as WithingsWrappedResponse<T>
}

function unwrap<T>(res: WithingsWrappedResponse<T>, ctx: string): T {
  if (res.status !== 0) {
    throw new Error(
      `Withings ${ctx} failed (status ${res.status}): ${res.error ?? 'no error message'}`
    )
  }
  return res.body
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const res = await postForm<TokenBody>(WITHINGS_TOKEN_URL, {
    action: 'requesttoken',
    grant_type: 'authorization_code',
    client_id: process.env.WITHINGS_CLIENT_ID!,
    client_secret: process.env.WITHINGS_CLIENT_SECRET!,
    code,
    redirect_uri: redirectUri,
  })
  const body = unwrap(res, 'code exchange')
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
  }
}

export async function refreshAccessToken(
  supabase: SupabaseClient,
  tokens: OAuthTokens
): Promise<OAuthTokens> {
  const res = await postForm<TokenBody>(WITHINGS_TOKEN_URL, {
    action: 'requesttoken',
    grant_type: 'refresh_token',
    client_id: process.env.WITHINGS_CLIENT_ID!,
    client_secret: process.env.WITHINGS_CLIENT_SECRET!,
    refresh_token: tokens.refreshToken,
  })
  const body = unwrap(res, 'token refresh')
  const updated: OAuthTokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
  }
  await saveTokens(supabase, SOURCE_SLUG, updated)
  return updated
}

/**
 * Ensure the access token is valid; refresh with 60s buffer if not.
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
 * Fetch all BP-relevant measurement groups from Withings for the given window.
 * Filters `category = 1` (real measurements only, not user objectives) at the
 * API level. Paginates via `more` / `offset` until no more pages.
 */
export async function fetchBpMeasureGroups(
  accessToken: string,
  startDate: Date,
  endDate: Date
): Promise<WithingsMeasureGroup[]> {
  const startdate = Math.floor(startDate.getTime() / 1000).toString()
  const enddate = Math.floor(endDate.getTime() / 1000).toString()

  const results: WithingsMeasureGroup[] = []
  let offset = 0

  do {
    const params: Record<string, string> = {
      action: 'getmeas',
      meastypes: `${MEAS_TYPE_DIASTOLIC},${MEAS_TYPE_SYSTOLIC},${MEAS_TYPE_PULSE}`,
      category: '1',
      startdate,
      enddate,
    }
    if (offset > 0) params.offset = String(offset)

    const res = await postForm<GetMeasBody>(
      WITHINGS_MEASURE_URL,
      params,
      accessToken
    )
    const body = unwrap(res, 'getmeas')
    results.push(...body.measuregrps)

    if (body.more !== 1) break
    // Defensive: if the API says "more" but doesn't advance the offset, bail
    // rather than loop forever.
    if (typeof body.offset !== 'number' || body.offset <= offset) break
    offset = body.offset
  } while (true)

  return results
}
