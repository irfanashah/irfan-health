import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const WITHINGS_AUTH_URL = 'https://account.withings.com/oauth2_user/authorize2'

// Withings expects scopes comma-separated.
const SCOPES = ['user.metrics'].join(',')

export async function GET(): Promise<NextResponse> {
  // Session guard — same reasoning as adapters/whoop's connect route
  // (gotcha #155): /api/* is exempt from middleware's redirect, so this
  // route must self-enforce or anyone can connect their own Withings
  // account and overwrite Irfan's stored tokens via saveTokens().
  const supabaseUser = await createServerSupabase()
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL!))
  }

  // Withings requires the OAuth `state` parameter for CSRF protection
  // (same as Whoop — see gotcha #15). Store in a short-lived httpOnly cookie
  // and verify on callback.
  const state = randomBytes(32).toString('hex')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WITHINGS_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/withings/callback`,
    scope: SCOPES,
    state,
  })

  const response = NextResponse.redirect(
    `${WITHINGS_AUTH_URL}?${params.toString()}`
  )

  response.cookies.set('withings_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  })

  return response
}
