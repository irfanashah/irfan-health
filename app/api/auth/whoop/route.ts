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
