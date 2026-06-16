import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { whoopAdapter } from '@/adapters/whoop'

export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_TARGET_START = '2025-01-01T00:00:00.000Z'
const DEFAULT_CHUNK_DAYS = 60
const DEFAULT_BUDGET_SECONDS = 180

interface BackfillBody {
  targetStart?: string
  chunkDays?: number
  maxRuntimeSeconds?: number
  // 'auto' (default) starts the frontier at the oldest existing period_start —
  // efficient for first-time backfills.
  // 'sweep' starts the frontier at `sweepStart` (or now) and walks back to
  // targetStart regardless of what's already in the DB — uses dedup to catch
  // gaps between sparse early data and the dense recent window.
  mode?: 'auto' | 'sweep'
  sweepStart?: string
}

interface BackfillResult {
  chunksRun: number
  oldestReachedISO: string
  targetStartISO: string
  isComplete: boolean
  recordsWrittenTotal: number
  recordsSkippedTotal: number
  errors: string[]
  mode: 'auto' | 'sweep'
}

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

  const body = ((await request.json().catch(() => ({}))) as BackfillBody) ?? {}

  const targetStart = new Date(body.targetStart ?? DEFAULT_TARGET_START)
  const chunkMs = (body.chunkDays ?? DEFAULT_CHUNK_DAYS) * 86_400_000
  const budgetMs =
    (body.maxRuntimeSeconds ?? DEFAULT_BUDGET_SECONDS) * 1000

  const mode = body.mode ?? 'auto'
  const supabase = createServiceClient()

  let frontier: Date
  if (mode === 'sweep') {
    // Walk back from now (or supplied sweepStart) to targetStart regardless of
    // existing data. Dedup at the adapter layer makes this safe and idempotent.
    frontier = body.sweepStart ? new Date(body.sweepStart) : new Date()
  } else {
    // Find the oldest existing period_start for whoop and walk backwards from there.
    const { data: oldest } = await supabase
      .from('health_observations')
      .select('period_start')
      .eq('source_slug', 'whoop')
      .order('period_start', { ascending: true })
      .limit(1)
      .maybeSingle()

    frontier =
      oldest?.period_start != null
        ? new Date(oldest.period_start as string)
        : new Date()
  }

  const startTime = Date.now()
  let chunksRun = 0
  let recordsWrittenTotal = 0
  let recordsSkippedTotal = 0
  const errors: string[] = []
  let isComplete = false

  while (true) {
    if (frontier.getTime() <= targetStart.getTime()) {
      isComplete = true
      break
    }
    if (Date.now() - startTime > budgetMs) break

    const chunkEnd = frontier
    const chunkStart = new Date(
      Math.max(targetStart.getTime(), frontier.getTime() - chunkMs)
    )

    const result = await whoopAdapter.fetchAndIngest({
      supabase,
      fromDate: chunkStart,
      toDate: chunkEnd,
    })

    recordsWrittenTotal += result.recordsWritten
    recordsSkippedTotal += result.recordsSkipped
    if (result.errors.length > 0) errors.push(...result.errors)

    // Hard error on the adapter side — bail rather than loop forever
    if (result.status === 'error') {
      const payload: BackfillResult = {
        chunksRun,
        oldestReachedISO: frontier.toISOString(),
        targetStartISO: targetStart.toISOString(),
        isComplete: false,
        recordsWrittenTotal,
        recordsSkippedTotal,
        errors,
        mode,
      }
      return NextResponse.json(payload, { status: 500 })
    }

    frontier = chunkStart
    chunksRun++
  }

  const payload: BackfillResult = {
    chunksRun,
    oldestReachedISO: frontier.toISOString(),
    targetStartISO: targetStart.toISOString(),
    isComplete,
    recordsWrittenTotal,
    recordsSkippedTotal,
    errors,
    mode,
  }

  return NextResponse.json(payload, { status: 200 })
}
