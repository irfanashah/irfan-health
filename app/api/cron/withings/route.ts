import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { withingsAdapter } from '@/adapters/withings'

export const runtime = 'nodejs'
export const maxDuration = 800

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Bearer-token auth — Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const result = await withingsAdapter.fetchAndIngest({ supabase })

  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
