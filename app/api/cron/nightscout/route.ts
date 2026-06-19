import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { nightscoutAdapter } from '@/adapters/nightscout'

export const runtime = 'nodejs'
export const maxDuration = 800

/**
 * 48-hour rolling window — the cron runs every 12 h (`0 *\/12 * * *`), so a
 * 48 h pull gives ~4 cycles of overlap. Dedup makes the overlap free, and
 * the buffer is resilient to one or two missed cron firings. Full-history
 * reconciliation is the refill route's job, not the cron's.
 */
const CRON_WINDOW_MS = 48 * 60 * 60 * 1000

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Bearer-token auth — Vercel cron sends Authorization: Bearer ${CRON_SECRET}.
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const toDate = new Date()
  const fromDate = new Date(toDate.getTime() - CRON_WINDOW_MS)

  const result = await nightscoutAdapter.fetchAndIngest({
    supabase,
    fromDate,
    toDate,
  })

  // Episodic: an empty window between sensor stints is success, NOT error.
  // The adapter already returns status='success' with recordsFound=0 in
  // that case — we just pass it through. A 200 here means "the pipeline
  // ran cleanly", which is the right signal even with zero new rows.
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
