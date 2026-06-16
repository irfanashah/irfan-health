import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { whoopAdapter } from '@/adapters/whoop'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify the CRON_SECRET header sent by Vercel
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const result = await whoopAdapter.fetchAndIngest({ supabase })

  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
