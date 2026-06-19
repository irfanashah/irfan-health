import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getEntries } from '@/adapters/nightscout/api'

export const runtime = 'nodejs'
export const maxDuration = 800

// Diagnose defaults to the last 30 days, not full history. Refill is the right
// tool for true full reconciliation; Diagnose is the quick "is the pipeline
// healthy?" check, and the CGM volume makes a wider default expensive.
// POST { fromDate, toDate } overrides.
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const SOURCE_SLUG = 'nightscout'

// Plausibility band must match adapters/nightscout/index.ts. Kept identical
// inline so this route stays self-contained for the diagnostic narrative.
const SGV_MIN_MGDL = 40
const SGV_MAX_MGDL = 500

interface DiagnoseBody {
  fromDate?: string
  toDate?: string
}

interface DiagnoseResult {
  windowStart: string
  windowEnd: string
  nightscout: {
    totalEntries: number
    validSgv: number
    skipped: {
      nonSgv: number          // entries returned with type !== 'sgv' (should be 0 since we filter at the API)
      outOfRange: number      // sgv < 40 or > 500 — sentinel/special codes
      missingFields: number   // non-numeric sgv / missing _id / bad date
    }
  }
  cgmRowsInDb: number
  gap: number // validSgv − cgmRowsInDb
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseUser = await createServerSupabase()
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = ((await request.json().catch(() => ({}))) as DiagnoseBody) ?? {}
  const toDate = body.toDate ? new Date(body.toDate) : new Date()
  const fromDate = body.fromDate
    ? new Date(body.fromDate)
    : new Date(toDate.getTime() - DEFAULT_WINDOW_MS)

  // 1. Pull from Nightscout for the window.
  let entries
  try {
    entries = await getEntries({ fromDate, toDate })
  } catch (err) {
    return NextResponse.json(
      { error: `Nightscout fetch failed: ${(err as Error).message}` },
      { status: 502 }
    )
  }

  let validSgv = 0
  let nonSgv = 0
  let outOfRange = 0
  let missingFields = 0

  for (const e of entries) {
    if (e.type !== 'sgv') {
      nonSgv++
      continue
    }
    if (
      typeof e.sgv !== 'number' ||
      !Number.isFinite(e.sgv) ||
      typeof e._id !== 'string' ||
      e._id.length === 0 ||
      typeof e.date !== 'number'
    ) {
      missingFields++
      continue
    }
    if (e.sgv < SGV_MIN_MGDL || e.sgv > SGV_MAX_MGDL) {
      outOfRange++
      continue
    }
    validSgv++
  }

  // 2. DB count for this window (count-only, head: true to avoid the
  //    1000-row select cap — gotcha #10).
  const supabase = createServiceClient()
  const { count, error: dbError } = await supabase
    .from('health_observations')
    .select('*', { count: 'exact', head: true })
    .eq('source_slug', SOURCE_SLUG)
    .eq('metric_type', 'glucose_cgm')
    .gte('recorded_at', fromDate.toISOString())
    .lte('recorded_at', toDate.toISOString())

  if (dbError) {
    return NextResponse.json(
      { error: `DB count failed: ${dbError.message}` },
      { status: 500 }
    )
  }

  const cgmRowsInDb = count ?? 0

  const payload: DiagnoseResult = {
    windowStart: fromDate.toISOString(),
    windowEnd: toDate.toISOString(),
    nightscout: {
      totalEntries: entries.length,
      validSgv,
      skipped: { nonSgv, outOfRange, missingFields },
    },
    cgmRowsInDb,
    gap: validSgv - cgmRowsInDb,
  }

  return NextResponse.json(payload, { status: 200 })
}
