import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
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

  const json = (await tokenResponse.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  const supabase = createServiceClient()

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

  return NextResponse.redirect(
    new URL('/?whoop_auth=success', process.env.NEXT_PUBLIC_APP_URL!)
  )
}
