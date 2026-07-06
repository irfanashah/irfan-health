import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { nightscoutAdapter } from '@/adapters/nightscout'

export const runtime = 'nodejs'
export const maxDuration = 800

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Bearer-token auth — Vercel cron sends Authorization: Bearer ${CRON_SECRET}.
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // No explicit fromDate/toDate — let the adapter's own frontier logic
  // resolve the window (H1 + H3 fix, gotcha #157/#158). Previously this
  // route always passed a fixed 48h window, which bypassed the adapter's
  // frontier fallback entirely and had the same "advances past not-yet-
  // synced data" exposure as Whoop/Withings had before their fix — just
  // wider (>48h outage) since the window never adapted to actual coverage.
  const result = await nightscoutAdapter.fetchAndIngest({ supabase })

  // Episodic: an empty window between sensor stints is success, NOT error.
  // The adapter already returns status='success' with recordsFound=0 in
  // that case — we just pass it through. A 200 here means "the pipeline
  // ran cleanly", which is the right signal even with zero new rows.
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
