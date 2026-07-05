import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createClient as createServerSupabase } from '@/lib/supabase/server'

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
  // Session guard (gotcha #155) — middleware.ts deliberately exempts every
  // /api/* path (so OAuth callbacks don't lose their `code` param), which
  // means this route must self-enforce auth or anyone who knows the app URL
  // can complete the OAuth flow with THEIR OWN Whoop account. saveTokens()
  // in the callback is service-role + one row per provider, so that would
  // silently overwrite Irfan's stored tokens. The CSRF `state` cookie below
  // is defence-in-depth only — it does NOT stop this, since an attacker's
  // own browser sets and satisfies it just fine.
  const supabaseUser = await createServerSupabase()
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL!))
  }

  // Whoop requires the state parameter for CSRF protection.
  // Store it in a short-lived httpOnly cookie and verify it in the callback.
  const state = randomBytes(32).toString('hex')

  const params = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/whoop/callback`,
    response_type: 'code',
    scope: SCOPES,
    state,
  })

  const response = NextResponse.redirect(
    `${WHOOP_AUTH_URL}?${params.toString()}`
  )

  response.cookies.set('whoop_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  })

  return response
}
