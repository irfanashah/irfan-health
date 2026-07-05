import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { saveTokens } from '@/adapters/_lib/token-store'
import { exchangeCode } from '@/adapters/withings/api'

export const runtime = 'nodejs'

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Session guard (gotcha #155) — same reasoning as the Whoop callback: the
  // legitimate flow always returns to the same authenticated browser, and
  // the state-cookie check alone doesn't stop an attacker from completing
  // the flow with their own Withings account.
  const supabaseUser = await createServerSupabase()
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()
  if (!user) {
    return NextResponse.redirect(
      new URL('/login?error=unauthorised', process.env.NEXT_PUBLIC_APP_URL!)
    )
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.json(
      { error: error ?? 'No code returned from Withings' },
      { status: 400 }
    )
  }

  // CSRF check against the cookie set in /api/auth/withings.
  const cookieState = request.cookies.get('withings_oauth_state')?.value
  if (!cookieState || !state || cookieState !== state) {
    return NextResponse.json(
      { error: 'OAuth state mismatch' },
      { status: 400 }
    )
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/withings/callback`

  let tokens
  try {
    tokens = await exchangeCode(code, redirectUri)
  } catch (err) {
    return NextResponse.json(
      { error: `Token exchange failed: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  const supabase = createServiceClient()

  try {
    await saveTokens(supabase, 'withings', tokens)
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save tokens: ${(err as Error).message}` },
      { status: 500 }
    )
  }

  const response = NextResponse.redirect(
    new URL('/?withings_auth=success', process.env.NEXT_PUBLIC_APP_URL!)
  )

  // Clear the consumed state cookie.
  response.cookies.set('withings_oauth_state', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return response
}
