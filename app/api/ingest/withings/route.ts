import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { withingsAdapter } from '@/adapters/withings'

export const runtime = 'nodejs'
export const maxDuration = 800

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Session-authenticated (dashboard manual trigger)
  const supabaseUser = await createServerSupabase()
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

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
    // No body — adapter resolves its own window
  }

  // Service-role client bypasses RLS for the adapter writes.
  const supabase = createServiceClient()

  const result = await withingsAdapter.fetchAndIngest({
    supabase,
    fromDate,
    toDate,
  })

  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
