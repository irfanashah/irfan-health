import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { whoopAdapter } from '@/adapters/whoop'

export const runtime = 'nodejs'
// Whoop ingestion can take a while during backfill — set a generous timeout.
// Note: on Vercel Hobby this is capped at 60s server-side regardless.
export const maxDuration = 300

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth: user must be logged in to the dashboard
  const supabaseUser = await createServerSupabase()
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // Optional date range from request body
  let fromDate: Date | undefined
  let toDate: Date | undefined
  try {
    const body = (await request.json().catch(() => ({}))) as {
      fromDate?: string
      toDate?: string
    }
    if (body.fromDate) fromDate = new Date(body.fromDate)
    if (body.toDate) toDate = new Date(body.toDate)
  } catch {
    // No body — use default window resolution
  }

  // Service-role client for the adapter (bypasses RLS)
  const supabase = createServiceClient()

  const result = await whoopAdapter.fetchAndIngest({
    supabase,
    fromDate,
    toDate,
  })

  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
